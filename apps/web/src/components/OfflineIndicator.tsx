import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { cantidadPendiente, sincronizar, suscribir } from '../lib/outbox';

export function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pend, setPend] = useState(cantidadPendiente());
  const [sync, setSync] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const unsub = suscribir(() => setPend(cantidadPendiente()));
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
    setSync(false);
  };

  if (online && pend === 0) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-white/40" title="En línea">
        <Wifi className="h-3.5 w-3.5" /> En línea
      </span>
    );
  }

  return (
    <button
      onClick={reintentar}
      disabled={!online || sync}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold ${
        !online ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-white/80'
      }`}
      title={!online ? 'Sin conexión — los controles se guardan y reintentan' : 'Reintentar sincronización'}
    >
      {!online ? <WifiOff className="h-3.5 w-3.5" /> : pend > 0 ? <CloudOff className="h-3.5 w-3.5" /> : null}
      {!online && 'Offline'}
      {pend > 0 && (
        <>
          <span className="tabnum">{pend}</span> pend.
          {online && <RefreshCw className={`h-3.5 w-3.5 ${sync ? 'animate-spin' : ''}`} />}
        </>
      )}
    </button>
  );
}
