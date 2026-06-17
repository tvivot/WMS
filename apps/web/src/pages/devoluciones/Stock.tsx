import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Library, PackageSearch, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '../../lib/api';
import { Card, EmptyState, EstadoBadge, ProductoThumb, Spinner } from '../../components/ui';
import { DataGrid } from '../../components/grilla/DataGrid';
import type { Estado } from '../../lib/estados';

interface StockItem {
  productoId: number | null;
  isbn: string;
  titulo: string | null;
  editorial: string | null;
  imagenUrl: string | null;
  cantidad: number;
  devoluciones: number;
}

interface StockResp {
  items: StockItem[];
  totalTitulos: number;
  totalLibros: number;
  totalDevoluciones: number;
}

interface LineaDetalle {
  isbn: string;
  productoId: number | null;
  titulo: string | null;
  editorial: string | null;
  imagenUrl: string | null;
  cantidad: number;
}

interface DevolucionDetalle {
  autorizacionId: number;
  estado: Estado;
  createdAt: string;
  ubicacionEspera: string | null;
  cliente: { id: number; nroCliente: string; nombre: string } | null;
  cantidad: number;
  lineas: LineaDetalle[];
}

interface DetalleResp {
  producto: StockItem | null;
  devoluciones: DevolucionDetalle[];
}

const lite = (i: { isbn: string; titulo: string | null; editorial: string | null; imagenUrl: string | null }) => ({
  isbn: i.isbn,
  titulo: i.titulo ?? i.isbn,
  editorial: i.editorial,
  imagenUrl: i.imagenUrl,
});

export function StockDevoluciones() {
  const [data, setData] = useState<StockResp | null>(null);
  const [seleccion, setSeleccion] = useState<StockItem | null>(null);

  useEffect(() => {
    api
      .get<StockResp>('/devoluciones/stock')
      .then(setData)
      .catch(() => setData({ items: [], totalTitulos: 0, totalLibros: 0, totalDevoluciones: 0 }));
  }, []);

  const columnas = useMemo<ColumnDef<StockItem, unknown>[]>(
    () => [
      {
        id: 'portada',
        header: '',
        enableSorting: false,
        cell: ({ row }) => <ProductoThumb producto={lite(row.original)} size={36} />,
      },
      {
        id: 'titulo',
        header: 'Título',
        accessorFn: (i) => i.titulo ?? i.isbn,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium text-slate-900 truncate">{row.original.titulo ?? '—'}</div>
            {row.original.editorial && (
              <div className="text-xs text-slate-400 truncate">{row.original.editorial}</div>
            )}
          </div>
        ),
      },
      {
        id: 'isbn',
        header: 'ISBN',
        accessorKey: 'isbn',
        cell: ({ row }) => <span className="tabnum text-slate-500">{row.original.isbn}</span>,
      },
      {
        id: 'cantidad',
        header: 'Cantidad',
        accessorKey: 'cantidad',
        cell: ({ row }) => (
          <span className="tabnum font-semibold text-slate-900">{row.original.cantidad}</span>
        ),
      },
      {
        id: 'devoluciones',
        header: 'Devoluciones',
        accessorKey: 'devoluciones',
        cell: ({ row }) => (
          <span className="tabnum text-slate-600">{row.original.devoluciones}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Stock de Devoluciones</h1>
      </div>
      <p className="text-sm text-slate-500 -mt-3">
        Libros declarados en devoluciones que ya ingresaron al depósito y todavía no se procesaron.
        Doble clic en un libro para ver en qué devoluciones está.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi icon={Library} label="Títulos distintos" valor={data?.totalTitulos} />
        <Kpi icon={Boxes} label="Libros (declarados)" valor={data?.totalLibros} />
        <Kpi icon={PackageSearch} label="Devoluciones en depósito" valor={data?.totalDevoluciones} />
      </div>

      {data === null ? (
        <div className="py-12 text-center text-slate-400">
          <Spinner className="text-slate-400" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          titulo="Sin stock de devoluciones"
          sub="Cuando una devolución llega al depósito (Entregado o Ingreso a depósito), sus libros aparecen acá."
        />
      ) : (
        <DataGrid
          data={data.items}
          columns={columnas}
          storageKey="stock-devoluciones"
          buscar="Buscar libro por título o ISBN…"
          onRowDoubleClick={(row) => setSeleccion(row)}
        />
      )}

      {seleccion && (
        <DetalleStock item={seleccion} onCerrar={() => setSeleccion(null)} />
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  valor,
}: {
  icon: typeof Boxes;
  label: string;
  valor: number | undefined;
}) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <span className="grid place-items-center h-10 w-10 rounded-lg bg-brand-blue-ink/10 text-brand-blue-ink">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-2xl font-bold tabnum text-slate-900">{valor ?? '—'}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

/** Popup: en qué devoluciones está el título y el contenido completo de cada una. */
function DetalleStock({ item, onCerrar }: { item: StockItem; onCerrar: () => void }) {
  const [data, setData] = useState<DetalleResp | null>(null);

  useEffect(() => {
    let vigente = true;
    setData(null);
    const q =
      item.productoId !== null
        ? `productoId=${item.productoId}`
        : `isbn=${encodeURIComponent(item.isbn)}`;
    api
      .get<DetalleResp>(`/devoluciones/stock/detalle?${q}`)
      .then((r) => vigente && setData(r))
      .catch(() => vigente && setData({ producto: null, devoluciones: [] }));
    // Evita que una respuesta vieja pise a la nueva si se cambia de libro rápido.
    return () => {
      vigente = false;
    };
  }, [item]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onCerrar}>
      <div
        className="card p-5 w-full max-w-2xl my-8 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <ProductoThumb producto={lite(item)} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900">{item.titulo ?? item.isbn}</h2>
            {item.editorial && <p className="text-sm text-slate-500">{item.editorial}</p>}
            <p className="text-xs text-slate-400 tabnum mt-0.5">ISBN {item.isbn}</p>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold tabnum text-slate-700">{item.cantidad}</span> en stock ·{' '}
              <span className="tabnum">{item.devoluciones}</span> devolución(es)
            </p>
          </div>
          <button className="text-slate-400 hover:text-slate-700" onClick={onCerrar} aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {data === null ? (
            <div className="py-8 text-center text-slate-400">
              <Spinner className="text-slate-400" />
            </div>
          ) : data.devoluciones.length === 0 ? (
            <EmptyState titulo="Sin devoluciones" />
          ) : (
            data.devoluciones.map((d) => (
              <DevolucionCard key={d.autorizacionId} dev={d} resaltarIsbn={item.isbn} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DevolucionCard({ dev, resaltarIsbn }: { dev: DevolucionDetalle; resaltarIsbn: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to={`/devoluciones/${dev.autorizacionId}`}
          className="font-semibold text-brand-blue-ink tabnum"
          title="Abrir la devolución"
        >
          #{dev.autorizacionId}
        </Link>
        <EstadoBadge estado={dev.estado} />
        {dev.cliente && (
          <span className="text-sm text-slate-600">
            <span className="tabnum text-slate-400 mr-1">{dev.cliente.nroCliente}</span>
            {dev.cliente.nombre}
          </span>
        )}
        {dev.ubicacionEspera && (
          <span className="text-xs text-slate-500">📍 {dev.ubicacionEspera}</span>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {new Date(dev.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="mt-2 divide-y divide-slate-100">
        {dev.lineas.map((l, idx) => {
          const esBuscado = l.isbn === resaltarIsbn;
          return (
            <div
              key={`${l.isbn}-${idx}`}
              className={`flex items-center gap-2 py-1.5 ${esBuscado ? 'bg-amber-50 -mx-1 px-1 rounded' : ''}`}
            >
              <ProductoThumb producto={lite(l)} size={28} />
              <div className="min-w-0 flex-1">
                <div className={`text-sm truncate ${esBuscado ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                  {l.titulo ?? '—'}
                </div>
                <div className="text-[11px] text-slate-400 tabnum">{l.isbn}</div>
              </div>
              <span className="tabnum text-sm font-semibold text-slate-900">{l.cantidad}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
