import { useEffect, useState } from 'react';
import { AlertTriangle, CloudOff, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';
import {
  cantidadPendiente,
  descartarFallido,
  fallidos,
  sincronizar,
  suscribir,
  type ControlFallido,
} from '../lib/outbox';

export function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pend, setPend] = useState(cantidadPendiente());
  const [fall, setFall] = useState<ControlFallido[]>(fallidos());
  const [sync, setSync] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const unsub = suscribir(() => {
      setPend(cantidadPendiente());
      setFall(fallidos());
    });
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      unsub();
    };
  }, []);

  const reintentar = async () => {
    setSync(true);
    await sincronizar();
    setPend(cantidadPendiente());
    setFall(fallidos());
    setSync(false);
  };

  if (online && pend === 0 && fall.length === 0) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-white/40" title="En línea">
        <Wifi className="h-3.5 w-3.5" /> En línea
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => (fall.length > 0 ? setAbierto((v) => !v) : void reintentar())}
        disabled={fall.length === 0 && (!online || sync)}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold ${
          fall.length > 0
            ? 'bg-red-500/20 text-red-300'
            : !online
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-white/10 text-white/80'
        }`}
        title={
          fall.length > 0
            ? 'Controles guardados offline que el servidor rechazó — tocá para ver'
            : !online
              ? 'Sin conexión — los controles se guardan y reintentan'
              : 'Reintentar sincronización'
        }
      >
        {fall.length > 0 ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : !online ? (
          <WifiOff className="h-3.5 w-3.5" />
        ) : pend > 0 ? (
          <CloudOff className="h-3.5 w-3.5" />
        ) : null}
        {!online && 'Offline'}
        {pend > 0 && (
          <>
            <span className="tabnum">{pend}</span> pend.
            {online && <RefreshCw className={`h-3.5 w-3.5 ${sync ? 'animate-spin' : ''}`} />}
          </>
        )}
        {fall.length > 0 && (
          <>
            <span className="tabnum">{fall.length}</span> rechaz.
          </>
        )}
      </button>

      {abierto && fall.length > 0 && (
        <div className="absolute right-0 top-9 z-50 w-80 card p-3 text-slate-800 space-y-2 animate-fade-in">
          <p className="text-xs font-semibold text-red-700">
            Controles hechos offline que el servidor rechazó. Rehacelos en la
            devolución antes de descartarlos.
          </p>
          {fall.map((f) => (
            <div key={f.id} className="rounded-lg bg-red-50 border border-red-100 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  Devolución #{f.autorizacionId} · bulto {f.numero}
                </span>
                <button
                  className="p-1 rounded hover:bg-red-100"
                  title="Descartar (el control se pierde)"
                  onClick={() => {
                    descartarFallido(f.id);
                    setFall(fallidos());
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-red-700 mt-1">{f.error}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
