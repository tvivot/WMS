import { useEffect, useRef, useState } from 'react';
import { Building2, Check } from 'lucide-react';
import { api } from '../lib/api';

export interface ClienteOpcion {
  id: number;
  nroCliente: string;
  nombre: string;
  direccion: string | null;
}

interface Props {
  onSelect: (c: ClienteOpcion | null) => void;
  seleccionado: ClienteOpcion | null;
}

/**
 * Autocomplete de cliente: tipear número de cliente o nombre y elegir.
 * Usa GET /clientes/buscar (debounce 250ms, máx. 10 resultados).
 */
export function ClientePicker({ onSelect, seleccionado }: Props) {
  const [q, setQ] = useState('');
  const [opciones, setOpciones] = useState<ClienteOpcion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (q.trim().length < 2) {
      setOpciones([]);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .get<ClienteOpcion[]>(`/clientes/buscar?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setOpciones(r);
          setAbierto(true);
        })
        .catch(() => setOpciones([]));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  if (seleccionado) {
    return (
      <div className="flex items-center gap-2 h-11 px-3 rounded-lg border border-emerald-300 bg-emerald-50 text-sm">
        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
        <span className="font-semibold tabnum">{seleccionado.nroCliente}</span>
        <span className="truncate">{seleccionado.nombre}</span>
        <button
          type="button"
          className="ml-auto text-xs text-slate-500 hover:text-slate-800 underline"
          onClick={() => {
            onSelect(null);
            setQ('');
          }}
        >
          cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Número de cliente o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => opciones.length > 0 && setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
        />
      </div>
      {abierto && opciones.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-64 overflow-auto card divide-y divide-slate-100 animate-fade-in">
          {opciones.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer"
                onMouseDown={() => {
                  onSelect(c);
                  setAbierto(false);
                }}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold tabnum text-brand-blue-ink">{c.nroCliente}</span>
                  <span className="truncate">{c.nombre}</span>
                </div>
                {c.direccion && <div className="text-xs text-slate-400 truncate">{c.direccion}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {abierto && q.trim().length >= 2 && opciones.length === 0 && (
        <p className="absolute z-30 mt-1 w-full card px-3 py-2 text-sm text-slate-400">Sin resultados</p>
      )}
    </div>
  );
}
