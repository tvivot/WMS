import { useEffect, useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CredencialAlert, EmptyState, Field, Spinner } from '../components/ui';

interface Cliente {
  id: number;
  nroCliente: string;
  nombre: string;
  activo: boolean;
  primerIngreso: boolean;
}

export function Clientes() {
  const [items, setItems] = useState<Cliente[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ nroCliente: '', nombre: '' });
  const [cred, setCred] = useState<{ titulo: string; clave: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setItems(null);
    api.get<Cliente[]>('/clientes').then(setItems).catch(() => setItems([]));
  };
  useEffect(cargar, []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<Cliente & { claveGenerada: string }>('/clientes', form);
      setCred({ titulo: `Cliente ${r.nroCliente} — clave generada`, clave: r.claveGenerada });
      setForm({ nroCliente: '', nombre: '' });
      setCreando(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const reset = async (c: Cliente) => {
    const r = await api.post<{ claveGenerada: string }>(`/clientes/${c.id}/reset-clave`);
    setCred({ titulo: `Nueva clave de ${c.nroCliente}`, clave: r.claveGenerada });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Clientes</h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Cliente
        </button>
      </div>

      {cred && <CredencialAlert titulo={cred.titulo} clave={cred.clave} onCerrar={() => setCred(null)} />}

      {creando && (
        <Card>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            <Field label="Número de cliente">
              <input className="input w-44" value={form.nroCliente} onChange={(e) => setForm({ ...form, nroCliente: e.target.value })} required />
            </Field>
            <Field label="Nombre">
              <input className="input w-64" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
            </Field>
            <button className="btn-accent" type="submit">Crear</button>
            {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : items.length === 0 ? (
        <EmptyState titulo="Sin clientes" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr><th className="px-4 py-3 font-medium">Nro</th><th className="px-4 py-3 font-medium">Nombre</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium tabnum">{c.nroCliente}</td>
                  <td className="px-4 py-3">{c.nombre}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${c.activo ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {c.activo ? 'Activo' : 'Inactivo'}{c.primerIngreso ? ' · 1er ingreso' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-ghost h-9" onClick={() => reset(c)} title="Resetear clave">
                      <KeyRound className="h-4 w-4" /> Clave
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
