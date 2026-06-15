import { useState, type ReactNode } from 'react';
import { BookOpen, X } from 'lucide-react';
import { ESTADO_CLASE, ESTADO_LABEL, type Estado } from '../lib/estados';
import type { ProductoLite } from '../lib/producto';

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

/**
 * Diálogo para asignar una nueva clave: el admin puede escribirla él mismo
 * (queda definitiva) o generarla automática (se exige cambiarla al ingresar).
 */
export function ClaveDialog({
  titulo,
  onCerrar,
  onConfirmar,
}: {
  titulo: string;
  onCerrar: () => void;
  onConfirmar: (clave?: string) => Promise<void>;
}) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const confirmar = async (manual: boolean) => {
    if (manual && clave.trim().length < 8) {
      setError('La clave debe tener al menos 8 caracteres.');
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await onConfirmar(manual ? clave.trim() : undefined);
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="card p-5 w-full max-w-md animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold mb-1">{titulo}</h2>
        <p className="text-xs text-slate-500 mb-3">
          Escribí la clave que quieras asignar (queda como definitiva), o generá una automática
          (se pedirá cambiarla en el primer ingreso).
        </p>
        <Field label="Clave elegida (mín. 8 caracteres)">
          <input
            className="input w-full"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="Dejar vacío para generar automática"
            autoFocus
          />
        </Field>
        {error && <p className="text-sm text-red-600 mt-2" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <button className="btn-ghost h-9" onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button className="btn-outline h-9" onClick={() => confirmar(false)} disabled={enviando}>
            Generar automática
          </button>
          <button
            className="btn-accent h-9 disabled:opacity-50"
            onClick={() => confirmar(true)}
            disabled={enviando || clave.trim().length === 0}
          >
            Usar esta clave
          </button>
        </div>
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

/** Marcador "sin portada": ícono de libro centrado sobre fondo neutro. */
function SinPortada({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center bg-slate-100 text-slate-300 ${className}`}>
      <BookOpen className="h-1/2 w-1/2" />
    </span>
  );
}

/**
 * Miniatura de portada clickeable. Al hacer click abre el popup con la imagen
 * grande, título, editorial e ISBN. Si no hay imagen muestra un placeholder.
 */
export function ProductoThumb({ producto, size = 40 }: { producto: ProductoLite; size?: number }) {
  const [abierto, setAbierto] = useState(false);
  const estilo = { width: size, height: Math.round(size * 1.33) };
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Ver portada"
        className="shrink-0 overflow-hidden rounded border border-slate-200 transition hover:border-brand-green-ink hover:shadow"
        style={estilo}
      >
        {producto.imagenUrl ? (
          <img src={producto.imagenUrl} alt={producto.titulo} className="h-full w-full object-cover" />
        ) : (
          <SinPortada className="h-full w-full" />
        )}
      </button>
      {abierto && <ProductoDialog producto={producto} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

/** Popup de producto: portada grande + título, editorial e ISBN. */
export function ProductoDialog({ producto, onCerrar }: { producto: ProductoLite; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="card p-5 w-full max-w-sm animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end -mt-1 -mr-1">
          <button className="text-slate-400 hover:text-slate-700" onClick={onCerrar} aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-auto mb-4 w-40 overflow-hidden rounded-lg border border-slate-200" style={{ aspectRatio: '3 / 4' }}>
          {producto.imagenUrl ? (
            <img src={producto.imagenUrl} alt={producto.titulo} className="h-full w-full object-cover" />
          ) : (
            <SinPortada className="h-full w-full" />
          )}
        </div>
        <h3 className="font-semibold text-center text-slate-900">{producto.titulo}</h3>
        {producto.editorial && (
          <p className="text-sm text-slate-500 text-center mt-0.5">{producto.editorial}</p>
        )}
        <p className="text-xs text-slate-400 text-center mt-2 tabnum">ISBN {producto.isbn}</p>
      </div>
    </div>
  );
}
