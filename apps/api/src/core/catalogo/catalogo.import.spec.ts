import { CatalogoService } from './catalogo.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Tests del import masivo del catálogo (integrador) sobre un Prisma fake en
 * memoria: upsert por ISBN, idempotencia, ISBN inválido no aborta el lote,
 * código interno derivado del ISBN.
 */

// ISBNs reales (checksum válido)
const ISBN_A = '9780306406157';
const ISBN_B = '9783161484100';
const ISBN_A_CON_GUIONES = '978-0-306-40615-7'; // mismo que ISBN_A normalizado

interface ProdRow {
  id: number;
  codigoInterno: string;
  titulo: string;
  editorial: string | null;
}
interface IsbnRow {
  isbn: string;
  productoId: number;
}

function crearFakePrisma() {
  let seq = 1;
  const productos: ProdRow[] = [];
  const isbns: IsbnRow[] = [];

  const enLista = (valor: string, inList?: string[]) => !inList || inList.includes(valor);

  const prisma = {
    // El import batch ejecuta los updates dentro de $transaction([...]): el fake
    // solo necesita esperar las promesas (los métodos ya mutan el estado).
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    productoIsbn: {
      findMany: async ({ where }: { where?: { isbn?: { in?: string[] } } }) =>
        isbns
          .filter((i) => enLista(i.isbn, where?.isbn?.in))
          .map((i) => ({ isbn: i.isbn, productoId: i.productoId })),
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: IsbnRow[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of data) {
          if (skipDuplicates && isbns.some((i) => i.isbn === d.isbn)) continue;
          isbns.push({ isbn: d.isbn, productoId: d.productoId });
          count++;
        }
        return { count };
      },
    },
    producto: {
      update: async ({
        where: { id },
        data,
      }: {
        where: { id: number };
        data: Partial<ProdRow>;
      }) => {
        const p = productos.find((x) => x.id === id);
        if (!p) throw new Error('Record not found');
        Object.assign(p, data);
        return p;
      },
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Omit<ProdRow, 'id'>[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of data) {
          if (skipDuplicates && productos.some((x) => x.codigoInterno === d.codigoInterno)) continue;
          productos.push({ id: seq++, ...d, editorial: d.editorial ?? null });
          count++;
        }
        return { count };
      },
      findMany: async ({ where }: { where?: { codigoInterno?: { in?: string[] } } }) =>
        productos
          .filter((p) => enLista(p.codigoInterno, where?.codigoInterno?.in))
          .map((p) => ({ id: p.id, codigoInterno: p.codigoInterno })),
    },
    _state: { productos, isbns },
  };
  return prisma as unknown as PrismaService & {
    _state: { productos: ProdRow[]; isbns: IsbnRow[] };
  };
}

describe('CatalogoService.importarProductos', () => {
  it('crea productos nuevos usando el ISBN como código interno', async () => {
    const prisma = crearFakePrisma();
    const svc = new CatalogoService(prisma);

    const r = await svc.importarProductos([
      { isbn: ISBN_A, titulo: 'Libro A', editorial: 'Edit A' },
      { isbn: ISBN_B, titulo: 'Libro B' },
    ]);

    expect(r).toEqual({ recibidos: 2, creados: 2, actualizados: 0, errores: [] });
    expect(prisma._state.productos).toHaveLength(2);
    expect(prisma._state.productos[0].codigoInterno).toBe(ISBN_A);
    expect(prisma._state.productos[0].editorial).toBe('Edit A');
    expect(prisma._state.productos[1].editorial).toBeNull();
    expect(prisma._state.isbns.map((i) => i.isbn).sort()).toEqual(
      [ISBN_A, ISBN_B].sort(),
    );
  });

  it('es idempotente: reenviar el mismo lote actualiza, no duplica', async () => {
    const prisma = crearFakePrisma();
    const svc = new CatalogoService(prisma);

    await svc.importarProductos([{ isbn: ISBN_A, titulo: 'Libro A' }]);
    const r = await svc.importarProductos([
      { isbn: ISBN_A_CON_GUIONES, titulo: 'Libro A (corregido)', editorial: 'Nueva' },
    ]);

    expect(r).toEqual({ recibidos: 1, creados: 0, actualizados: 1, errores: [] });
    expect(prisma._state.productos).toHaveLength(1);
    expect(prisma._state.isbns).toHaveLength(1);
    expect(prisma._state.productos[0].titulo).toBe('Libro A (corregido)');
    expect(prisma._state.productos[0].editorial).toBe('Nueva');
  });

  it('no infla "creados" cuando el código interno ya existía suelto (sin vínculo ISBN)', async () => {
    const prisma = crearFakePrisma();
    // Producto preexistente con codigoInterno = ISBN_A pero SIN fila en productoIsbn.
    prisma._state.productos.push({
      id: 99,
      codigoInterno: ISBN_A,
      titulo: 'Viejo',
      editorial: null,
    });
    const svc = new CatalogoService(prisma);

    const r = await svc.importarProductos([
      { isbn: ISBN_A, titulo: 'Libro A' }, // ya existe el código → createMany lo saltea
      { isbn: ISBN_B, titulo: 'Libro B' }, // este sí es alta real
    ]);

    // Solo ISBN_B es alta real; ISBN_A se cuenta como 0 creados (antes daba 2).
    expect(r.creados).toBe(1);
    expect(prisma._state.productos).toHaveLength(2);
    // El ISBN_A suelto queda igualmente vinculado a su producto preexistente.
    expect(prisma._state.isbns.map((i) => i.isbn).sort()).toEqual([ISBN_A, ISBN_B].sort());
  });

  it('una fila con ISBN inválido no aborta el lote', async () => {
    const prisma = crearFakePrisma();
    const svc = new CatalogoService(prisma);

    const r = await svc.importarProductos([
      { isbn: ISBN_A, titulo: 'Libro A' },
      { isbn: '123', titulo: 'Basura' },
      { isbn: ISBN_B, titulo: 'Libro B' },
    ]);

    expect(r.recibidos).toBe(3);
    expect(r.creados).toBe(2);
    expect(r.errores).toEqual([{ isbn: '123', error: 'ISBN inválido' }]);
    expect(prisma._state.productos).toHaveLength(2);
  });
});
