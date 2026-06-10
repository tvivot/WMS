import { useEffect, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react';

/**
 * Grilla reusable (TanStack Table v8): orden por cualquier columna y
 * mostrar/ocultar columnas, con preferencia persistida por grilla
 * (storageKey) en localStorage.
 */
export function DataGrid<T>({ data, columns, storageKey }: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  storageKey?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
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
    state: { sorting, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="card overflow-visible">
      <div className="flex justify-end px-2 pt-2">
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
              <tr key={row.id} className="hover:bg-slate-50">
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
    </div>
  );
}
