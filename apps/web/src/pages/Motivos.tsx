import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Card, EmptyState, Field, Spinner } from '../components/ui';

interface Motivo {
  id: number;
  modulo: string;
  nombre: string;
  requiereObservacion: boolean;
  activo: boolean;
}

export function Motivos() {
  const [items, setItems] = useState<Motivo[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ nombre: '', modulo: 'devoluciones', requiereObservacion: false });
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setItems(null);
    api.get<Motivo[]>('/motivos/admin').then(setItems).catch(() => setItems([]));
  };
  useEffect(cargar, []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/motivos', {
        nombre: form.nombre,
        modulo: form.modulo || undefined,
        requiereObservacion: form.requiereObservacion,
      });
      setForm({ nombre: '', modulo: 'devoluciones', requiereObservacion: false });
      setCreando(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const patch = async (m: Motivo, data: Partial<Pick<Motivo, 'activo' | 'requiereObservacion'>>) => {
    setError(null);
    try {
      await api.put(`/motivos/${m.id}`, data);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Motivos de devolución</h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Motivo
        </button>
      </div>

      <p className="text-sm text-slate-500">
        Los motivos se eligen al crear una devolución (obligatorio). Marcá “Exige observación”
        para los que necesiten un detalle escrito (como “Otro”).
      </p>

      {error && !creando && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg" role="alert">{error}</p>
      )}

      {creando && (
        <Card>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            <Field label="Nombre">
              <input className="input w-72" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required minLength={2} maxLength={120} />
            </Field>
            <Field label="Módulo">
              <input className="input w-44" value={form.modulo} onChange={(e) => setForm({ ...form, modulo: e.target.value })} maxLength={40} />
            </Field>
            <label className="flex items-center gap-2 text-sm h-10 select-none cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-green-ink"
                checked={form.requiereObservacion}
                onChange={(e) => setForm({ ...form, requiereObservacion: e.target.checked })}
              />
              Exige observación
            </label>
            <button className="btn-accent" type="submit">Crear</button>
            {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : items.length === 0 ? (
        <EmptyState titulo="Sin motivos" sub="Cargá al menos uno: se elige al crear cada devolución." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Módulo</th>
                <th className="px-4 py-3 font-medium">Exige observación</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{m.nombre}</td>
                  <td className="px-4 py-3 text-slate-500">{m.modulo}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => patch(m, { requiereObservacion: !m.requiereObservacion })}
                      title="Clic para cambiar si este motivo exige cargar una observación"
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold cursor-pointer transition-colors ${
                        m.requiereObservacion
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {m.requiereObservacion ? 'Sí' : 'No'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => patch(m, { activo: !m.activo })}
                      title={m.activo ? 'Clic para desactivar (deja de ofrecerse al crear)' : 'Clic para reactivar'}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold cursor-pointer transition-colors ${
                        m.activo
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${m.activo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      {m.activo ? 'Activo' : 'Inactivo'}
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
