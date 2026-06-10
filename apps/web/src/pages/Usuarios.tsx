import { useEffect, useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Card, ClaveDialog, CredencialAlert, EmptyState, Field, Spinner } from '../components/ui';

interface Rol { id: number; nombre: string }
interface Usuario {
  id: number; username: string; nombre: string; email: string | null;
  activo: boolean; primerIngreso: boolean; roles: Rol[];
}

export function Usuarios() {
  const [items, setItems] = useState<Usuario[] | null>(null);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ username: '', nombre: '', email: '', rolIds: [] as number[], clave: '' });
  const [cred, setCred] = useState<{ titulo: string; clave: string } | null>(null);
  const [reseteando, setReseteando] = useState<Usuario | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setItems(null);
    api.get<Usuario[]>('/usuarios').then(setItems).catch(() => setItems([]));
  };
  useEffect(() => {
    cargar();
    api.get<Rol[]>('/usuarios/roles').then(setRoles).catch(() => {});
  }, []);

  const toggleRol = (id: number) =>
    setForm((f) => ({
      ...f,
      rolIds: f.rolIds.includes(id) ? f.rolIds.filter((x) => x !== id) : [...f.rolIds, id],
    }));

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<Usuario & { claveGenerada: string }>('/usuarios', {
        username: form.username,
        nombre: form.nombre,
        email: form.email || undefined,
        rolIds: form.rolIds,
        clave: form.clave.trim() || undefined,
      });
      setCred({ titulo: `Usuario ${r.username} — clave de acceso`, clave: r.claveGenerada });
      setForm({ username: '', nombre: '', email: '', rolIds: [], clave: '' });
      setCreando(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const reset = async (u: Usuario, clave?: string) => {
    const r = await api.post<{ claveGenerada: string }>(`/usuarios/${u.id}/reset-clave`, clave ? { clave } : {});
    setCred({ titulo: `Nueva clave de ${u.username}`, clave: r.claveGenerada });
    setReseteando(null);
    cargar();
  };

  const toggleActivo = async (u: Usuario) => {
    await api.put(`/usuarios/${u.id}`, { activo: !u.activo });
    cargar();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Usuarios</h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Usuario
        </button>
      </div>

      {cred && <CredencialAlert titulo={cred.titulo} clave={cred.clave} onCerrar={() => setCred(null)} />}

      {creando && (
        <Card>
          <form onSubmit={crear} className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Usuario"><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
              <Field label="Nombre"><input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></Field>
              <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            <Field label="Clave (opcional)" hint="Vacío = se genera automática. Si la escribís, queda definitiva (mín. 8 caracteres).">
              <input className="input sm:w-80" value={form.clave} minLength={8} onChange={(e) => setForm({ ...form, clave: e.target.value })} placeholder="Generar automática" />
            </Field>
            <div>
              <label className="label">Roles</label>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRol(r.id)}
                    className={`px-3 h-9 rounded-lg text-sm font-medium border transition-colors ${
                      form.rolIds.includes(r.id)
                        ? 'bg-shell-800 text-white border-shell-800'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {r.nombre}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn-accent" type="submit">Crear usuario</button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : items.length === 0 ? (
        <EmptyState titulo="Sin usuarios" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr><th className="px-4 py-3 font-medium">Usuario</th><th className="px-4 py-3 font-medium">Nombre</th><th className="px-4 py-3 font-medium">Roles</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">{u.nombre}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span key={r.id} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{r.nombre}</span>
                      ))}
                      {u.roles.length === 0 && <span className="text-xs text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActivo(u)} className={`text-xs font-semibold ${u.activo ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-ghost h-9" onClick={() => setReseteando(u)} title="Asignar nueva clave">
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
          titulo={`Nueva clave para ${reseteando.username}`}
          onCerrar={() => setReseteando(null)}
          onConfirmar={(clave) => reset(reseteando, clave)}
        />
      )}
    </div>
  );
}
