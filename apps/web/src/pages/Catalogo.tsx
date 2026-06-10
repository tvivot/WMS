import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { Card, EmptyState, Field, Spinner } from '../components/ui';

interface Producto {
  id: number;
  codigoInterno: string;
  titulo: string;
  editorial: string | null;
  isbns: { isbn: string }[];
}

export function Catalogo() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Producto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ codigoInterno: '', titulo: '', editorial: '', isbns: '' });
  const [error, setError] = useState<string | null>(null);

  const cargar = (busq = q) => {
    setItems(null);
    api
      .get<{ total: number; items: Producto[] }>(`/catalogo/productos?q=${encodeURIComponent(busq)}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => setItems([]));
  };
  useEffect(() => cargar(''), []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/catalogo/productos', {
        codigoInterno: form.codigoInterno,
        titulo: form.titulo,
        editorial: form.editorial || undefined,
        isbns: form.isbns.split(/[\s,]+/).filter(Boolean),
      });
      setForm({ codigoInterno: '', titulo: '', editorial: '', isbns: '' });
      setCreando(false);
      cargar('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Catálogo <span className="text-slate-400 text-base font-normal tabnum">({total})</span></h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Producto
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); cargar(); }} className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
        <input className="input pl-10" placeholder="Buscar por título, código o ISBN…" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>

      {creando && (
        <Card>
          <form onSubmit={crear} className="grid sm:grid-cols-2 gap-3">
            <Field label="Código interno"><input className="input" value={form.codigoInterno} onChange={(e) => setForm({ ...form, codigoInterno: e.target.value })} required /></Field>
            <Field label="Título"><input className="input" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
            <Field label="Editorial"><input className="input" value={form.editorial} onChange={(e) => setForm({ ...form, editorial: e.target.value })} /></Field>
            <Field label="ISBNs (separados por coma/espacio)"><input className="input tabnum" value={form.isbns} onChange={(e) => setForm({ ...form, isbns: e.target.value })} /></Field>
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
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr><th className="px-4 py-3 font-medium">Código</th><th className="px-4 py-3 font-medium">Título</th><th className="px-4 py-3 font-medium">Editorial</th><th className="px-4 py-3 font-medium">ISBNs</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium tabnum">{p.codigoInterno}</td>
                  <td className="px-4 py-3">{p.titulo}</td>
                  <td className="px-4 py-3 text-slate-500">{p.editorial ?? '—'}</td>
                  <td className="px-4 py-3 tabnum text-slate-500">{p.isbns.map((i) => i.isbn).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
