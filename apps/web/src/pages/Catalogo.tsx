import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Plus, Search, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '../lib/api';
import { Card, EmptyState, Field, Spinner } from '../components/ui';
import { DataGrid } from '../components/grilla/DataGrid';

interface Producto {
  id: number;
  codigoInterno: string;
  codigoFierro: string | null;
  titulo: string;
  editorial: string | null;
  imagenUrl: string | null;
  isbns: { isbn: string }[];
}

const PAGINA = 50;

export function Catalogo() {
  const [items, setItems] = useState<Producto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ isbn: '', titulo: '', editorial: '', codigoFierro: '' });
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<number | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // Búsqueda SERVER-SIDE: una página por request, filtrada por la API (índices
  // FULLTEXT/B-tree). Ya no se baja todo el catálogo al navegador.
  const cargar = async (busqueda: string, pag: number) => {
    setItems(null);
    try {
      const qs = busqueda.trim() ? `&q=${encodeURIComponent(busqueda.trim())}` : '';
      const r = await api.get<{ total: number; items: Producto[] }>(
        `/catalogo/productos?skip=${pag * PAGINA}&take=${PAGINA}${qs}`,
      );
      setItems(r.items);
      setTotal(r.total);
    } catch {
      setItems([]);
      setTotal(0);
    }
  };

  // Debounce de la búsqueda: vuelve a página 0 y consulta tras 300ms sin tipear.
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setPage(0);
      void cargar(q, 0);
    }, 300);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const irAPagina = (n: number) => {
    setPage(n);
    void cargar(q, n);
  };

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      // El ISBN actúa como código interno; el backend lo deriva del ISBN.
      await api.post('/catalogo/productos', {
        titulo: form.titulo,
        editorial: form.editorial || undefined,
        codigoFierro: form.codigoFierro.trim() || undefined,
        isbns: form.isbn.split(/[\s,]+/).filter(Boolean),
      });
      setForm({ isbn: '', titulo: '', editorial: '', codigoFierro: '' });
      setCreando(false);
      void cargar(q, page);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const subirImagen = async (id: number, file: File) => {
    setError(null);
    setSubiendo(id);
    try {
      const fd = new FormData();
      fd.append('imagen', file);
      await api.upload(`/catalogo/productos/${id}/imagen`, fd);
      await cargar(q, page);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(null);
    }
  };

  const columnas = useMemo<ColumnDef<Producto, unknown>[]>(
    () => [
      {
        id: 'portada',
        header: 'Portada',
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original;
          const cargando = subiendo === p.id;
          return (
            <label
              className="group relative flex h-16 w-12 cursor-pointer items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 hover:border-brand-green-ink"
              title={p.imagenUrl ? 'Cambiar portada' : 'Subir portada'}
            >
              {p.imagenUrl ? (
                <img src={p.imagenUrl} alt={p.titulo} className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="h-5 w-5 text-slate-400 group-hover:text-brand-green-ink" />
              )}
              {cargando && (
                <span className="absolute inset-0 flex items-center justify-center bg-white/70">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                </span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={cargando}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subirImagen(p.id, f);
                  e.target.value = '';
                }}
              />
            </label>
          );
        },
      },
      {
        id: 'isbn',
        header: 'ISBN',
        accessorFn: (p) => p.isbns.map((i) => i.isbn).join(' '),
        cell: ({ row }) => (
          <span className="tabnum">{row.original.isbns.map((i) => i.isbn).join(', ') || '—'}</span>
        ),
      },
      {
        id: 'codigoFierro',
        header: 'Cód. Fierro',
        accessorFn: (p) => p.codigoFierro ?? '',
        cell: ({ row }) => (
          <span className="tabnum text-slate-500">{row.original.codigoFierro ?? '—'}</span>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subiendo],
  );

  const totalPaginas = Math.max(1, Math.ceil(total / PAGINA));
  const desde = total === 0 ? 0 : page * PAGINA + 1;
  const hasta = Math.min((page + 1) * PAGINA, total);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Catálogo{' '}
          <span className="text-slate-400 text-base font-normal tabnum">({total})</span>
        </h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Producto
        </button>
      </div>

      {/* Buscador server-side: título (por palabra), ISBN o código (por prefijo). */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          className="input pl-9 pr-9"
          placeholder="Buscar por título, ISBN, código o cód. Fierro…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            onClick={() => setQ('')}
            title="Limpiar búsqueda"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {creando && (
        <Card>
          <form onSubmit={crear} className="grid sm:grid-cols-2 gap-3">
            <Field label="ISBN"><input className="input tabnum" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} required /></Field>
            <Field label="Título"><input className="input" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
            <Field label="Editorial"><input className="input" value={form.editorial} onChange={(e) => setForm({ ...form, editorial: e.target.value })} /></Field>
            <Field label="Cód. Fierro (ERP)"><input className="input tabnum" value={form.codigoFierro} onChange={(e) => setForm({ ...form, codigoFierro: e.target.value })} placeholder="Opcional" /></Field>
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
        <EmptyState titulo="Sin productos" sub={q ? 'Probá con otra búsqueda.' : 'Cargá productos para empezar.'} />
      ) : (
        <>
          <DataGrid data={items} columns={columnas} storageKey="catalogo" paginar={false} />
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span className="tabnum">
              {desde}–{hasta} de {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="btn-ghost h-9 disabled:opacity-40"
                onClick={() => irAPagina(page - 1)}
                disabled={page <= 0}
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </button>
              <span className="tabnum">{page + 1} / {totalPaginas}</span>
              <button
                className="btn-ghost h-9 disabled:opacity-40"
                onClick={() => irAPagina(page + 1)}
                disabled={page + 1 >= totalPaginas}
              >
                Siguiente <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
