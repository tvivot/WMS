import { PrismaLoteAdapter } from './lote.adapter';
import type { LoteImport } from './lote.port';

type Fila = Record<string, any>;

// ISBN-13 válidos (pasan checksum de normalizarIsbn): se normalizan a sí mismos.
const ISBN_A = '9780131103627';
const ISBN_B = '9783161484100';

function fakePrisma() {
  let seq = 1;
  const db = { lotes: [] as Fila[], items: [] as Fila[] };
  const tx = {
    devLote: {
      upsert: async ({ where, create, update }: any) => {
        const existente = db.lotes.find((x) => x.codigo === where.codigo);
        if (existente) {
          Object.assign(existente, update);
          return { id: existente.id };
        }
        const nuevo: Fila = { id: seq++, codigo: where.codigo, ...create };
        db.lotes.push(nuevo);
        return { id: nuevo.id };
      },
    },
    devLoteItem: {
      deleteMany: async ({ where }: any) => {
        db.items = db.items.filter((i) => i.loteId !== where.loteId);
        return { count: 0 };
      },
      createMany: async ({ data }: any) => {
        for (const d of data) db.items.push({ ...d });
        return { count: data.length };
      },
    },
  };
  const prisma = {
    devLote: {
      findMany: async ({ where }: any) =>
        db.lotes
          .filter((l) => where.codigo.in.includes(l.codigo))
          .map((l) => ({ codigo: l.codigo })),
    },
    $transaction: async (fn: any) => fn(tx),
  };
  return { prisma, db };
}

function lote(over: Partial<LoteImport> = {}): LoteImport {
  return {
    codigo: 'L1',
    nroCliente: '1001',
    items: [{ isbn: ISBN_A, cantidad: 3 }],
    ...over,
  };
}

describe('PrismaLoteAdapter.importarLotes', () => {
  it('crea un lote nuevo con sus renglones', async () => {
    const { prisma, db } = fakePrisma();
    const svc = new PrismaLoteAdapter(prisma as any);
    const r = await svc.importarLotes([
      lote({ items: [{ isbn: ISBN_A, cantidad: 3 }, { isbn: ISBN_B, cantidad: 5 }] }),
    ]);
    expect(r).toMatchObject({ recibidos: 1, creados: 1, actualizados: 0, errores: [] });
    expect(db.lotes).toHaveLength(1);
    expect(db.items).toHaveLength(2);
  });

  it('reimportar el mismo codigo actualiza y REEMPLAZA los renglones (idempotente)', async () => {
    const { prisma, db } = fakePrisma();
    const svc = new PrismaLoteAdapter(prisma as any);
    await svc.importarLotes([lote({ items: [{ isbn: ISBN_A, cantidad: 3 }] })]);
    const r = await svc.importarLotes([lote({ items: [{ isbn: ISBN_B, cantidad: 9 }] })]);
    expect(r).toMatchObject({ creados: 0, actualizados: 1 });
    expect(db.lotes).toHaveLength(1); // mismo lote
    expect(db.items).toHaveLength(1); // reemplazado
    expect(db.items[0]).toMatchObject({ isbn: ISBN_B, cantidad: 9 });
  });

  it('dedup de renglones por ISBN dentro del lote (última fila gana)', async () => {
    const { prisma, db } = fakePrisma();
    const svc = new PrismaLoteAdapter(prisma as any);
    await svc.importarLotes([
      lote({ items: [{ isbn: ISBN_A, cantidad: 3 }, { isbn: ISBN_A, cantidad: 7 }] }),
    ]);
    expect(db.items).toHaveLength(1);
    expect(db.items[0].cantidad).toBe(7);
  });

  it('ISBN inválido: reporta error y descarta el renglón, sin abortar el lote', async () => {
    const { prisma, db } = fakePrisma();
    const svc = new PrismaLoteAdapter(prisma as any);
    const r = await svc.importarLotes([
      lote({ items: [{ isbn: 'no-isbn', cantidad: 1 }, { isbn: ISBN_A, cantidad: 2 }] }),
    ]);
    expect(r.creados).toBe(1);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].error).toContain('ISBN inválido');
    expect(db.items).toHaveLength(1); // solo el válido
  });

  it('nroCliente vacío se reporta en errores y no crea lote', async () => {
    const { prisma, db } = fakePrisma();
    const svc = new PrismaLoteAdapter(prisma as any);
    const r = await svc.importarLotes([lote({ nroCliente: '  ' })]);
    expect(r.creados).toBe(0);
    expect(r.errores[0].error).toContain('nroCliente vacío');
    expect(db.lotes).toHaveLength(0);
  });

  it('codigo vacío se reporta en errores y no crea lote', async () => {
    const { prisma, db } = fakePrisma();
    const svc = new PrismaLoteAdapter(prisma as any);
    const r = await svc.importarLotes([lote({ codigo: '  ' })]);
    expect(r.creados).toBe(0);
    expect(r.errores[0].error).toContain('codigo vacío');
    expect(db.lotes).toHaveLength(0);
  });

  it('dedup por codigo dentro del batch (última cabecera gana)', async () => {
    const { prisma, db } = fakePrisma();
    const svc = new PrismaLoteAdapter(prisma as any);
    const r = await svc.importarLotes([
      lote({ codigo: 'L9', items: [{ isbn: ISBN_A, cantidad: 1 }] }),
      lote({ codigo: 'L9', items: [{ isbn: ISBN_B, cantidad: 2 }] }),
    ]);
    expect(r.creados).toBe(1);
    expect(db.lotes).toHaveLength(1);
    expect(db.items).toHaveLength(1);
    expect(db.items[0]).toMatchObject({ isbn: ISBN_B, cantidad: 2 });
  });
});
