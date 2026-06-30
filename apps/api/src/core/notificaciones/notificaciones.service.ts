import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphMailer } from './graph-mailer';
import { estadoO365 } from './notificaciones.config';
import { EditarGrupoDto, CrearGrupoDto, EditarReglaDto } from './dto';
import {
  ContextoPlantilla,
  parsearEmails,
  renderPlantilla,
  unirEmails,
} from './plantilla';

/** Tope de reintentos de un envío fallido antes de dejarlo en ERROR definitivo. */
const MAX_INTENTOS = 5;
/** Cuántos pendientes reprocesa cada corrida del cron (evita ráfagas). */
const LOTE_REINTENTO = 20;
/**
 * Antigüedad mínima (ms) para que el cron tome un log: evita reenviar uno que el
 * envío inline acaba de crear y todavía está mandando (carrera → duplicado). El
 * inline actualiza la fila a ENVIADO/ERROR en segundos, mucho antes de esto.
 */
const EDAD_MIN_REINTENTO_MS = 2 * 60 * 1000;

interface DatosEntidad {
  /** Nombre legible del cliente para la plantilla. */
  cliente: string;
  /** Emails del cliente (para incluirCliente). */
  emailsCliente: string[];
}

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  /** Evita que dos corridas del cron de reintento se solapen sobre el mismo lote. */
  private reintentando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: GraphMailer,
  ) {}

  // ---- Estado de la integración (para la UI) ----

  estado() {
    const o = estadoO365();
    return {
      office365Configurado: o.configurado,
      from: o.from,
      variables: o.variables,
    };
  }

  // ---- Grupos de correo (ABM) ----

  listarGrupos() {
    return this.prisma.grupoCorreo.findMany({ orderBy: { nombre: 'asc' } });
  }

  crearGrupo(dto: CrearGrupoDto) {
    return this.prisma.grupoCorreo.create({
      data: {
        nombre: dto.nombre.trim(),
        emails: dto.emails,
        activo: dto.activo ?? true,
      },
    });
  }

  async editarGrupo(id: number, dto: EditarGrupoDto) {
    const existe = await this.prisma.grupoCorreo.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Grupo no encontrado');
    return this.prisma.grupoCorreo.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.emails !== undefined ? { emails: dto.emails } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
    });
  }

  /** Usuarios internos con email cargado, para el selector de destinos de regla. */
  listarUsuariosNotificables() {
    return this.prisma.usuario.findMany({
      where: { activo: true, email: { not: null } },
      select: { id: true, nombre: true, username: true, email: true },
      orderBy: { nombre: 'asc' },
    });
  }

  // ---- Reglas por estado (ABM) ----

  async listarReglas(modulo = 'devoluciones') {
    const reglas = await this.prisma.notificacionRegla.findMany({
      where: { modulo },
      orderBy: { id: 'asc' },
      include: { grupos: true, usuarios: true },
    });
    return reglas.map((r) => ({
      id: r.id,
      modulo: r.modulo,
      estado: r.estado,
      incluirCliente: r.incluirCliente,
      asunto: r.asunto,
      cuerpo: r.cuerpo,
      activo: r.activo,
      grupoIds: r.grupos.map((g) => g.grupoId),
      usuarioIds: r.usuarios.map((u) => u.usuarioId),
    }));
  }

  async editarRegla(id: number, dto: EditarReglaDto) {
    const existe = await this.prisma.notificacionRegla.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Regla no encontrada');

    await this.prisma.$transaction(async (tx) => {
      await tx.notificacionRegla.update({
        where: { id },
        data: {
          ...(dto.incluirCliente !== undefined ? { incluirCliente: dto.incluirCliente } : {}),
          ...(dto.asunto !== undefined ? { asunto: dto.asunto } : {}),
          ...(dto.cuerpo !== undefined ? { cuerpo: dto.cuerpo } : {}),
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        },
      });
      // Reemplazo total de los destinos cuando vienen en el DTO (replace, no merge).
      if (dto.grupoIds !== undefined) {
        await tx.notificacionReglaGrupo.deleteMany({ where: { reglaId: id } });
        const ids = [...new Set(dto.grupoIds)];
        if (ids.length > 0) {
          await tx.notificacionReglaGrupo.createMany({
            data: ids.map((grupoId) => ({ reglaId: id, grupoId })),
          });
        }
      }
      if (dto.usuarioIds !== undefined) {
        await tx.notificacionReglaUsuario.deleteMany({ where: { reglaId: id } });
        const ids = [...new Set(dto.usuarioIds)];
        if (ids.length > 0) {
          await tx.notificacionReglaUsuario.createMany({
            data: ids.map((usuarioId) => ({ reglaId: id, usuarioId })),
          });
        }
      }
    });
    return this.obtenerRegla(id);
  }

  private async obtenerRegla(id: number) {
    const [r] = await this.listarReglasPorId(id);
    return r;
  }

  private async listarReglasPorId(id: number) {
    const r = await this.prisma.notificacionRegla.findUnique({
      where: { id },
      include: { grupos: true, usuarios: true },
    });
    if (!r) return [];
    return [
      {
        id: r.id,
        modulo: r.modulo,
        estado: r.estado,
        incluirCliente: r.incluirCliente,
        asunto: r.asunto,
        cuerpo: r.cuerpo,
        activo: r.activo,
        grupoIds: r.grupos.map((g) => g.grupoId),
        usuarioIds: r.usuarios.map((u) => u.usuarioId),
      },
    ];
  }

  // ---- Envío disparado por cambio de estado (lo llama el listener) ----

  /**
   * Arma y envía las notificaciones de un cambio de estado. Resiliente: nunca
   * lanza (un fallo de correo no puede afectar la transición de la entidad).
   */
  async notificarCambioEstado(params: {
    modulo: string;
    estado: string;
    estadoAnterior?: string;
    entidadId: number;
    clienteId: number;
    fechaIso?: string;
    /** Texto extra para el placeholder {{detalle}} (p.ej. diferencias de lote). */
    detalle?: string;
  }): Promise<void> {
    try {
      const regla = await this.prisma.notificacionRegla.findUnique({
        where: { modulo_estado: { modulo: params.modulo, estado: params.estado } },
        include: { grupos: { include: { grupo: true } }, usuarios: true },
      });
      if (!regla || !regla.activo) return;

      const datos = await this.datosEntidad(params.clienteId);

      // Destinatarios: grupos activos + usuarios internos + (opcional) cliente.
      const emailsGrupos = regla.grupos
        .filter((g) => g.grupo.activo)
        .flatMap((g) => parsearEmails(g.grupo.emails));

      const usuarioIds = regla.usuarios.map((u) => u.usuarioId);
      const emailsUsuarios =
        usuarioIds.length > 0
          ? (
              await this.prisma.usuario.findMany({
                where: { id: { in: usuarioIds }, activo: true, email: { not: null } },
                select: { email: true },
              })
            ).map((u) => u.email!).filter(Boolean)
          : [];

      const emailsCliente = regla.incluirCliente ? datos.emailsCliente : [];

      const destinatarios = unirEmails(emailsGrupos, emailsUsuarios, emailsCliente);
      if (destinatarios.length === 0) {
        // Regla activa pero sin destinos resolubles (grupos inactivos/vacíos,
        // usuarios sin email, cliente sin email): se deja rastro para diagnóstico.
        this.logger.warn(
          `Regla ${regla.id} (${params.modulo}/${params.estado}) activa pero sin destinatarios para la entidad ${params.entidadId}`,
        );
        return;
      }

      const ctx: ContextoPlantilla = {
        nro: params.entidadId,
        cliente: datos.cliente,
        estado: params.estado,
        estadoAnterior: params.estadoAnterior,
        fecha: this.formatearFecha(params.fechaIso),
        detalle: params.detalle,
      };
      const asunto = renderPlantilla(regla.asunto, ctx);
      const cuerpo = renderPlantilla(regla.cuerpo, ctx);

      // Outbox: se registra ANTES de enviar; el envío actualiza el estado.
      const log = await this.prisma.notificacionLog.create({
        data: {
          reglaId: regla.id,
          modulo: params.modulo,
          entidadId: params.entidadId,
          estado: params.estado,
          destinatarios: destinatarios.join(', '),
          asunto,
          cuerpo,
        },
      });
      await this.intentarEnviarLog(log.id, destinatarios, asunto, cuerpo);
    } catch (err) {
      // Defensa extra: el listener no debe ver excepciones.
      this.logger.error(
        `notificarCambioEstado falló (entidad ${params.entidadId}, estado ${params.estado}): ${(err as Error).message}`,
      );
    }
  }

  private async datosEntidad(clienteId: number): Promise<DatosEntidad> {
    const cli = await this.prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { nombre: true, email: true },
    });
    return {
      cliente: cli?.nombre ?? `Cliente ${clienteId}`,
      emailsCliente: parsearEmails(cli?.email),
    };
  }

  /** Envía un log y actualiza su estado (ENVIADO/ERROR) + contador de intentos. */
  private async intentarEnviarLog(
    logId: number,
    destinatarios: string[],
    asunto: string,
    cuerpo: string,
  ): Promise<void> {
    try {
      await this.mailer.enviar({ to: destinatarios, asunto, cuerpo });
      await this.prisma.notificacionLog.update({
        where: { id: logId },
        data: {
          estadoEnvio: 'ENVIADO',
          error: null,
          sentAt: new Date(),
          intentos: { increment: 1 },
        },
      });
    } catch (err) {
      const msg = (err as Error).message;
      await this.prisma.notificacionLog.update({
        where: { id: logId },
        data: {
          estadoEnvio: 'ERROR',
          error: msg.slice(0, 1000),
          intentos: { increment: 1 },
        },
      });
      this.logger.warn(`Envío ${logId} falló: ${msg}`);
    }
  }

  // ---- Reintento (lo llama el cron) ----

  /**
   * Reprocesa logs en ERROR/PENDIENTE con intentos < tope. Idempotente y acotado
   * por lote. No hace nada si Office365 no está configurado (evita marcar ERROR
   * por una config que aún no existe; reintenta cuando se configure).
   */
  async reintentarPendientes(): Promise<{ reintentados: number }> {
    if (!this.mailer.estaConfigurado()) return { reintentados: 0 };
    // Anti-solape: si una corrida previa sigue procesando su lote, salir.
    if (this.reintentando) return { reintentados: 0 };
    this.reintentando = true;
    try {
      const corte = new Date(Date.now() - EDAD_MIN_REINTENTO_MS);
      const pendientes = await this.prisma.notificacionLog.findMany({
        where: {
          estadoEnvio: { in: ['ERROR', 'PENDIENTE'] },
          intentos: { lt: MAX_INTENTOS },
          updatedAt: { lt: corte },
        },
        orderBy: { id: 'asc' },
        take: LOTE_REINTENTO,
      });
      for (const log of pendientes) {
        await this.intentarEnviarLog(
          log.id,
          parsearEmails(log.destinatarios),
          log.asunto,
          log.cuerpo,
        );
      }
      return { reintentados: pendientes.length };
    } finally {
      this.reintentando = false;
    }
  }

  // ---- Prueba manual desde la UI ----

  async enviarPrueba(to: string): Promise<{ ok: boolean }> {
    try {
      await this.mailer.enviar({
        to: [to],
        asunto: 'Prueba de notificaciones — WMS Grupal',
        cuerpo:
          'Este es un correo de prueba del sistema de notificaciones del WMS. ' +
          'Si lo recibís, la integración con Office365 está funcionando.',
      });
      return { ok: true };
    } catch (err) {
      // Error claro para el admin (503), en vez de un 500 opaco.
      throw new ServiceUnavailableException(
        `No se pudo enviar la prueba: ${(err as Error).message}`,
      );
    }
  }

  private formatearFecha(iso?: string): string {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    // Fecha local Argentina, formato corto legible.
    return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  }
}
