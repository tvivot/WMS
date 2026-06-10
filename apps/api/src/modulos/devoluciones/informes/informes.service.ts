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
