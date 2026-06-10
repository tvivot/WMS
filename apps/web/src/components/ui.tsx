import type { ReactNode } from 'react';
import { ESTADO_CLASE, ESTADO_LABEL, type Estado } from '../lib/estados';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      role="status"
      aria-label="Cargando"
    />
  );
}

export function EstadoBadge({ estado }: { estado: Estado }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_CLASE[estado] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {ESTADO_LABEL[estado] ?? estado}
    </span>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card p-5 animate-fade-in ${className}`}>{children}</div>;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function CredencialAlert({
  titulo,
  clave,
  onCerrar,
}: {
  titulo: string;
  clave: string;
  onCerrar: () => void;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-3 animate-fade-in">
      <div>
        <p className="text-sm font-semibold text-emerald-800">{titulo}</p>
        <p className="text-xs text-emerald-700">Anotala y entregala — no se vuelve a mostrar.</p>
        <code className="mt-1 inline-block text-lg font-bold tabnum text-emerald-900">{clave}</code>
      </div>
      <div className="flex gap-2">
        <button className="btn-outline h-9" onClick={() => navigator.clipboard?.writeText(clave)}>
          Copiar
        </button>
        <button className="btn-ghost h-9" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ titulo, sub }: { titulo: string; sub?: string }) {
  return (
    <div className="text-center py-12 text-slate-500">
      <p className="font-medium text-slate-600">{titulo}</p>
      {sub && <p className="text-sm mt-1">{sub}</p>}
    </div>
  );
}
