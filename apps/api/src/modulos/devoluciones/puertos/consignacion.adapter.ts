import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizarIsbn } from '../../../core/catalogo/isbn.util';
import { enBloques } from '../../../core/util/bloques';
import type {
  ConsignacionCargaResultado,
  ConsignacionPort,
  ConsignacionSaldoItem,
} from './consignacion.port';

/**
 * Implementación del puerto de consignación contra dev_consignacion_saldo.
 * Full-replace por cliente, idempotente; resuelve nroCliente → clienteId e
 * ISBN → productoId contra el núcleo (por ID, sin FK cruzada).
 */
@Injectable()
export class PrismaConsignacionAdapter implements ConsignacionPort {
  constructor(private readonly prisma: PrismaService) {}

  async cargarSaldos(
    snapshotTs: string,
    items: ConsignacionSaldoItem[],
  ): Promise<ConsignacionCargaResultado> {
    const ts = new Date(snapshotTs);
    const errores: { isbn: string; error: string }[] = [];

    // 1) Normalizar ISBN y agrupar por nroCliente. Dedup (cliente, isbn): la
    //    última fila gana. Suma NO: el ERP manda el saldo final por título.
    const porCliente = new Map<string, Map<string, number>>();
    for (const item of items) {
      const isbn = normalizarIsbn(item.isbn);
      if (!isbn) {
        errores.push({ isbn: item.isbn, error: 'ISBN inválido' });
        continue;
      }
      const nro = item.nroCliente.trim();
      let m = porCliente.get(nro);
      if (!m) {
        m = new Map();
        porCliente.set(nro, m);
      }
      m.set(isbn, item.cantidad);
    }

    // 2) Resolver nroCliente → clienteId (lookup batch). Los desconocidos se
    //    reportan y se descartan, sin abortar el lote.
    const nros = [...porCliente.keys()];
    const clientePorNro = new Map<string, number>();
    for (const bloque of enBloques(nros, 1000)) {
      const filas = await this.prisma.cliente.findMany({
        where: { nroCliente: { in: bloque } },
        select: { id: true, nroCliente: true },
      });
      for (const f of filas) clientePorNro.set(f.nroCliente, f.id);
    }
    const clientesDesconocidos = nros.filter((n) => !clientePorNro.has(n));

    // 3) Resolver ISBN → productoId (lookup batch) para todos los ISBN del lote.
    const todosIsbn = [
      ...new Set([...porCliente.values()].flatMap((m) => [...m.keys()])),
    ];
    const productoPorIsbn = new Map<string, number>();
    for (const bloque of enBloques(todosIsbn, 1000)) {
      const filas = await this.prisma.productoIsbn.findMany({
        where: { isbn: { in: bloque } },
        select: { isbn: true, productoId: true },
      });
      for (const f of filas) productoPorIsbn.set(f.isbn, f.productoId);
    }

    // 4) Snapshot vigente por cliente (lookup batch, no N+1): para descartar
    //    cargas que llegan fuera de orden (snapshot más viejo que el guardado).
    const idsResueltos = [...clientePorNro.values()];
    const maxSnapshotPorCliente = new Map<number, Date>();
    for (const bloque of enBloques(idsResueltos, 1000)) {
      const grupos = await this.prisma.devConsignacionSaldo.groupBy({
        by: ['clienteId'],
        where: { clienteId: { in: bloque } },
        _max: { snapshotTs: true },
      });
      for (const g of grupos) {
        if (g._max.snapshotTs) maxSnapshotPorCliente.set(g.clienteId, g._max.snapshotTs);
      }
    }

    // 5) Full-replace por cliente, en transacción (idempotente). Cada cliente
    //    debe venir COMPLETO en una carga: el ERP no debe partir un cliente
    //    entre páginas del mismo snapshot (la página 2 borraría la 1).
    let clientes = 0;
    let upserts = 0;
    for (const [nro, saldos] of porCliente) {
      const clienteId = clientePorNro.get(nro);
      if (clienteId === undefined) continue;

      const ultimo = maxSnapshotPorCliente.get(clienteId);
      if (ultimo && ultimo > ts) continue;

      const filas = [...saldos.entries()].map(([isbn, cantidad]) => ({
        clienteId,
        isbn,
        productoId: productoPorIsbn.get(isbn) ?? null,
        cantidad,
        snapshotTs: ts,
      }));

      await this.prisma.$transaction([
        this.prisma.devConsignacionSaldo.deleteMany({ where: { clienteId } }),
        this.prisma.devConsignacionSaldo.createMany({ data: filas }),
      ]);
      clientes++;
      upserts += filas.length;
    }

    return {
      recibidos: items.length,
      clientes,
      upserts,
      clientesDesconocidos,
      errores,
    };
  }

  async saldosDe(clienteId: number, isbns: string[]): Promise<Map<string, number>> {
    const unicos = [...new Set(isbns)];
    const mapa = new Map<string, number>();
    if (unicos.length === 0) return mapa;
    for (const bloque of enBloques(unicos, 1000)) {
      const filas = await this.prisma.devConsignacionSaldo.findMany({
        where: { clienteId, isbn: { in: bloque } },
        select: { isbn: true, cantidad: true },
      });
      for (const f of filas) mapa.set(f.isbn, f.cantidad);
    }
    return mapa;
  }
}
