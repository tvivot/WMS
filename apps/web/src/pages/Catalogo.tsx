import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '../lib/api';
import { Card, EmptyState, Field, Spinner } from '../components/ui';
import { DataGrid } from '../components/grilla/DataGrid';

interface Producto {
  id: number;
  codigoInterno: string;
  titulo: string;
  editorial: string | null;
  isbns: { isbn: string }[];
}

const PAGINA = 500;

export function Catalogo() {
  const [items, setItems] = useState<Producto[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ isbn: '', titulo: '', editorial: '' });
  const [error, setError] = useState<string | null>(null);

  // Carga todo el catálogo (paginando la API) para ordenar/paginar/buscar en
  // la grilla del lado del cliente, igual que el resto de las grillas.
  const cargar = async () => {
    setItems(null);
    try {
      const acumulado: Producto[] = [];
      let skip = 0;
      let total = Infinity;
      while (acumulado.length < total) {
        const r = await api.get<{ total: number; items: Producto[] }>(
          `/catalogo/productos?skip=${skip}&take=${PAGINA}`,
        );
        total = r.total;
        acumulado.push(...r.items);
        if (r.items.length < PAGINA) break;
        skip += PAGINA;
      }
      setItems(acumulado);
    } catch {
      setItems([]);
    }
  };
  useEffect(() => { void cargar(); }, []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      // El ISBN actúa como código interno; el backend lo deriva del ISBN.
      await api.post('/catalogo/productos', {
        titulo: form.titulo,
        editorial: form.editorial || undefined,
        isbns: form.isbn.split(/[\s,]+/).filter(Boolean),
      });
      setForm({ isbn: '', titulo: '', editorial: '' });
      setCreando(false);
      void cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const columnas = useMemo<ColumnDef<Producto, unknown>[]>(
    () => [
      {
        id: 'isbn',
        header: 'ISBN',
        accessorFn: (p) => p.isbns.map((i) => i.isbn).join(' '),
        cell: ({ row }) => (
          <span className="tabnum">{row.original.isbns.map((i) => i.isbn).join(', ') || '—'}</span>
        ),
      },
      { id: 'titulo', header: 'Título', accessorKey: 'titulo' },
      {
        id: 'editorial',
        header: 'Editorial',
        accessorFn: (p) => p.editorial ?? '',
        cell: ({ row }) => <span className="text-slate-500">{row.original.editorial ?? '—'}</span>,
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Catálogo{' '}
          <span className="text-slate-400 text-base font-normal tabnum">
            ({items?.length ?? 0})
          </span>
        </h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Producto
        </button>
      </div>

      {creando && (
        <Card>
          <form onSubmit={crear} className="grid sm:grid-cols-2 gap-3">
            <Field label="ISBN"><input className="input tabnum" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} required /></Field>
            <Field label="Título"><input className="input" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
            <Field label="Editorial"><input className="input" value={form.editorial} onChange={(e) => setForm({ ...form, editorial: e.target.value })} /></Field>
            <div className="sm:col-span-2 flex gap-3">
              <button className="btn-accent" type="submit">Guardar</button>
              {error && <p className="text-sm text-red-600 self-center">{error}</p>}
            </div>
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : items.length === 0 ? (
        <EmptyState titulo="Sin productos" sub="Cargá productos o ajustá la búsqueda." />
      ) : (
        <DataGrid data={items} columns={columnas} storageKey="catalogo" buscar="Buscar por título, editorial o ISBN…" />
      )}
    </div>
  );
}
