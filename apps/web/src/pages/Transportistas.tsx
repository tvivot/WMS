import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Card, EmptyState, Field, Spinner } from '../components/ui';

interface Transportista {
  id: number;
  nombre: string;
  contacto: string | null;
  activo: boolean;
}

export function Transportistas() {
  const [items, setItems] = useState<Transportista[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ nombre: '', contacto: '' });
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setItems(null);
    api.get<Transportista[]>('/transportistas/admin').then(setItems).catch(() => setItems([]));
  };
  useEffect(cargar, []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/transportistas', {
        nombre: form.nombre,
        contacto: form.contacto || undefined,
      });
      setForm({ nombre: '', contacto: '' });
      setCreando(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleActivo = async (t: Transportista) => {
    setError(null);
    try {
      await api.put(`/transportistas/${t.id}`, { activo: !t.activo });
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Transportistas</h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Transportista
        </button>
      </div>

      {error && !creando && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg" role="alert">{error}</p>
      )}

      {creando && (
        <Card>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            <Field label="Nombre">
              <input className="input w-64" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required minLength={2} />
            </Field>
            <Field label="Contacto (teléfono / email)">
              <input className="input w-72" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
            </Field>
            <button className="btn-accent" type="submit">Crear</button>
            {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : items.length === 0 ? (
        <EmptyState titulo="Sin transportistas" sub="Cargá al menos uno: el cliente lo elige al despachar su devolución." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Contacto</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{t.nombre}</td>
                  <td className="px-4 py-3 text-slate-500">{t.contacto ?? '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActivo(t)}
                      title={t.activo ? 'Clic para desactivar (deja de ofrecerse al declarar)' : 'Clic para reactivar'}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold cursor-pointer transition-colors ${
                        t.activo
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${t.activo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      {t.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
