import { useEffect, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Search,
  X,
} from 'lucide-react';

const TAMANOS_PAGINA = [20, 50, 100];

/**
 * Grilla reusable (TanStack Table v8): orden por cualquier columna,
 * mostrar/ocultar columnas (preferencia persistida por grilla en
 * localStorage vía storageKey), paginación (20/50/100, tamaño persistido
 * por grilla) y, si se pasa `buscar`, filtro de texto global sobre todas
 * las columnas.
 */
export function DataGrid<T>({ data, columns, storageKey, buscar, paginar = true, onRowDoubleClick }: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  storageKey?: string;
  /** Habilita el buscador de texto global. Texto = placeholder del input. */
  buscar?: string;
  /** Paginación client-side de la grilla. false cuando la vista pagina server-side. */
  paginar?: boolean;
  /** Doble click en una fila (no se dispara sobre botones/links/inputs de la fila). */
  onRowDoubleClick?: (row: T) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState<PaginationState>(() => {
    let pageSize = 20;
    if (storageKey) {
      const guardado = Number(localStorage.getItem(`grilla_${storageKey}_size`));
      if (TAMANOS_PAGINA.includes(guardado)) pageSize = guardado;
    }
    return { pageIndex: 0, pageSize };
  });
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    if (!storageKey) return {};
    try {
      return JSON.parse(localStorage.getItem(`grilla_${storageKey}`) ?? '{}');
    } catch {
      return {};
    }
  });
  const [menuAbierto, setMenuAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (storageKey) localStorage.setItem(`grilla_${storageKey}`, JSON.stringify(visibility));
  }, [visibility, storageKey]);

  useEffect(() => {
    if (storageKey) localStorage.setItem(`grilla_${storageKey}_size`, String(pagination.pageSize));
  }, [pagination.pageSize, storageKey]);

  useEffect(() => {
    if (!menuAbierto) return;
    const cerrar = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [menuAbierto]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility: visibility, globalFilter, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(paginar ? { getPaginationRowModel: getPaginationRowModel() } : {}),
  });

  // Si el filtro deja menos páginas que la actual, volver a una válida.
  useEffect(() => {
    const ultima = Math.max(0, table.getPageCount() - 1);
    if (pagination.pageIndex > ultima) {
      setPagination((p) => ({ ...p, pageIndex: ultima }));
    }
  }, [table, pagination.pageIndex, globalFilter]);

  const totalFilas = table.getFilteredRowModel().rows.length;
  const desde = totalFilas === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const hasta = Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalFilas);

  return (
    <div className="card overflow-visible">
      <div className="flex items-center gap-2 px-2 pt-2">
        {buscar !== undefined && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input h-8 pl-8 pr-8 text-sm"
              placeholder={buscar || 'Buscar…'}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
            />
            {globalFilter && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                onClick={() => setGlobalFilter('')}
                title="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className="flex justify-end ml-auto">
        <div className="relative" ref={menuRef}>
          <button
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 px-2 h-8 rounded-lg hover:bg-slate-100"
            onClick={() => setMenuAbierto((v) => !v)}
            title="Mostrar / ocultar columnas"
          >
            <Columns3 className="h-4 w-4" /> Columnas
          </button>
          {menuAbierto && (
            <div className="absolute right-0 top-9 z-30 w-52 card p-2 space-y-1 animate-fade-in">
              {table.getAllLeafColumns().map((col) => (
                <label key={col.id} className="flex items-center gap-2 px-2 h-8 rounded hover:bg-slate-50 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={col.getIsVisible()}
                    onChange={col.getToggleVisibilityHandler()}
                    className="accent-brand-green-ink"
                  />
                  {typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
                </label>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-3 font-medium select-none">
                    {h.isPlaceholder ? null : (
                      <button
                        className={`inline-flex items-center gap-1 ${h.column.getCanSort() ? 'cursor-pointer hover:text-slate-800' : 'cursor-default'}`}
                        onClick={h.column.getToggleSortingHandler()}
                        disabled={!h.column.getCanSort()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getCanSort() &&
                          ({ asc: <ArrowUp className="h-3.5 w-3.5" />, desc: <ArrowDown className="h-3.5 w-3.5" /> }[
                            h.column.getIsSorted() as string
                          ] ?? <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />)}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={`hover:bg-slate-50 ${onRowDoubleClick ? 'cursor-pointer select-none' : ''}`}
                title={onRowDoubleClick ? 'Doble click para abrir' : undefined}
                onDoubleClick={
                  onRowDoubleClick
                    ? (e) => {
                        // No abrir si el doble click fue sobre un control de la fila.
                        if ((e.target as HTMLElement).closest('button, a, input, select, label')) return;
                        onRowDoubleClick(row.original);
                      }
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paginar && (
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 border-t border-slate-100 text-sm text-slate-500">
        <div className="flex items-center gap-2">
          <span>Filas por página</span>
          <select
            className="input h-8 w-20 text-sm py-0"
            value={pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
          >
            {TAMANOS_PAGINA.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="tabnum">
            {desde}–{hasta} de {totalFilas}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              className="btn-ghost h-8 px-2 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              title="Primera página"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              className="btn-ghost h-8 px-2 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              title="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 tabnum">
              {table.getPageCount() === 0 ? 0 : pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <button
              className="btn-ghost h-8 px-2 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              title="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              className="btn-ghost h-8 px-2 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              title="Última página"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
