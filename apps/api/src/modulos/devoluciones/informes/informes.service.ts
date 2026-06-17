import { Injectable } from '@nestjs/common';
import { DevEstado } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class InformesService {
  constructor(private readonly prisma: PrismaService) {}

  /** KPIs generales + conteo por estado. */
  async resumen() {
    const porEstadoRaw = await this.prisma.devAutorizacion.groupBy({
      by: ['estado'],
      _count: { _all: true },
    });
    const porEstado: Record<string, number> = {};
    for (const e of Object.values(DevEstado)) porEstado[e] = 0;
    for (const r of porEstadoRaw) porEstado[r.estado] = r._count._all;

    const total = Object.values(porEstado).reduce((a, b) => a + b, 0);
    const procesadas = porEstado[DevEstado.PROCESADO] ?? 0;
    const enCurso = total - procesadas;

    const calidad = await this.prisma.devControl.aggregate({
      _sum: { cantidad: true, malEstado: true },
    });
    const recibido = calidad._sum.cantidad ?? 0;
    const malo = calidad._sum.malEstado ?? 0;

    return {
      total,
      procesadas,
      enCurso,
      libros: { recibido, bueno: recibido - malo, malo },
      porEstado,
    };
  }

  /** Top clientes por cantidad de devoluciones. */
  async porCliente(limit = 8) {
    const grupos = await this.prisma.devAutorizacion.groupBy({
      by: ['clienteId'],
      _count: { _all: true },
      orderBy: { _count: { clienteId: 'desc' } },
      take: limit,
    });
    const ids = grupos.map((g) => g.clienteId);
    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: ids } },
      select: { id: true, nombre: true, nroCliente: true },
    });
    const mapa = new Map(clientes.map((c) => [c.id, c]));
    return grupos.map((g) => ({
      clienteId: g.clienteId,
      nombre: mapa.get(g.clienteId)?.nombre ?? `Cliente ${g.clienteId}`,
      cantidad: g._count._all,
    }));
  }

  /**
   * Clientes con consignación ACTIVA (saldo > 0), con la cantidad de libros y
   * títulos que tienen en consignación. Ordenado por libros desc. Datos del
   * último snapshot del ERP (tabla dev_consignacion_saldo, dueña de este módulo).
   */
  async consignacionPorCliente() {
    const grupos = await this.prisma.devConsignacionSaldo.groupBy({
      by: ['clienteId'],
      where: { cantidad: { gt: 0 } },
      _sum: { cantidad: true },
      _count: { _all: true },
    });
    const ids = grupos.map((g) => g.clienteId);
    const clientes = ids.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: ids } },
          select: { id: true, nroCliente: true, nombre: true },
        })
      : [];
    const mapa = new Map(clientes.map((c) => [c.id, c]));
    return grupos
      .map((g) => ({
        clienteId: g.clienteId,
        nroCliente: mapa.get(g.clienteId)?.nroCliente ?? null,
        nombre: mapa.get(g.clienteId)?.nombre ?? `Cliente ${g.clienteId}`,
        titulos: g._count._all,
        libros: g._sum.cantidad ?? 0,
      }))
      .sort((a, b) => b.libros - a.libros || a.nombre.localeCompare(b.nombre));
  }

  /** Detalle: los libros que un cliente tiene en consignación (saldo > 0). */
  async consignacionDetalle(clienteId: number) {
    const [cliente, filas] = await Promise.all([
      this.prisma.cliente.findUnique({
        where: { id: clienteId },
        select: { id: true, nroCliente: true, nombre: true },
      }),
      this.prisma.devConsignacionSaldo.findMany({
        where: { clienteId, cantidad: { gt: 0 } },
        select: { isbn: true, productoId: true, cantidad: true, snapshotTs: true },
      }),
    ]);

    const info = await this.infoPorProducto(
      filas.map((f) => f.productoId).filter((x): x is number => x !== null),
    );
    const items = filas
      .map((f) => {
        const p = f.productoId !== null ? info.get(f.productoId) : undefined;
        return {
          productoId: f.productoId,
          isbn: f.isbn,
          titulo: p?.titulo ?? null,
          editorial: p?.editorial ?? null,
          imagenUrl: p?.imagenUrl ?? null,
          cantidad: f.cantidad,
        };
      })
      .sort(
        (x, y) =>
          y.cantidad - x.cantidad ||
          (x.titulo ?? x.isbn).localeCompare(y.titulo ?? y.isbn),
      );

    const actualizado = filas.reduce<Date | null>(
      (acc, f) => (!acc || f.snapshotTs > acc ? f.snapshotTs : acc),
      null,
    );
    return {
      cliente,
      items,
      totalTitulos: items.length,
      totalLibros: items.reduce((s, i) => s + i.cantidad, 0),
      actualizado,
    };
  }

  /**
   * Info de catálogo por productoId (referencia por ID, sin FK cruzada).
   * Espeja el helper de StockService; local para no acoplar Informes al stock.
   */
  private async infoPorProducto(ids: number[]) {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0)
      return new Map<number, { titulo: string; editorial: string | null; imagenUrl: string | null }>();
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: unicos } },
      select: { id: true, titulo: true, editorial: true, imagenUrl: true },
    });
    return new Map(
      productos.map((p) => [
        p.id,
        { titulo: p.titulo, editorial: p.editorial, imagenUrl: p.imagenUrl },
      ]),
    );
  }

  /** Serie temporal: devoluciones por día (últimos 30). */
  async serie() {
    const filas = await this.prisma.$queryRaw<{ dia: Date; c: bigint }[]>`
      SELECT DATE(created_at) AS dia, COUNT(*) AS c
      FROM dev_autorizacion
      GROUP BY DATE(created_at)
      ORDER BY dia DESC
      LIMIT 30`;
    return filas
      .map((f) => ({
        dia:
          f.dia instanceof Date
            ? f.dia.toISOString().slice(0, 10)
            : String(f.dia).slice(0, 10),
        cantidad: Number(f.c),
      }))
      .reverse();
  }
}
