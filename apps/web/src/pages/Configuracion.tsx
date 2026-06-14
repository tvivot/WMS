import { useEffect, useState } from 'react';
import { CheckCircle2, ImageDown, Images, Loader2, Plug, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Card } from '../components/ui';

interface EstadoWoo {
  configurado: boolean;
}

interface ResultadoSync {
  configurado: boolean;
  revisados: number;
  actualizados: number;
  sinImagen: number;
  errores: { productoId: number; error: string }[];
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

            {resultado && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metrica icon={ImageDown} label="Actualizadas" valor={resultado.actualizados} tono="ok" />
                <Metrica icon={Plug} label="Revisadas" valor={resultado.revisados} tono="neutro" />
                <Metrica icon={Images} label="Sin imagen" valor={resultado.sinImagen} tono="neutro" />
                <Metrica icon={RefreshCw} label="Errores" valor={resultado.errores.length} tono={resultado.errores.length ? 'alerta' : 'neutro'} />
              </div>
            )}

            {resultado && resultado.actualizados === 0 && resultado.sinImagen === 0 && resultado.revisados === 0 && (
              <p className="mt-3 text-sm text-emerald-700 inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> No hay productos pendientes de portada.
              </p>
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
