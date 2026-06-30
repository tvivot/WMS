import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizarIsbn } from '../../../core/catalogo/isbn.util';
import { enBloques } from '../../../core/util/bloques';
import type {
  DevolucionesLotePort,
  LoteImport,
  LoteImportResultado,
} from './lote.port';

/**
 * Implementación del puerto de lotes contra dev_lote / dev_lote_item. Upsert por
 * `codigo`, idempotente, reemplazando los renglones del lote. Normaliza ISBN y
 * deduplica renglones por ISBN (la última fila gana) para respetar el UNIQUE
 * (lote_id, isbn). Las cabeceras inválidas/los ISBN inválidos se reportan en
 * `errores` sin abortar el resto del lote ni del batch.
 */
@Injectable()
export class PrismaLoteAdapter implements DevolucionesLotePort {
  constructor(private readonly prisma: PrismaService) {}

  async importarLotes(lotes: LoteImport[]): Promise<LoteImportResultado> {
    const errores: { codigo: string; error: string }[] = [];

    // 1) Dedup por codigo dentro del batch (la última cabecera gana): evita
    //    procesar dos veces el mismo lote en una sola carga.
    const porCodigo = new Map<string, LoteImport>();
    for (const lote of lotes) {
      const codigo = lote.codigo?.trim();
      if (!codigo) {
        errores.push({ codigo: lote.codigo ?? '(vacío)', error: 'codigo vacío' });
        continue;
      }
      porCodigo.set(codigo, lote);
    }

    // 2) Cuáles ya existen (lookup batch) para contar creados vs actualizados.
    const codigos = [...porCodigo.keys()];
    const existentes = new Set<string>();
    for (const bloque of enBloques(codigos, 1000)) {
      const filas = await this.prisma.devLote.findMany({
        where: { codigo: { in: bloque } },
        select: { codigo: true },
      });
      for (const f of filas) existentes.add(f.codigo);
    }

    // 3) Upsert por lote + replace de renglones, cada uno en su transacción
    //    (un lote que falla no tumba a los demás).
    let creados = 0;
    let actualizados = 0;
    for (const [codigo, lote] of porCodigo) {
      try {
        const nroCliente = lote.nroCliente?.trim();
        if (!nroCliente) {
          errores.push({ codigo, error: 'nroCliente vacío' });
          continue;
        }
        const items = this.normalizarItems(codigo, lote, errores);
        const cabecera = {
          numero: lote.numero ?? null,
          fecha: lote.fecha ?? null,
          nroCliente,
          clienteNombre: lote.clienteNombre ?? null,
          deposito: lote.deposito ?? null,
          estado: lote.estado ?? null,
          motivo: lote.motivo ?? null,
          remitoCliente: lote.remitoCliente ?? null,
          fechaRemitoCliente: lote.fechaRemitoCliente ?? null,
          totalItems: lote.totalItems ?? null,
        };

        await this.prisma.$transaction(async (tx) => {
          const fila = await tx.devLote.upsert({
            where: { codigo },
            create: { codigo, ...cabecera },
            update: cabecera,
            select: { id: true },
          });
          await tx.devLoteItem.deleteMany({ where: { loteId: fila.id } });
          if (items.length > 0) {
            await tx.devLoteItem.createMany({
              data: items.map((i) => ({ loteId: fila.id, ...i })),
            });
          }
        });

        if (existentes.has(codigo)) actualizados++;
        else creados++;
      } catch (err) {
        errores.push({ codigo, error: (err as Error).message });
      }
    }

    return { recibidos: lotes.length, creados, actualizados, errores };
  }

  /**
   * Normaliza ISBN y deduplica los renglones por ISBN (última fila gana). Los
   * ISBN inválidos se reportan en `errores` y se descartan (no abortan el lote).
   */
  private normalizarItems(
    codigo: string,
    lote: LoteImport,
    errores: { codigo: string; error: string }[],
  ) {
    const porIsbn = new Map<
      string,
      {
        isbn: string;
        cantidad: number;
        cantidadCliente: number | null;
        cantidadRechazada: number | null;
        titulo: string | null;
        intCode: string | null;
      }
    >();
    for (const item of lote.items ?? []) {
      const isbn = normalizarIsbn(item.isbn);
      if (!isbn) {
        errores.push({ codigo, error: `ISBN inválido: ${item.isbn}` });
        continue;
      }
      porIsbn.set(isbn, {
        isbn,
        cantidad: item.cantidad,
        cantidadCliente: item.cantidadCliente ?? null,
        cantidadRechazada: item.cantidadRechazada ?? null,
        titulo: item.titulo ?? null,
        intCode: item.intCode ?? null,
      });
    }
    return [...porIsbn.values()];
  }
}
