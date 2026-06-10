import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DevEstado, DevEstadoControl } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaService } from '../../core/auditoria/auditoria.service';
import { CatalogoService } from '../../core/catalogo/catalogo.service';
import { normalizarIsbn } from '../../core/catalogo/isbn.util';
import type { JwtPayload } from '../../core/auth/jwt-payload';
import {
  CerrarDto,
  ControlarBultoDto,
  CrearAutorizacionDto,
  DeclararDto,
  IngresoDto,
  RecibirDto,
} from './dto';
import {
  DEVOLUCION_ESTADO_CAMBIADO,
  DEVOLUCION_PROCESADA,
  type DevolucionEstadoCambiadoEvent,
  type DevolucionProcesadaEvent,
  type ReconciliacionLinea,
} from './eventos/eventos';
import {
  UBICACION_RESOLVER,
  type UbicacionResolverPort,
} from './puertos/ubicacion-resolver.port';

const PESO_TOLERANCIA = 0.001;

@Injectable()
export class AutorizacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
    private readonly auditoria: AuditoriaService,
    private readonly eventos: EventEmitter2,
    @Inject(UBICACION_RESOLVER)
    private readonly ubicaciones: UbicacionResolverPort,
  ) {}

  // ---- helpers ----

  private async obtenerOr404(id: number) {
    const a = await this.prisma.devAutorizacion.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Autorización no encontrada');
    return a;
  }

  private verificarPropiedad(actor: JwtPayload, clienteId: number): void {
    if (actor.tipo === 'cliente' && actor.sub !== clienteId) {
      throw new ForbiddenException('No es tu autorización');
    }
  }

  private exigirEstado(actual: DevEstado, esperado: DevEstado): void {
    if (actual !== esperado) {
      throw new BadRequestException(
        `Transición inválida: estado actual ${actual}, se esperaba ${esperado}`,
      );
    }
  }

  private async transicionar(
    id: number,
    actor: JwtPayload,
    estadoAnterior: DevEstado,
    estadoNuevo: DevEstado,
    extra: Record<string, unknown> = {},
  ) {
    const actualizada = await this.prisma.devAutorizacion.update({
      where: { id },
      data: { estado: estadoNuevo, ...extra },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'cambio_estado',
      entidad: 'dev_autorizacion',
      entidadId: String(id),
      estadoAnterior,
      estadoNuevo,
    });
    const ev: DevolucionEstadoCambiadoEvent = {
      autorizacionId: id,
      estadoAnterior,
      estadoNuevo,
      actorId: actor.sub,
      actorTipo: actor.tipo,
      ts: new Date().toISOString(),
    };
    this.eventos.emit(DEVOLUCION_ESTADO_CAMBIADO, ev);
    return actualizada;
  }

  // ---- transiciones ----

  /** A Aprobar: la crea Cliente / Vendedor / Gerencial (permiso solicitud.crear). */
  async crear(actor: JwtPayload, dto: CrearAutorizacionDto) {
    let clienteId: number;
    let depositoId: number;

    if (actor.tipo === 'cliente') {
      clienteId = actor.sub;
      const cli = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cli || !cli.activo) {
        throw new BadRequestException('Cliente inactivo: no puede operar en el WMS');
      }
      depositoId = dto.depositoId ?? cli.depositoId ?? (await this.depositoPorDefecto());
    } else {
      if (!dto.clienteId) {
        throw new BadRequestException('clienteId es requerido para usuarios internos');
      }
      clienteId = dto.clienteId;
      const cli = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cli) throw new BadRequestException('Cliente inexistente');
      if (!cli.activo) {
        throw new BadRequestException('Cliente inactivo: no se pueden crear devoluciones');
      }
      depositoId = dto.depositoId ?? cli.depositoId ?? (await this.depositoPorDefecto());
    }

    const creada = await this.prisma.devAutorizacion.create({
      data: {
        estado: DevEstado.A_APROBAR,
        clienteId,
        depositoId,
        creadoPorId: actor.sub,
        creadoPorTipo: actor.tipo,
        observaciones: dto.observaciones ?? null,
      },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'crear',
      entidad: 'dev_autorizacion',
      entidadId: String(creada.id),
      estadoNuevo: DevEstado.A_APROBAR,
    });
    return creada;
  }

  private async depositoPorDefecto(): Promise<number> {
    const d = await this.prisma.deposito.findFirst({ orderBy: { id: 'asc' } });
    if (!d) throw new BadRequestException('No hay depósitos configurados');
    return d.id;
  }

  /** Aprobado: permiso solicitud.aprobar. */
  async aprobar(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.A_APROBAR);
    return this.transicionar(id, actor, a.estado, DevEstado.APROBADO);
  }

  /** Carga del cliente: líneas + bultos + peso + transportista (estado APROBADO). */
  async declarar(actor: JwtPayload, id: number, dto: DeclararDto) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);

    // Resolver ISBN→producto; rechazar no catalogados (no líneas fantasma).
    const resueltas: { isbn: string; productoId: number | null; cantidad: number }[] = [];
    const noCatalogados: string[] = [];
    for (const linea of dto.lineas) {
      const norm = normalizarIsbn(linea.isbn);
      if (!norm) {
        noCatalogados.push(linea.isbn);
        continue;
      }
      const prod = await this.catalogo.resolverPorIsbnOpcional(norm);
      if (!prod) {
        noCatalogados.push(linea.isbn);
        continue;
      }
      resueltas.push({ isbn: norm, productoId: prod.id, cantidad: linea.cantidad });
    }
    if (noCatalogados.length > 0) {
      throw new BadRequestException(
        `ISBN no catalogados (se avisó, no se cargan): ${noCatalogados.join(', ')}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.devDeclaracion.deleteMany({ where: { autorizacionId: id } }),
      this.prisma.devDeclaracion.createMany({
        data: resueltas.map((r) => ({
          autorizacionId: id,
          isbn: r.isbn,
          productoId: r.productoId,
          cantidad: r.cantidad,
        })),
      }),
      this.prisma.devAutorizacion.update({
        where: { id },
        data: {
          bultosDeclarados: dto.bultosDeclarados,
          pesoTotalDeclarado: dto.pesoTotalDeclarado,
          transportistaId: dto.transportistaId ?? null,
        },
      }),
    ]);
    return this.detalle(id);
  }

  /** Despacho: APROBADO → En tránsito. */
  async despachar(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);
    const lineas = await this.prisma.devDeclaracion.count({ where: { autorizacionId: id } });
    if (lineas === 0 || !a.bultosDeclarados || a.pesoTotalDeclarado === null) {
      throw new BadRequestException(
        'Faltan datos para despachar: líneas, bultos y peso total',
      );
    }
    return this.transicionar(id, actor, a.estado, DevEstado.EN_TRANSITO);
  }

  /** Recepción: En tránsito → Entregado (permiso deposito.recibir). */
  async recibir(actor: JwtPayload, id: number, dto: RecibirDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.EN_TRANSITO);
    if (
      a.bultosDeclarados !== null &&
      dto.bultosRecibidos !== a.bultosDeclarados &&
      !dto.observaciones
    ) {
      throw new BadRequestException(
        'Los bultos recibidos difieren de los declarados: observación obligatoria',
      );
    }
    // Crear los bultos a controlar (1..bultosRecibidos).
    await this.prisma.$transaction([
      this.prisma.devBulto.deleteMany({ where: { autorizacionId: id } }),
      this.prisma.devBulto.createMany({
        data: Array.from({ length: dto.bultosRecibidos }, (_, i) => ({
          autorizacionId: id,
          numero: i + 1,
          estadoControl: DevEstadoControl.NO_CONTROLADO,
        })),
      }),
    ]);
    return this.transicionar(id, actor, a.estado, DevEstado.ENTREGADO, {
      bultosRecibidos: dto.bultosRecibidos,
      observaciones: dto.observaciones ?? a.observaciones,
    });
  }

  /** Ingreso a depósito: registra ubicación de espera (vía puerto). */
  async ingreso(actor: JwtPayload, id: number, dto: IngresoDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.ENTREGADO);
    const valida = await this.ubicaciones.esValidaPara(dto.ubicacionEspera, 'devoluciones');
    if (!valida) {
      throw new BadRequestException('Ubicación de espera inválida');
    }
    return this.transicionar(id, actor, a.estado, DevEstado.INGRESO_DEPOSITO, {
      ubicacionEspera: dto.ubicacionEspera,
    });
  }

  /** Control de un bulto: cantidades + mal estado por ISBN (estado INGRESO_DEPOSITO). */
  async controlarBulto(
    actor: JwtPayload,
    id: number,
    numero: number,
    dto: ControlarBultoDto,
  ) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.INGRESO_DEPOSITO);
    const bulto = await this.prisma.devBulto.findUnique({
      where: { autorizacionId_numero: { autorizacionId: id, numero } },
    });
    if (!bulto) throw new NotFoundException('Bulto inexistente');

    const filas: { bultoId: number; isbn: string; productoId: number | null; cantidad: number; malEstado: number }[] = [];
    for (const c of dto.controles) {
      const norm = normalizarIsbn(c.isbn);
      if (!norm) throw new BadRequestException(`ISBN inválido: ${c.isbn}`);
      const malo = c.malEstado ?? 0;
      if (malo > c.cantidad) {
        throw new BadRequestException('mal estado no puede superar la cantidad');
      }
      const prod = await this.catalogo.resolverPorIsbnOpcional(norm);
      filas.push({
        bultoId: bulto.id,
        isbn: norm,
        productoId: prod?.id ?? null,
        cantidad: c.cantidad,
        malEstado: malo,
      });
    }

    await this.prisma.$transaction([
      this.prisma.devControl.deleteMany({ where: { bultoId: bulto.id } }),
      this.prisma.devControl.createMany({ data: filas }),
      this.prisma.devBulto.update({
        where: { id: bulto.id },
        data: {
          peso: dto.peso ?? bulto.peso,
          estadoControl: DevEstadoControl.CONTROLADO,
        },
      }),
    ]);
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'controlar_bulto',
      entidad: 'dev_bulto',
      entidadId: `${id}/${numero}`,
      detalle: { lineas: filas.length },
    });
    return this.detalle(id);
  }

  /** Cierre: reconciliación + destinos + Procesado + evento devolucion.procesada. */
  async cerrar(actor: JwtPayload, id: number, dto: CerrarDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.INGRESO_DEPOSITO);

    const bultos = await this.prisma.devBulto.findMany({ where: { autorizacionId: id } });
    if (bultos.length === 0) {
      throw new BadRequestException('No hay bultos para cerrar');
    }
    const sinControlar = bultos.filter(
      (b) => b.estadoControl !== DevEstadoControl.CONTROLADO,
    );
    if (sinControlar.length > 0) {
      throw new BadRequestException(
        `Hay ${sinControlar.length} bulto(s) sin controlar; no se puede procesar`,
      );
    }

    // Ubicaciones destino (vía puerto): buenos a picking/pallet, malos a dañados/cuarentena.
    const okBueno = await this.ubicaciones.esValidaPara(dto.ubicacionDestinoBueno, 'picking');
    const okMalo = await this.ubicaciones.esValidaPara(dto.ubicacionDestinoMalo, 'dañados');
    if (!okBueno || !okMalo) {
      throw new BadRequestException('Ubicación destino inválida');
    }

    // Control de peso: suma de bultos vs peso total declarado (no bloquea, exige observación).
    const sumaPesos = bultos.reduce((acc, b) => acc + (b.peso ? Number(b.peso) : 0), 0);
    const declarado = a.pesoTotalDeclarado ? Number(a.pesoTotalDeclarado) : null;
    if (
      declarado !== null &&
      Math.abs(sumaPesos - declarado) > PESO_TOLERANCIA &&
      !dto.observaciones &&
      !a.observaciones
    ) {
      throw new BadRequestException(
        `Suma de pesos (${sumaPesos}) ≠ peso declarado (${declarado}): observación obligatoria`,
      );
    }

    const reconciliacion = await this.calcularReconciliacion(id);

    const actualizada = await this.transicionar(
      id,
      actor,
      a.estado,
      DevEstado.PROCESADO,
      {
        ubicacionDestinoBueno: dto.ubicacionDestinoBueno,
        ubicacionDestinoMalo: dto.ubicacionDestinoMalo,
        observaciones: dto.observaciones ?? a.observaciones,
      },
    );

    const ev: DevolucionProcesadaEvent = {
      autorizacionId: id,
      clienteId: a.clienteId,
      depositoId: a.depositoId,
      reconciliacion,
      ubicacionDestinoBueno: dto.ubicacionDestinoBueno,
      ubicacionDestinoMalo: dto.ubicacionDestinoMalo,
      ts: new Date().toISOString(),
    };
    // NO mueve stock: solo registra destino y emite el evento (lo consume Inventario).
    this.eventos.emit(DEVOLUCION_PROCESADA, ev);

    return { autorizacion: actualizada, reconciliacion };
  }

  // ---- consultas ----

  /** Reconciliación declarado vs recibido por ISBN (agrega sobre todos los bultos). */
  async calcularReconciliacion(id: number): Promise<ReconciliacionLinea[]> {
    const [declaraciones, bultos] = await Promise.all([
      this.prisma.devDeclaracion.findMany({ where: { autorizacionId: id } }),
      this.prisma.devBulto.findMany({
        where: { autorizacionId: id },
        include: { controles: true },
      }),
    ]);

    const mapa = new Map<string, ReconciliacionLinea>();
    const get = (isbn: string, productoId: number | null): ReconciliacionLinea => {
      let l = mapa.get(isbn);
      if (!l) {
        l = { isbn, productoId, declarado: 0, recibido: 0, bueno: 0, malo: 0 };
        mapa.set(isbn, l);
      }
      if (l.productoId === null && productoId !== null) l.productoId = productoId;
      return l;
    };

    for (const d of declaraciones) {
      get(d.isbn, d.productoId).declarado += d.cantidad;
    }
    for (const b of bultos) {
      for (const c of b.controles) {
        const l = get(c.isbn, c.productoId);
        l.recibido += c.cantidad;
        l.malo += c.malEstado;
        l.bueno += c.cantidad - c.malEstado;
      }
    }
    return [...mapa.values()].sort((a, b) => a.isbn.localeCompare(b.isbn));
  }

  async listar(actor: JwtPayload, params: { estado?: DevEstado; clienteId?: number }) {
    const where: { estado?: DevEstado; clienteId?: number } = {};
    if (params.estado) where.estado = params.estado;
    // Cliente: solo ve lo suyo.
    if (actor.tipo === 'cliente') where.clienteId = actor.sub;
    else if (params.clienteId) where.clienteId = params.clienteId;
    return this.prisma.devAutorizacion.findMany({
      where,
      orderBy: { id: 'desc' },
    });
  }

  async detalle(id: number) {
    const a = await this.prisma.devAutorizacion.findUnique({
      where: { id },
      include: {
        declaraciones: true,
        bultos: { include: { controles: true }, orderBy: { numero: 'asc' } },
      },
    });
    if (!a) throw new NotFoundException('Autorización no encontrada');
    return a;
  }
}
