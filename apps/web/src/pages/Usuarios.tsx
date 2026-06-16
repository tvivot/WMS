import { useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Card, ClaveDialog, CredencialAlert, EmptyState, Field, Spinner } from '../components/ui';

interface Rol { id: number; nombre: string }
interface Usuario {
  id: number; username: string; nombre: string; email: string | null;
  activo: boolean; primerIngreso: boolean; roles: Rol[];
}

const FORM_VACIO = { username: '', nombre: '', email: '', rolIds: [] as number[], clave: '' };

export function Usuarios() {
  const [items, setItems] = useState<Usuario[] | null>(null);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [panel, setPanel] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [cred, setCred] = useState<{ titulo: string; clave: string } | null>(null);
  const [reseteando, setReseteando] = useState<Usuario | null>(null);
  const [eliminando, setEliminando] = useState<Usuario | null>(null);
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

  const abrirCrear = () => {
    setEditando(null);
    setForm(FORM_VACIO);
    setError(null);
    setPanel((v) => !v);
  };

  const abrirEditar = (u: Usuario) => {
    setEditando(u);
    setForm({ username: u.username, nombre: u.nombre, email: u.email ?? '', rolIds: u.roles.map((r) => r.id), clave: '' });
    setError(null);
    setPanel(true);
  };

  const cerrarPanel = () => {
    setPanel(false);
    setEditando(null);
    setForm(FORM_VACIO);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (editando) {
        await api.put(`/usuarios/${editando.id}`, {
          nombre: form.nombre,
          email: form.email || null,
          rolIds: form.rolIds,
        });
        cerrarPanel();
        cargar();
      } else {
        const r = await api.post<Usuario & { claveGenerada: string }>('/usuarios', {
          username: form.username,
          nombre: form.nombre,
          email: form.email || undefined,
          rolIds: form.rolIds,
          clave: form.clave.trim() || undefined,
        });
        setCred({ titulo: `Usuario ${r.username} — clave de acceso`, clave: r.claveGenerada });
        cerrarPanel();
        cargar();
      }
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

  const eliminar = async (u: Usuario) => {
    await api.delete(`/usuarios/${u.id}`);
    setEliminando(null);
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
        <button className="btn-primary" onClick={abrirCrear}>
          <Plus className="h-4 w-4" /> Usuario
        </button>
      </div>

      {cred && <CredencialAlert titulo={cred.titulo} clave={cred.clave} onCerrar={() => setCred(null)} />}

      {panel && (
        <Card>
          <form onSubmit={enviar} className="space-y-3">
            <h2 className="font-semibold">{editando ? `Editar ${editando.username}` : 'Nuevo usuario'}</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Usuario">
                <input className="input disabled:bg-slate-100 disabled:text-slate-500" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required disabled={!!editando} />
              </Field>
              <Field label="Nombre"><input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></Field>
              <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            {!editando && (
              <Field label="Clave (opcional)" hint="Vacío = se genera automática. Si la escribís, queda definitiva (mín. 8 caracteres).">
                <input className="input sm:w-80" value={form.clave} minLength={8} onChange={(e) => setForm({ ...form, clave: e.target.value })} placeholder="Generar automática" />
              </Field>
            )}
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
            <div className="flex gap-2">
              <button className="btn-accent" type="submit">{editando ? 'Guardar cambios' : 'Crear usuario'}</button>
              <button className="btn-ghost" type="button" onClick={cerrarPanel}>Cancelar</button>
            </div>
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
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-ghost h-9" onClick={() => abrirEditar(u)} title="Editar usuario y roles">
                        <Pencil className="h-4 w-4" /> Editar
                      </button>
                      <button className="btn-ghost h-9" onClick={() => setReseteando(u)} title="Asignar nueva clave">
                        <KeyRound className="h-4 w-4" /> Clave
                      </button>
                      <button className="btn-ghost h-9 text-red-600 hover:bg-red-50" onClick={() => setEliminando(u)} title="Eliminar usuario">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
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

      {eliminando && (
        <ConfirmarEliminar
          usuario={eliminando}
          onCerrar={() => setEliminando(null)}
          onConfirmar={() => eliminar(eliminando)}
        />
      )}
    </div>
  );
}

function ConfirmarEliminar({
  usuario,
  onCerrar,
  onConfirmar,
}: {
  usuario: Usuario;
  onCerrar: () => void;
  onConfirmar: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    setError(null);
    setEnviando(true);
    try {
      await onConfirmar();
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="card p-5 w-full max-w-md animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold mb-1">Eliminar usuario</h2>
        <p className="text-sm text-slate-600">
          Vas a eliminar a <strong>{usuario.username}</strong> ({usuario.nombre}). Esta acción no se puede deshacer.
        </p>
        {error && <p className="text-sm text-red-600 mt-2" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost h-9" onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button className="btn-accent h-9 bg-red-600 hover:bg-red-700 disabled:opacity-50" onClick={confirmar} disabled={enviando}>
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
