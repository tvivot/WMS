import { useEffect, useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Card, ClaveDialog, CredencialAlert, EmptyState, Field, Spinner } from '../components/ui';

interface Cliente {
  id: number;
  nroCliente: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
  primerIngreso: boolean;
}

export function Clientes() {
  const [items, setItems] = useState<Cliente[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ nroCliente: '', nombre: '', direccion: '', clave: '' });
  const [cred, setCred] = useState<{ titulo: string; clave: string } | null>(null);
  const [reseteando, setReseteando] = useState<Cliente | null>(null);
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
      const r = await api.post<Cliente & { claveGenerada: string }>('/clientes', {
        nroCliente: form.nroCliente,
        nombre: form.nombre,
        direccion: form.direccion || undefined,
        clave: form.clave.trim() || undefined,
      });
      setCred({ titulo: `Cliente ${r.nroCliente} — clave de acceso`, clave: r.claveGenerada });
      setForm({ nroCliente: '', nombre: '', direccion: '', clave: '' });
      setCreando(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const reset = async (c: Cliente, clave?: string) => {
    const r = await api.post<{ claveGenerada: string }>(`/clientes/${c.id}/reset-clave`, clave ? { clave } : {});
    setCred({ titulo: `Nueva clave de ${c.nroCliente}`, clave: r.claveGenerada });
    setReseteando(null);
    cargar();
  };

  const toggleActivo = async (c: Cliente) => {
    setError(null);
    try {
      await api.put(`/clientes/${c.id}`, { activo: !c.activo });
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
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
      {error && !creando && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg" role="alert">{error}</p>
      )}

      {creando && (
        <Card>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            <Field label="Número de cliente">
              <input className="input w-44" value={form.nroCliente} onChange={(e) => setForm({ ...form, nroCliente: e.target.value })} required />
            </Field>
            <Field label="Nombre">
              <input className="input w-64" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
            </Field>
            <Field label="Dirección">
              <input className="input w-72" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
            </Field>
            <Field label="Clave (opcional)" hint="Vacío = se genera automática. Si la escribís, queda definitiva (mín. 8).">
              <input className="input w-64" value={form.clave} minLength={8} onChange={(e) => setForm({ ...form, clave: e.target.value })} placeholder="Generar automática" />
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
              <tr><th className="px-4 py-3 font-medium">Nro</th><th className="px-4 py-3 font-medium">Nombre</th><th className="px-4 py-3 font-medium">Dirección</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium tabnum">{c.nroCliente}</td>
                  <td className="px-4 py-3">{c.nombre}</td>
                  <td className="px-4 py-3 text-slate-500">{c.direccion ?? '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActivo(c)}
                      title={c.activo ? 'Clic para desactivar (deja de verse en el WMS)' : 'Clic para reactivar'}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold cursor-pointer transition-colors ${
                        c.activo
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${c.activo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      {c.activo ? 'Activo' : 'Inactivo'}
                      {c.primerIngreso && c.activo ? ' · 1er ingreso' : ''}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-ghost h-9" onClick={() => setReseteando(c)} title="Asignar nueva clave">
                      <KeyRound className="h-4 w-4" /> Clave
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reseteando && (
        <ClaveDialog
          titulo={`Nueva clave para ${reseteando.nroCliente} · ${reseteando.nombre}`}
          onCerrar={() => setReseteando(null)}
          onConfirmar={(clave) => reset(reseteando, clave)}
        />
      )}
    </div>
  );
}
