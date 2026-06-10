import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PERMISOS, ESTADOS_ORDEN, ESTADO_LABEL, type Estado } from '../../lib/estados';
import { Card, EmptyState, EstadoBadge, Spinner } from '../../components/ui';
import { DataGrid } from '../../components/grilla/DataGrid';
import { ClientePicker, type ClienteOpcion } from '../../components/ClientePicker';

interface Autorizacion {
  id: number;
  estado: Estado;
  clienteId: number;
  cliente: { id: number; nroCliente: string; nombre: string } | null;
  bultosDeclarados: number | null;
  createdAt: string;
}

const COLUMNAS: ColumnDef<Autorizacion, unknown>[] = [
  {
    id: 'numero',
    header: '#',
    accessorKey: 'id',
    cell: ({ row }) => (
      <Link to={`/devoluciones/${row.original.id}`} className="font-semibold text-brand-blue-ink tabnum">
        #{row.original.id}
      </Link>
    ),
  },
  {
    id: 'estado',
    header: 'Estado',
    accessorKey: 'estado',
    sortingFn: (a, b) =>
      ESTADOS_ORDEN.indexOf(a.original.estado) - ESTADOS_ORDEN.indexOf(b.original.estado),
    cell: ({ row }) => <EstadoBadge estado={row.original.estado} />,
  },
  {
    id: 'cliente',
    header: 'Cliente',
    accessorFn: (a) => a.cliente?.nombre ?? String(a.clienteId),
    cell: ({ row }) => {
      const c = row.original.cliente;
      return c ? (
        <span>
          <span className="tabnum text-slate-400 mr-2">{c.nroCliente}</span>
          {c.nombre}
        </span>
      ) : (
        <span className="tabnum text-slate-600">{row.original.clienteId}</span>
      );
    },
  },
  {
    id: 'bultos',
    header: 'Bultos',
    accessorFn: (a) => a.bultosDeclarados ?? -1,
    cell: ({ row }) => (
      <span className="tabnum text-slate-600">{row.original.bultosDeclarados ?? '—'}</span>
    ),
  },
  {
    id: 'creada',
    header: 'Creada',
    accessorKey: 'createdAt',
    cell: ({ row }) => (
      <span className="text-slate-500">{new Date(row.original.createdAt).toLocaleDateString()}</span>
    ),
  },
];

export function DevolucionesLista() {
  const { puede, actor } = useAuth();
  const [items, setItems] = useState<Autorizacion[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [cliente, setCliente] = useState<ClienteOpcion | null>(null);
  const [filtro, setFiltro] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setItems(null);
    api.get<Autorizacion[]>('/devoluciones/autorizaciones').then(setItems).catch(() => setItems([]));
  };
  useEffect(cargar, []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (actor?.tipo !== 'cliente' && !cliente) {
      setError('Seleccioná un cliente');
      return;
    }
    try {
      const body = actor?.tipo === 'cliente' ? {} : { clienteId: cliente!.id };
      await api.post('/devoluciones/autorizaciones', body);
      setCreando(false);
      setCliente(null);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const conteo = (e: Estado) => items?.filter((i) => i.estado === e).length ?? 0;
  const visibles = useMemo(
    () => (filtro ? (items ?? []).filter((i) => i.estado === filtro) : (items ?? [])),
    [items, filtro],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Devoluciones</h1>
        {puede(PERMISOS.SOLICITUD_CREAR) && (
          <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
            <Plus className="h-4 w-4" /> Nueva
          </button>
        )}
      </div>

      {/* KPIs por estado — clic = filtrar la grilla */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {ESTADOS_ORDEN.map((e) => (
          <button
            key={e}
            onClick={() => setFiltro(filtro === e ? null : e)}
            className={`card p-3 text-left transition-shadow ${
              filtro === e ? 'ring-2 ring-brand-green-ink' : 'hover:shadow-md'
            }`}
            title={filtro === e ? 'Quitar filtro' : `Filtrar por ${ESTADO_LABEL[e]}`}
          >
            <div className="text-2xl font-bold tabnum text-slate-900">{conteo(e)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{ESTADO_LABEL[e]}</div>
          </button>
        ))}
      </div>

      {creando && (
        <Card>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            {actor?.tipo !== 'cliente' && (
              <div className="w-full sm:w-96">
                <label className="label">Cliente (número o nombre)</label>
                <ClientePicker seleccionado={cliente} onSelect={setCliente} />
              </div>
            )}
            <button className="btn-accent" type="submit">
              Crear solicitud
            </button>
            {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center text-slate-400">
          <Spinner className="text-slate-400" />
        </div>
      ) : visibles.length === 0 ? (
        <EmptyState
          titulo={filtro ? `Sin devoluciones en ${ESTADO_LABEL[filtro]}` : 'Sin devoluciones'}
          sub={filtro ? 'Tocá el indicador de nuevo para quitar el filtro.' : 'Creá una nueva solicitud para empezar.'}
        />
      ) : (
        <DataGrid data={visibles} columns={COLUMNAS} storageKey="devoluciones" />
      )}
    </div>
  );
}
