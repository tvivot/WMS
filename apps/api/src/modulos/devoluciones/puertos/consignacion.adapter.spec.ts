import { PrismaConsignacionAdapter } from './consignacion.adapter';

const ISBN_A = '9780306406157';
const ISBN_B = '9783161484100';

/** Fake Prisma en memoria (solo lo que usa el adapter). */
function crearFakePrisma() {
  let seq = 1;
  const db = {
    clientes: [
      { id: 10, nroCliente: 'C-10' },
      { id: 11, nroCliente: 'C-11' },
    ] as Array<{ id: number; nroCliente: string }>,
    isbns: [
      { isbn: ISBN_A, productoId: 1 },
      { isbn: ISBN_B, productoId: 2 },
    ] as Array<{ isbn: string; productoId: number }>,
    saldos: [] as Array<Record<string, unknown> & { id: number }>,
  };
  const prisma = {
    cliente: {
      findMany: async ({ where }: any) =>
        db.clientes.filter((c) => where.nroCliente.in.includes(c.nroCliente)).map((x) => ({ ...x })),
    },
    productoIsbn: {
      findMany: async ({ where }: any) =>
        db.isbns.filter((p) => where.isbn.in.includes(p.isbn)).map((x) => ({ ...x })),
    },
    devConsignacionSaldo: {
      groupBy: async ({ where }: any) => {
        const ids: number[] = where.clienteId.in;
        const out: Array<{ clienteId: number; _max: { snapshotTs: Date | null } }> = [];
        for (const clienteId of ids) {
          const filas = db.saldos.filter((s) => s.clienteId === clienteId);
          if (filas.length === 0) continue;
          const max = filas.reduce(
            (acc: any, s: any) => (s.snapshotTs > acc ? s.snapshotTs : acc),
            filas[0].snapshotTs,
          );
          out.push({ clienteId, _max: { snapshotTs: max as Date } });
        }
        return out;
      },
      deleteMany: async ({ where }: any) => {
        db.saldos = db.saldos.filter((s) => s.clienteId !== where.clienteId);
      },
      createMany: async ({ data }: any) => {
        for (const d of data) db.saldos.push({ id: seq++, ...d });
      },
      findMany: async ({ where }: any) =>
        db.saldos
          .filter((s) => s.clienteId === where.clienteId && where.isbn.in.includes(s.isbn))
          .map((x) => ({ ...x })),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { prisma, db };
}

const TS1 = '2026-06-16T02:00:00.000Z';
const TS2 = '2026-06-17T02:00:00.000Z';

describe('PrismaConsignacionAdapter', () => {
  it('carga el snapshot resolviendo cliente e ISBN', async () => {
    const { prisma, db } = crearFakePrisma();
    const a = new PrismaConsignacionAdapter(prisma as never);
    const res = await a.cargarSaldos(TS2, [
      { nroCliente: 'C-10', isbn: ISBN_A, cantidad: 5 },
      { nroCliente: 'C-10', isbn: ISBN_B, cantidad: 2 },
    ]);
    expect(res).toMatchObject({ recibidos: 2, clientes: 1, upserts: 2, clientesDesconocidos: [] });
    expect(db.saldos).toHaveLength(2);
    expect(db.saldos.find((s) => s.isbn === ISBN_A)).toMatchObject({ clienteId: 10, productoId: 1, cantidad: 5 });
  });

  it('es idempotente: reenviar el mismo snapshot deja la tabla igual', async () => {
    const { prisma, db } = crearFakePrisma();
    const a = new PrismaConsignacionAdapter(prisma as never);
    const items = [{ nroCliente: 'C-10', isbn: ISBN_A, cantidad: 5 }];
    await a.cargarSaldos(TS2, items);
    await a.cargarSaldos(TS2, items);
    expect(db.saldos).toHaveLength(1);
    expect(db.saldos[0]).toMatchObject({ clienteId: 10, cantidad: 5 });
  });

  it('reemplaza (full-replace) los saldos previos del cliente', async () => {
    const { prisma, db } = crearFakePrisma();
    const a = new PrismaConsignacionAdapter(prisma as never);
    await a.cargarSaldos(TS1, [
      { nroCliente: 'C-10', isbn: ISBN_A, cantidad: 5 },
      { nroCliente: 'C-10', isbn: ISBN_B, cantidad: 2 },
    ]);
    await a.cargarSaldos(TS2, [{ nroCliente: 'C-10', isbn: ISBN_A, cantidad: 9 }]);
    expect(db.saldos).toHaveLength(1);
    expect(db.saldos[0]).toMatchObject({ isbn: ISBN_A, cantidad: 9 });
  });

  it('reporta clientes desconocidos sin abortar', async () => {
    const { prisma, db } = crearFakePrisma();
    const a = new PrismaConsignacionAdapter(prisma as never);
    const res = await a.cargarSaldos(TS2, [
      { nroCliente: 'C-99', isbn: ISBN_A, cantidad: 1 },
      { nroCliente: 'C-10', isbn: ISBN_B, cantidad: 3 },
    ]);
    expect(res.clientesDesconocidos).toEqual(['C-99']);
    expect(res.clientes).toBe(1);
    expect(db.saldos).toHaveLength(1);
  });

  it('reporta ISBN inválido en errores y descarta la fila', async () => {
    const { prisma } = crearFakePrisma();
    const a = new PrismaConsignacionAdapter(prisma as never);
    const res = await a.cargarSaldos(TS2, [{ nroCliente: 'C-10', isbn: 'no-isbn', cantidad: 1 }]);
    expect(res.errores).toEqual([{ isbn: 'no-isbn', error: 'ISBN inválido' }]);
    expect(res.upserts).toBe(0);
  });

  it('descarta un snapshot más viejo que el último cargado', async () => {
    const { prisma, db } = crearFakePrisma();
    const a = new PrismaConsignacionAdapter(prisma as never);
    await a.cargarSaldos(TS2, [{ nroCliente: 'C-10', isbn: ISBN_A, cantidad: 9 }]);
    await a.cargarSaldos(TS1, [{ nroCliente: 'C-10', isbn: ISBN_A, cantidad: 1 }]);
    expect(db.saldos[0]).toMatchObject({ cantidad: 9 });
  });

  it('saldosDe devuelve el mapa por ISBN para el cliente', async () => {
    const { prisma } = crearFakePrisma();
    const a = new PrismaConsignacionAdapter(prisma as never);
    await a.cargarSaldos(TS2, [
      { nroCliente: 'C-10', isbn: ISBN_A, cantidad: 5 },
      { nroCliente: 'C-11', isbn: ISBN_A, cantidad: 7 },
    ]);
    const mapa = await a.saldosDe(10, [ISBN_A, ISBN_B]);
    expect(mapa.get(ISBN_A)).toBe(5);
    expect(mapa.has(ISBN_B)).toBe(false);
  });
});
