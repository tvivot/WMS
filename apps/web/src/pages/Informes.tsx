import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Boxes, BookCopy, CheckCircle2, Clock, Library, PackageX, Users, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '../lib/api';
import { ESTADO_LABEL, type Estado } from '../lib/estados';
import { Card, EmptyState, ProductoThumb, Spinner } from '../components/ui';
import { DataGrid } from '../components/grilla/DataGrid';

interface Resumen {
  total: number;
  procesadas: number;
  enCurso: number;
  libros: { recibido: number; bueno: number; malo: number };
  porEstado: Record<string, number>;
}

const COLORES_ESTADO: Record<string, string> = {
  A_APROBAR: '#D97706', APROBADO: '#0EA5E9', EN_TRANSITO: '#6366F1',
  ENTREGADO: '#8B5CF6', EN_PROCESO_DEVOLUCION: '#06B6D4', PROCESANDO: '#3B82F6',
  VALIDANDO: '#A855F7', CON_DIFERENCIAS: '#F43F5E', PROCESADO: '#10B981',
};

type Tab = 'dashboard' | 'consignaciones';

export function Informes() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Informes</h1>

      <div className="flex gap-1 border-b border-slate-200">
        <TabBtn icon={BarChart3} label="Dashboard" activo={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
        <TabBtn icon={BookCopy} label="Consignaciones" activo={tab === 'consignaciones'} onClick={() => setTab('consignaciones')} />
      </div>

      {tab === 'dashboard' ? <Dashboard /> : <Consignaciones />}
    </div>
  );
}

function TabBtn({ icon: Icon, label, activo, onClick }: { icon: typeof Boxes; label: string; activo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        activo
          ? 'border-brand-blue-ink text-brand-blue-ink'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function Kpi({ icon: Icon, label, valor, color }: { icon: typeof Boxes; label: string; valor: number | undefined; color: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="h-10 w-10 rounded-lg grid place-items-center text-white" style={{ background: color }}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold tabnum leading-none">{valor ?? '—'}</div>
        <div className="text-xs text-slate-500 mt-1">{label}</div>
      </div>
    </div>
  );
}

// ============================== DASHBOARD ==============================

function Dashboard() {
  const [r, setR] = useState<Resumen | null>(null);
  const [serie, setSerie] = useState<{ dia: string; cantidad: number }[]>([]);
  const [clientes, setClientes] = useState<{ nombre: string; cantidad: number }[]>([]);

  useEffect(() => {
    api.get<Resumen>('/devoluciones/informes/resumen').then(setR).catch(() => {});
    api.get<typeof serie>('/devoluciones/informes/serie').then(setSerie).catch(() => {});
    api.get<typeof clientes>('/devoluciones/informes/por-cliente').then(setClientes).catch(() => {});
  }, []);

  if (!r) return <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>;

  const dataEstados = (Object.keys(r.porEstado) as Estado[]).map((e) => ({
    estado: ESTADO_LABEL[e] ?? e,
    key: e,
    cantidad: r.porEstado[e],
  }));
  const calidad = [
    { name: 'Para la venta', value: r.libros.bueno, color: '#10B981' },
    { name: 'Mal estado', value: r.libros.malo, color: '#EF4444' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Boxes} label="Devoluciones" valor={r.total} color="#334155" />
        <Kpi icon={CheckCircle2} label="Procesadas" valor={r.procesadas} color="#10B981" />
        <Kpi icon={Clock} label="En curso" valor={r.enCurso} color="#6366F1" />
        <Kpi icon={PackageX} label="Libros en mal estado" valor={r.libros.malo} color="#EF4444" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h2 className="font-semibold mb-4">Por estado</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dataEstados} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="estado" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="cantidad" radius={[4, 4, 0, 0]}>
                {dataEstados.map((d) => (
                  <Cell key={d.key} fill={COLORES_ESTADO[d.key] ?? '#64748B'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="font-semibold mb-4">Estado de los libros controlados</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={calidad} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={100} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {calidad.map((c) => (
                  <Cell key={c.name} fill={c.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="font-semibold mb-4">Devoluciones por día</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={serie} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="cantidad" stroke="#2A93C4" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="font-semibold mb-4">Top clientes</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={clientes} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11 }} width={110} />
              <Tooltip />
              <Bar dataKey="cantidad" fill="#61CE70" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ============================ CONSIGNACIONES ============================

interface ClienteConsignacion {
  clienteId: number;
  nroCliente: string | null;
  nombre: string;
  titulos: number;
  libros: number;
}

interface ItemConsignacion {
  productoId: number | null;
  isbn: string;
  titulo: string | null;
  editorial: string | null;
  imagenUrl: string | null;
  cantidad: number;
}

interface DetalleConsignacion {
  cliente: { id: number; nroCliente: string; nombre: string } | null;
  items: ItemConsignacion[];
  totalTitulos: number;
  totalLibros: number;
  actualizado: string | null;
}

const liteProd = (i: { isbn: string; titulo: string | null; editorial: string | null; imagenUrl: string | null }) => ({
  isbn: i.isbn,
  titulo: i.titulo ?? i.isbn,
  editorial: i.editorial,
  imagenUrl: i.imagenUrl,
});

function Consignaciones() {
  const [data, setData] = useState<ClienteConsignacion[] | null>(null);
  const [seleccion, setSeleccion] = useState<ClienteConsignacion | null>(null);

  useEffect(() => {
    api.get<ClienteConsignacion[]>('/devoluciones/informes/consignacion').then(setData).catch(() => setData([]));
  }, []);

  const columnas = useMemo<ColumnDef<ClienteConsignacion, unknown>[]>(
    () => [
      {
        id: 'cliente',
        header: 'Cliente',
        // Incluye nroCliente para que el buscador global matchee por nombre Y número.
        accessorFn: (c) => `${c.nombre} ${c.nroCliente ?? ''}`,
        sortingFn: (a, b) => a.original.nombre.localeCompare(b.original.nombre),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium text-slate-900 truncate">{row.original.nombre}</div>
            {row.original.nroCliente && (
              <div className="text-xs text-slate-400 tabnum">{row.original.nroCliente}</div>
            )}
          </div>
        ),
      },
      {
        id: 'titulos',
        header: 'Títulos',
        accessorKey: 'titulos',
        cell: ({ row }) => <span className="tabnum text-slate-600">{row.original.titulos}</span>,
      },
      {
        id: 'libros',
        header: 'Libros en consignación',
        accessorKey: 'libros',
        cell: ({ row }) => <span className="tabnum font-semibold text-slate-900">{row.original.libros}</span>,
      },
    ],
    [],
  );

  const totalLibros = data?.reduce((s, c) => s + c.libros, 0);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Clientes con libros en consignación (último corte del ERP). Doble clic en un cliente para ver los títulos que tiene en consignación.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Kpi icon={Users} label="Clientes con consignación" valor={data?.length} color="#334155" />
        <Kpi icon={Library} label="Libros en consignación" valor={totalLibros} color="#2A93C4" />
      </div>

      {data === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : data.length === 0 ? (
        <EmptyState
          titulo="Sin consignaciones"
          sub="Cuando el integrador (ERP) cargue el saldo en consignación, los clientes aparecen acá."
        />
      ) : (
        <DataGrid
          data={data}
          columns={columnas}
          storageKey="informes-consignaciones"
          buscar="Buscar cliente por nombre o número…"
          onRowDoubleClick={(row) => setSeleccion(row)}
        />
      )}

      {seleccion && <DetalleCliente cliente={seleccion} onCerrar={() => setSeleccion(null)} />}
    </div>
  );
}

/** Popup: los libros que un cliente tiene en consignación. */
function DetalleCliente({ cliente, onCerrar }: { cliente: ClienteConsignacion; onCerrar: () => void }) {
  const [data, setData] = useState<DetalleConsignacion | null>(null);

  useEffect(() => {
    let vigente = true;
    setData(null);
    api
      .get<DetalleConsignacion>(`/devoluciones/informes/consignacion/detalle?clienteId=${cliente.clienteId}`)
      .then((r) => vigente && setData(r))
      .catch(() => vigente && setData({ cliente: null, items: [], totalTitulos: 0, totalLibros: 0, actualizado: null }));
    return () => {
      vigente = false;
    };
  }, [cliente]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onCerrar}>
      <div className="card p-5 w-full max-w-2xl my-8 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="grid place-items-center h-12 w-12 rounded-lg bg-brand-blue-ink/10 text-brand-blue-ink shrink-0">
            <BookCopy className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900 truncate">{cliente.nombre}</h2>
            {cliente.nroCliente && <p className="text-xs text-slate-400 tabnum">{cliente.nroCliente}</p>}
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold tabnum text-slate-700">{cliente.libros}</span> libros ·{' '}
              <span className="tabnum">{cliente.titulos}</span> título(s) en consignación
              {data?.actualizado && (
                <> · actualizado {new Date(data.actualizado).toLocaleDateString()}</>
              )}
            </p>
          </div>
          <button className="text-slate-400 hover:text-slate-700" onClick={onCerrar} aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4">
          {data === null ? (
            <div className="py-8 text-center"><Spinner className="text-slate-400" /></div>
          ) : data.items.length === 0 ? (
            <EmptyState titulo="Sin libros en consignación" />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.items.map((l) => (
                <div key={l.isbn} className="flex items-center gap-2 py-2">
                  <ProductoThumb producto={liteProd(l)} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800 truncate">{l.titulo ?? '—'}</div>
                    <div className="text-[11px] text-slate-400 tabnum">
                      {l.isbn}
                      {l.editorial && <span className="text-slate-400"> · {l.editorial}</span>}
                    </div>
                  </div>
                  <span className="tabnum text-sm font-semibold text-slate-900">{l.cantidad}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
