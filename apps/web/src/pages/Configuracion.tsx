import { useEffect, useState } from 'react';
import { Check, CheckCircle2, ImageDown, Images, Loader2, Plug, RefreshCw, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Card } from '../components/ui';

interface EstadoWoo {
  configurado: boolean;
  variables?: { url: boolean; key: boolean; secret: boolean };
}

interface ResultadoSync {
  configurado: boolean;
  revisados: number;
  actualizados: number;
  sinImagen: number;
  errores: { productoId: number; error: string }[];
  enCurso?: boolean;
}

/**
 * Configuración del WMS. Hoy: conector de imágenes WooCommerce (portadas de
 * productos por SKU = ISBN). Permite disparar la sincronización a demanda;
 * además corre sola cada 48 h en el servidor.
 */
export function Configuracion() {
  const [estado, setEstado] = useState<EstadoWoo | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoSync | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<EstadoWoo>('/integraciones/woocommerce/estado')
      .then(setEstado)
      .catch(() => setEstado({ configurado: false }));
  }, []);

  const sincronizar = async () => {
    setCorriendo(true);
    setError(null);
    setResultado(null);
    try {
      const r = await api.post<ResultadoSync>('/integraciones/woocommerce/sync-imagenes');
      setResultado(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo ejecutar la sincronización.');
    } finally {
      setCorriendo(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configuración</h1>
        <p className="text-sm text-slate-500 mt-1">Integraciones y mantenimiento del WMS.</p>
      </div>

      <Card>
        <div className="flex items-start gap-4">
          <div className="grid place-items-center h-11 w-11 rounded-xl bg-brand-blue-ink/10 text-brand-blue-ink shrink-0">
            <Images className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-slate-900">Portadas desde WooCommerce</h2>
              <EstadoChip estado={estado} />
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Completa la portada de los productos sin imagen buscándola en la tienda WooCommerce
              por SKU = ISBN. Se ejecuta <strong>automáticamente cada 48&nbsp;h</strong>; acá podés
              forzar una corrida manual.
            </p>

            {estado && !estado.configurado && estado.variables && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm">
                <p className="text-amber-800 font-medium">Faltan variables de entorno en el servidor</p>
                <ul className="mt-1.5 space-y-1">
                  <VarFila nombre="WOO_URL" ok={estado.variables.url} />
                  <VarFila nombre="WOO_KEY" ok={estado.variables.key} />
                  <VarFila nombre="WOO_SECRET" ok={estado.variables.secret} />
                </ul>
                <p className="text-amber-700 mt-2 text-xs">
                  Cargá las tres en Hostinger (hPanel → Variables de entorno) y <strong>reiniciá/redeploy</strong> la
                  app: los cambios de entorno no toman efecto hasta reiniciar el proceso.
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="btn-primary"
                onClick={sincronizar}
                disabled={corriendo || estado?.configurado === false}
                title={
                  estado?.configurado === false
                    ? 'Configurá las variables WOO_* en el servidor para habilitarlo'
                    : 'Buscar y completar portadas faltantes ahora'
                }
              >
                {corriendo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {corriendo ? 'Sincronizando…' : 'Actualizar portadas ahora'}
              </button>
              {corriendo && (
                <span className="text-xs text-slate-400">
                  Procesa hasta 200 productos por corrida.
                </span>
              )}
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg" role="alert">
                {error}
              </p>
            )}

            {resultado?.enCurso && (
              <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg inline-flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin" /> Ya hay una sincronización en curso. Esperá a que termine.
              </p>
            )}

            {resultado && !resultado.enCurso && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metrica icon={ImageDown} label="Actualizadas" valor={resultado.actualizados} tono="ok" />
                <Metrica icon={Plug} label="Revisadas" valor={resultado.revisados} tono="neutro" />
                <Metrica icon={Images} label="Sin imagen" valor={resultado.sinImagen} tono="neutro" />
                <Metrica icon={RefreshCw} label="Errores" valor={resultado.errores.length} tono={resultado.errores.length ? 'alerta' : 'neutro'} />
              </div>
            )}

            {resultado && !resultado.enCurso && resultado.actualizados === 0 && resultado.sinImagen === 0 && resultado.revisados === 0 && (
              <p className="mt-3 text-sm text-emerald-700 inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> No hay productos pendientes de portada.
              </p>
            )}

            {resultado && resultado.errores.length > 0 && (
              <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm">
                <p className="text-red-800 font-medium">Detalle de errores</p>
                <ul className="mt-1.5 space-y-1 max-h-40 overflow-auto">
                  {agruparErrores(resultado.errores).map((e) => (
                    <li key={e.mensaje} className="text-red-700 text-xs">
                      <span className="font-mono">{e.mensaje}</span>
                      {e.veces > 1 && <span className="text-red-500"> · ×{e.veces}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function EstadoChip({ estado }: { estado: EstadoWoo | null }) {
  if (!estado) return <span className="text-xs text-slate-400">comprobando…</span>;
  return estado.configurado ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 px-2.5 h-6 text-xs font-semibold">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Conectado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-500 px-2.5 h-6 text-xs font-semibold">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> No configurado
    </span>
  );
}

/** Agrupa los errores por mensaje para no listar 200 líneas iguales. */
function agruparErrores(errores: { error: string }[]): { mensaje: string; veces: number }[] {
  const mapa = new Map<string, number>();
  for (const e of errores) mapa.set(e.error, (mapa.get(e.error) ?? 0) + 1);
  return [...mapa.entries()]
    .map(([mensaje, veces]) => ({ mensaje, veces }))
    .sort((a, b) => b.veces - a.veces);
}

function VarFila({ nombre, ok }: { nombre: string; ok: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
      ) : (
        <X className="h-4 w-4 text-red-500 shrink-0" />
      )}
      <code className="text-xs font-mono text-slate-700">{nombre}</code>
      <span className={`text-xs ${ok ? 'text-emerald-700' : 'text-red-600'}`}>
        {ok ? 'cargada' : 'falta'}
      </span>
    </li>
  );
}

function Metrica({
  icon: Icon,
  label,
  valor,
  tono,
}: {
  icon: typeof ImageDown;
  label: string;
  valor: number;
  tono: 'ok' | 'alerta' | 'neutro';
}) {
  const color =
    tono === 'ok'
      ? 'text-emerald-700'
      : tono === 'alerta'
        ? 'text-red-600'
        : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`text-2xl font-bold tabnum mt-0.5 ${color}`}>{valor}</div>
    </div>
  );
}
