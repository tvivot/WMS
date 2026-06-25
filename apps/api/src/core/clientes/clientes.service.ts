import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../seguridad/password.service';
import { generarClave } from '../seguridad/clave.util';
import { ClienteImportDto, CrearClienteDto, EditarClienteDto } from './dto';
import { enBloques, escaparLike } from '../util/bloques';

const PUBLICO = {
  id: true, nroCliente: true, nombre: true, direccion: true, email: true, activo: true,
  primerIngreso: true, paisId: true, depositoId: true, createdAt: true,
} as const;

/**
 * Marcador de "sin clave de portal": no es un hash scrypt válido, por lo que
 * verificar() siempre da false → el cliente importado NO puede loguear hasta
 * que un admin le genere clave con reset-clave. Evita correr scrypt (50ms c/u)
 * para miles de clientes importados que quizá nunca usen el portal.
 */
const SIN_CLAVE = 'sin-clave';

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  /**
   * Listado paginado y filtrado SERVER-SIDE (antes se bajaba todo capado a 2000
   * y se filtraba en el navegador: un cliente más allá del tope nunca aparecía
   * ni buscándolo). Ahora la búsqueda y la página las resuelve la base:
   *  - nombre y nroCliente: contains (el padrón es acotado; el orderBy usa el
   *    índice [nombre]). Se mantiene `contains` en nro para no perder los matches
   *    parciales que ya hacía la búsqueda anterior.
   * Devuelve { total, items } para que el front pagine sin traer toda la tabla.
   * skip/take se sanitizan (NaN/negativos → defaults): `?? 0` no atrapa NaN.
   */
  async listar(params: { q?: string; skip?: number; take?: number }) {
    const take = Number.isFinite(params.take) ? Math.min(Math.max(params.take!, 1), 500) : 50;
    const skip = Number.isFinite(params.skip) && params.skip! > 0 ? Math.floor(params.skip!) : 0;
    const q = params.q?.trim();
    const t = q ? escaparLike(q) : '';
    const where = q
      ? { OR: [{ nombre: { contains: t } }, { nroCliente: { contains: t } }] }
      : {};

    const [total, items] = await Promise.all([
      this.prisma.cliente.count({ where }),
      this.prisma.cliente.findMany({
        where,
        select: PUBLICO,
        orderBy: { nombre: 'asc' },
        skip,
        take,
      }),
    ]);
    return { total, items };
  }

  /**
   * Búsqueda liviana para autocomplete en formularios: por número o nombre.
   * Devuelve hasta 10 resultados activos.
   */
  async buscar(q: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const t = escaparLike(term);
    return this.prisma.cliente.findMany({
      where: {
        activo: true,
        OR: [{ nroCliente: { contains: t } }, { nombre: { contains: t } }],
      },
      select: { id: true, nroCliente: true, nombre: true, direccion: true },
      orderBy: { nombre: 'asc' },
      take: 10,
    });
  }

  /**
   * Crea el cliente y devuelve la clave UNA sola vez (para entregarla).
   * Si el admin eligió una clave (dto.clave) se usa esa y queda definitiva
   * (sin forzar cambio en el primer ingreso); si no, se genera una aleatoria.
   */
  async crear(dto: CrearClienteDto) {
    const existe = await this.prisma.cliente.findUnique({ where: { nroCliente: dto.nroCliente } });
    if (existe) throw new BadRequestException('Ya existe un cliente con ese número');
    const clave = dto.clave?.trim() || generarClave();
    const cliente = await this.prisma.cliente.create({
      data: {
        nroCliente: dto.nroCliente,
        nombre: dto.nombre,
        direccion: dto.direccion ?? null,
        email: dto.email?.trim() || null,
        claveHash: await this.password.hash(clave),
        paisId: dto.paisId ?? null,
        depositoId: dto.depositoId ?? null,
        primerIngreso: !dto.clave?.trim(),
      },
      select: PUBLICO,
    });
    return { ...cliente, claveGenerada: clave };
  }

  /**
   * Importación masiva desde el sistema externo (integrador): upsert por
   * nro_cliente. NO toca la clave de clientes existentes; los nuevos quedan
   * sin clave de portal (se habilita con reset-clave cuando haga falta).
   */
  async importar(items: ClienteImportDto[]) {
    const errores: { nroCliente: string; error: string }[] = [];

    // Dedup por nro_cliente dentro del mismo lote (la última fila gana): evita
    // procesar el mismo cliente dos veces y choques con skipDuplicates.
    const porNro = new Map(items.map((i) => [i.nroCliente, i]));
    const unicos = [...porNro.values()];

    // 1) Una sola consulta (en bloques) para saber cuáles ya existen, en vez de
    //    un findUnique por fila (antes: N round-trips serializados).
    const existe = new Set<string>();
    for (const bloque of enBloques(unicos.map((i) => i.nroCliente), 1000)) {
      const filas = await this.prisma.cliente.findMany({
        where: { nroCliente: { in: bloque } },
        select: { nroCliente: true },
      });
      for (const f of filas) existe.add(f.nroCliente);
    }

    const nuevos = unicos.filter((i) => !existe.has(i.nroCliente));
    const aActualizar = unicos.filter((i) => existe.has(i.nroCliente));

    // 2) Alta masiva de los nuevos (sin clave de portal) con createMany.
    let creados = 0;
    for (const bloque of enBloques(nuevos, 500)) {
      const r = await this.prisma.cliente.createMany({
        data: bloque.map((i) => ({
          nroCliente: i.nroCliente,
          nombre: i.nombre,
          direccion: i.direccion ?? null,
          claveHash: SIN_CLAVE,
          activo: i.activo ?? true,
          primerIngreso: true,
        })),
        skipDuplicates: true,
      });
      creados += r.count;
    }

    // 3) Actualización de existentes: varias updates por transacción (no toca la
    //    clave). Agrupa los round-trips en lugar de uno serializado por fila.
    let actualizados = 0;
    for (const bloque of enBloques(aActualizar, 200)) {
      await this.prisma.$transaction(
        bloque.map((i) =>
          this.prisma.cliente.update({
            where: { nroCliente: i.nroCliente },
            data: {
              nombre: i.nombre,
              direccion: i.direccion ?? null,
              ...(i.activo !== undefined ? { activo: i.activo } : {}),
            },
            select: { id: true },
          }),
        ),
      );
      actualizados += bloque.length;
    }

    return { recibidos: items.length, creados, actualizados, errores };
  }

  async editar(id: number, dto: EditarClienteDto) {
    await this.obtener(id);
    // Normaliza email vacío a null (consistente con crear()): '' no es "tiene email".
    const data = {
      ...dto,
      ...(dto.email !== undefined ? { email: dto.email.trim() || null } : {}),
    };
    return this.prisma.cliente.update({ where: { id }, data, select: PUBLICO });
  }

  async obtener(id: number) {
    const c = await this.prisma.cliente.findUnique({ where: { id }, select: PUBLICO });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    return c;
  }

  /**
   * Resetea la clave y devuelve la nueva (para reentregar).
   * Con claveManual queda esa como definitiva; sin ella se genera una aleatoria
   * y se fuerza el cambio en el primer ingreso.
   */
  async resetClave(id: number, claveManual?: string) {
    await this.obtener(id);
    const manual = claveManual?.trim();
    const clave = manual || generarClave();
    await this.prisma.cliente.update({
      where: { id },
      data: { claveHash: await this.password.hash(clave), primerIngreso: !manual, intentosFallidos: 0, bloqueadoHasta: null },
    });
    return { id, claveGenerada: clave };
  }
}
