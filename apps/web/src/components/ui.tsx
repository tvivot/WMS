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

export function EmptyState({ titulo, sub }: { titulo: string; sub?: string }) {
  return (
    <div className="text-center py-12 text-slate-500">
      <p className="font-medium text-slate-600">{titulo}</p>
      {sub && <p className="text-sm mt-1">{sub}</p>}
    </div>
  );
}
