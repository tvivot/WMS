import { useEffect, useState } from 'react';
import { Check, Plus, Shield } from 'lucide-react';
import { api } from '../lib/api';
import { Card, EmptyState, Field, Spinner } from '../components/ui';

interface Permiso { id: number; codigo: string; descripcion: string | null }
interface Rol {
  id: number; nombre: string; descripcion: string | null;
  usuarios: number; permisos: string[];
}

export function Roles() {
  const [roles, setRoles] = useState<Rol[] | null>(null);
  const [catalogo, setCatalogo] = useState<Permiso[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '' });
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setRoles(null);
    api.get<Rol[]>('/roles').then(setRoles).catch(() => setRoles([]));
  };
  useEffect(() => {
    cargar();
    api.get<Permiso[]>('/roles/permisos').then(setCatalogo).catch(() => {});
  }, []);

  const abrirEdicion = (r: Rol) => {
    setEditId(r.id);
    setSel(new Set(r.permisos));
    setError(null);
  };
  const toggle = (codigo: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(codigo) ? n.delete(codigo) : n.add(codigo);
      return n;
    });

  const guardar = async (id: number) => {
    setError(null);
    try {
      await api.put(`/roles/${id}`, { permisos: [...sel] });
      setEditId(null);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/roles', { nombre: nuevo.nombre, descripcion: nuevo.descripcion || undefined, permisos: [] });
      setNuevo({ nombre: '', descripcion: '' });
      setCreando(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (roles === null) return <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Roles y permisos</h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Rol
        </button>
      </div>

      {creando && (
        <Card>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            <Field label="Nombre"><input className="input w-48" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} required /></Field>
            <Field label="Descripción"><input className="input w-64" value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} /></Field>
            <button className="btn-accent" type="submit">Crear</button>
          </form>
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {roles.length === 0 ? (
        <EmptyState titulo="Sin roles" />
      ) : (
        <div className="space-y-3">
          {roles.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-shell-800 text-white grid place-items-center">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{r.nombre}</div>
                    <div className="text-xs text-slate-500">{r.descripcion ?? '—'} · {r.usuarios} usuario(s)</div>
                  </div>
                </div>
                {editId === r.id ? (
                  <div className="flex gap-2">
                    <button className="btn-ghost h-9" onClick={() => setEditId(null)}>Cancelar</button>
                    <button className="btn-accent h-9" onClick={() => guardar(r.id)}>Guardar</button>
                  </div>
                ) : (
                  <button className="btn-outline h-9" onClick={() => abrirEdicion(r)}>Editar permisos</button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(editId === r.id ? catalogo : catalogo.filter((p) => r.permisos.includes(p.codigo))).map((p) => {
                  const activo = editId === r.id ? sel.has(p.codigo) : true;
                  return (
                    <button
                      key={p.codigo}
                      type="button"
                      disabled={editId !== r.id}
                      onClick={() => toggle(p.codigo)}
                      title={p.descripcion ?? p.codigo}
                      className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors ${
                        activo
                          ? 'bg-brand-green/15 border-brand-green-ink/40 text-brand-green-ink'
                          : 'bg-white border-slate-200 text-slate-500'
                      } ${editId === r.id ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      {activo && <Check className="h-3.5 w-3.5" />}
                      {p.codigo}
                    </button>
                  );
                })}
                {editId !== r.id && r.permisos.length === 0 && (
                  <span className="text-xs text-slate-400">Sin permisos</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
