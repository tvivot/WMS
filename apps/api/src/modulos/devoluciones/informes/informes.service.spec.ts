import { InformesService } from './informes.service';

const ISBN_A = '9780306406157';
const ISBN_B = '9783161484100';

/** Fake Prisma en memoria con lo que usan los reportes de consignación. */
function crearFake() {
  const db = {
    saldos: [
      { clienteId: 10, isbn: ISBN_A, productoId: 1, cantidad: 5, snapshotTs: new Date('2026-06-16T02:00:00Z') },
      { clienteId: 10, isbn: ISBN_B, productoId: 2, cantidad: 2, snapshotTs: new Date('2026-06-17T02:00:00Z') },
      { clienteId: 11, isbn: ISBN_A, productoId: 1, cantidad: 9, snapshotTs: new Date('2026-06-17T02:00:00Z') },
      { clienteId: 12, isbn: ISBN_A, productoId: 1, cantidad: 0, snapshotTs: new Date('2026-06-17T02:00:00Z') }, // sin saldo activo
    ],
    clientes: [
      { id: 10, nroCliente: 'C-10', nombre: 'Librería Diez' },
      { id: 11, nroCliente: 'C-11', nombre: 'Anaquel Once' },
    ],
    productos: [
      { id: 1, titulo: 'Libro A', editorial: 'Ed A', imagenUrl: null },
      { id: 2, titulo: 'Libro B', editorial: null, imagenUrl: null },
    ],
  };
  const prisma = {
    devConsignacionSaldo: {
      groupBy: async ({ where }: any) => {
        const activos = db.saldos.filter((s) => (where?.cantidad?.gt !== undefined ? s.cantidad > where.cantidad.gt : true));
        const porCliente = new Map<number, { libros: number; titulos: number }>();
        for (const s of activos) {
          const acc = porCliente.get(s.clienteId) ?? { libros: 0, titulos: 0 };
          acc.libros += s.cantidad;
          acc.titulos += 1;
          porCliente.set(s.clienteId, acc);
        }
        return [...porCliente.entries()].map(([clienteId, v]) => ({
          clienteId,
          _sum: { cantidad: v.libros },
          _count: { _all: v.titulos },
        }));
      },
      findMany: async ({ where }: any) =>
        db.saldos.filter(
          (s) => s.clienteId === where.clienteId && (where.cantidad?.gt !== undefined ? s.cantidad > where.cantidad.gt : true),
        ),
    },
    cliente: {
      findMany: async ({ where }: any) => db.clientes.filter((c) => where.id.in.includes(c.id)),
      findUnique: async ({ where }: any) => db.clientes.find((c) => c.id === where.id) ?? null,
    },
    producto: {
      findMany: async ({ where }: any) => db.productos.filter((p) => where.id.in.includes(p.id)),
    },
  };
  return new InformesService(prisma as never);
}

describe('InformesService — consignación', () => {
  it('lista clientes con consignación activa, ordenados por libros desc', async () => {
    const svc = crearFake();
    const r = await svc.consignacionPorCliente();
    expect(r).toEqual([
      { clienteId: 11, nroCliente: 'C-11', nombre: 'Anaquel Once', titulos: 1, libros: 9 },
      { clienteId: 10, nroCliente: 'C-10', nombre: 'Librería Diez', titulos: 2, libros: 7 },
    ]);
    // El cliente 12 (cantidad 0) NO aparece.
    expect(r.find((c) => c.clienteId === 12)).toBeUndefined();
  });

  it('drill-down: libros que un cliente tiene en consignación, con título y última fecha', async () => {
    const svc = crearFake();
    const d = await svc.consignacionDetalle(10);
    expect(d.cliente).toMatchObject({ nroCliente: 'C-10', nombre: 'Librería Diez' });
    expect(d.totalTitulos).toBe(2);
    expect(d.totalLibros).toBe(7);
    // Ordenado por cantidad desc: A(5) antes que B(2).
    expect(d.items.map((i) => i.isbn)).toEqual([ISBN_A, ISBN_B]);
    expect(d.items[0]).toMatchObject({ titulo: 'Libro A', cantidad: 5 });
    // actualizado = snapshot más reciente entre las filas del cliente.
    expect(new Date(d.actualizado as unknown as string).toISOString()).toBe('2026-06-17T02:00:00.000Z');
  });
});
