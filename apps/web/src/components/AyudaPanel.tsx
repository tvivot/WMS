import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HelpCircle, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ayudaPara } from '../lib/ayuda';

/**
 * Botón "?" del header: abre el manual de la pantalla actual en un panel
 * lateral (pantalla completa en el celular). El contenido vive en
 * lib/ayuda.ts y se filtra según el tipo de usuario (cliente / interno).
 */
export function AyudaBoton() {
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();
  const { actor } = useAuth();
  const cerrarRef = useRef<HTMLButtonElement>(null);

  const ayuda = ayudaPara(pathname, actor?.tipo);

  // Cerrar con ESC + foco inicial en el botón de cerrar (accesibilidad).
  useEffect(() => {
    if (!abierto) return;
    cerrarRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [abierto]);

  // Al cambiar de pantalla, el panel se cierra (la ayuda es contextual).
  useEffect(() => setAbierto(false), [pathname]);

  if (!ayuda) return null;

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
        aria-label="Ayuda de esta pantalla"
        title="Ayuda: cómo usar esta pantalla"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setAbierto(false)}
          role="presentation"
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Ayuda: ${ayuda.titulo}`}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-full sm:max-w-md bg-white shadow-xl flex flex-col animate-fade-in"
          >
            <header className="bg-shell-900 text-white px-5 py-4 flex items-start justify-between gap-3 shrink-0">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50 flex items-center gap-1.5">
                  <HelpCircle className="h-3.5 w-3.5" /> Manual de uso
                </p>
                <h2 className="font-semibold leading-snug mt-0.5">{ayuda.titulo}</h2>
              </div>
              <button
                ref={cerrarRef}
                onClick={() => setAbierto(false)}
                className="p-2 -mr-2 rounded-lg hover:bg-white/10 shrink-0"
                aria-label="Cerrar ayuda"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[15px] leading-relaxed text-slate-700">
              <p className="text-slate-600">{ayuda.intro}</p>

              {ayuda.secciones.map((s) => (
                <section key={s.titulo}>
                  <h3 className="font-semibold text-slate-900 mb-1.5">{s.titulo}</h3>
                  {s.parrafos?.map((p, i) => (
                    <p key={i} className="mb-1.5">{p}</p>
                  ))}
                  {s.pasos && (
                    <ol className="list-decimal pl-5 space-y-1.5 marker:text-brand-blue-ink marker:font-semibold">
                      {s.pasos.map((paso, i) => (
                        <li key={i}>{paso}</li>
                      ))}
                    </ol>
                  )}
                </section>
              ))}

              <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
                ¿Algo no funciona como dice acá? Avisale al Administrador del sistema.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
