import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, KeyRound, Pencil, Plus, Search, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '../lib/api';
import { Card, ClaveDialog, CredencialAlert, EmptyState, Field, Spinner } from '../components/ui';
import { DataGrid } from '../components/grilla/DataGrid';

interface Cliente {
  id: number;
  nroCliente: string;
  nombre: string;
  direccion: string | null;
  email: string | null;
  activo: boolean;
  primerIngreso: boolean;
}

const PAGINA = 50;

export function Clientes() {
  const [items, setItems] = useState<Cliente[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ nroCliente: '', nombre: '', direccion: '', email: '', clave: '' });
  const [editando, setEditando] = useState<Cliente | null>(null);
  const [editForm, setEditForm] = useState({ nombre: '', direccion: '', email: '' });
  const [cred, setCred] = useState<{ titulo: string; clave: string } | null>(null);
  const [reseteando, setReseteando] = useState<Cliente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // Búsqueda y paginación SERVER-SIDE: una página por request, filtrada por la
  // API. Antes se bajaban hasta 2000 clientes y se filtraba en el navegador, así
  // que un cliente más allá del tope no aparecía ni buscándolo por nº o nombre.
  const cargar = async (busqueda: string, pag: number) => {
    setItems(null);
    try {
      const qs = busqueda.trim() ? `&q=${encodeURIComponent(busqueda.trim())}` : '';
      const r = await api.get<{ total: number; items: Cliente[] }>(
        `/clientes?skip=${pag * PAGINA}&take=${PAGINA}${qs}`,
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
      const r = await api.post<Cliente & { claveGenerada: string }>('/clientes', {
        nroCliente: form.nroCliente,
        nombre: form.nombre,
        direccion: form.direccion || undefined,
        email: form.email.trim() || undefined,
        clave: form.clave.trim() || undefined,
      });
      setCred({ titulo: `Cliente ${r.nroCliente} — clave de acceso`, clave: r.claveGenerada });
      setForm({ nroCliente: '', nombre: '', direccion: '', email: '', clave: '' });
      setCreando(false);
      void cargar(q, page);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const abrirEdicion = (c: Cliente) => {
    setCreando(false);
    setEditForm({ nombre: c.nombre, direccion: c.direccion ?? '', email: c.email ?? '' });
    setEditando(c);
  };

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    setError(null);
    try {
      await api.put(`/clientes/${editando.id}`, {
        nombre: editForm.nombre,
        direccion: editForm.direccion || undefined,
        email: editForm.email.trim(),
      });
      setEditando(null);
      void cargar(q, page);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const reset = async (c: Cliente, clave?: string) => {
    const r = await api.post<{ claveGenerada: string }>(`/clientes/${c.id}/reset-clave`, clave ? { clave } : {});
    setCred({ titulo: `Nueva clave de ${c.nroCliente}`, clave: r.claveGenerada });
    setReseteando(null);
    void cargar(q, page);
  };

  const toggleActivo = async (c: Cliente) => {
    setError(null);
    try {
      await api.put(`/clientes/${c.id}`, { activo: !c.activo });
      void cargar(q, page);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const columnas = useMemo<ColumnDef<Cliente, unknown>[]>(
    () => [
      {
        id: 'nro',
        header: 'Nro',
        accessorKey: 'nroCliente',
        cell: ({ row }) => <span className="font-medium tabnum">{row.original.nroCliente}</span>,
      },
      { id: 'nombre', header: 'Nombre', accessorKey: 'nombre' },
      {
        id: 'direccion',
        header: 'Dirección',
        accessorFn: (c) => c.direccion ?? '',
        cell: ({ row }) => <span className="text-slate-500">{row.original.direccion ?? '—'}</span>,
      },
      {
        id: 'email',
        header: 'Email',
        accessorFn: (c) => c.email ?? '',
        cell: ({ row }) => <span className="text-slate-500">{row.original.email || '—'}</span>,
      },
      {
        id: 'estado',
        header: 'Estado',
        accessorFn: (c) => (c.activo ? 'Activo' : 'Inactivo'),
        cell: ({ row }) => {
          const c = row.original;
          return (
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
          );
        },
      },
      {
        id: 'accion',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <button className="btn-ghost h-9" onClick={() => abrirEdicion(row.original)} title="Editar datos / email">
              <Pencil className="h-4 w-4" /> Editar
            </button>
            <button className="btn-ghost h-9" onClick={() => setReseteando(row.original)} title="Asignar nueva clave">
              <KeyRound className="h-4 w-4" /> Clave
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const totalPaginas = Math.max(1, Math.ceil(total / PAGINA));
  const desde = total === 0 ? 0 : page * PAGINA + 1;
  const hasta = Math.min((page + 1) * PAGINA, total);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Clientes{' '}
          <span className="text-slate-400 text-base font-normal tabnum">({total})</span>
        </h1>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Cliente
        </button>
      </div>

      {/* Buscador server-side: nº de cliente (por prefijo) o nombre. */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          className="input pl-9 pr-9"
          placeholder="Buscar por número o nombre…"
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
            <Field label="Email" hint="Para notificaciones; varios separados por coma.">
              <input className="input w-72" type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contacto@cliente.com" />
            </Field>
            <Field label="Clave (opcional)" hint="Vacío = se genera automática. Si la escribís, queda definitiva (mín. 8).">
              <input className="input w-64" value={form.clave} minLength={8} onChange={(e) => setForm({ ...form, clave: e.target.value })} placeholder="Generar automática" />
            </Field>
            <button className="btn-accent" type="submit">Crear</button>
            {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          </form>
        </Card>
      )}

      {editando && (
        <Card>
          <form onSubmit={guardarEdicion} className="flex flex-wrap items-end gap-3">
            <div className="w-full text-sm font-semibold text-slate-700">
              Editar cliente {editando.nroCliente} · {editando.nombre}
            </div>
            <Field label="Nombre">
              <input className="input w-64" value={editForm.nombre} onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })} required />
            </Field>
            <Field label="Dirección">
              <input className="input w-72" value={editForm.direccion} onChange={(e) => setEditForm({ ...editForm, direccion: e.target.value })} />
            </Field>
            <Field label="Email" hint="Para notificaciones; varios separados por coma.">
              <input className="input w-72" type="text" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="contacto@cliente.com" />
            </Field>
            <button className="btn-accent" type="submit">Guardar</button>
            <button className="btn-ghost" type="button" onClick={() => setEditando(null)}>Cancelar</button>
            {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : items.length === 0 ? (
        <EmptyState titulo="Sin clientes" sub={q ? 'Probá con otra búsqueda.' : 'Cargá clientes para empezar.'} />
      ) : (
        <>
          <DataGrid data={items} columns={columnas} storageKey="clientes" paginar={false} />
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
