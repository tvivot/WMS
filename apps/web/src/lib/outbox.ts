import { api, ApiError } from './api';

/**
 * Outbox offline para el control de bultos: si la red se cae al enviar un
 * control, se guarda localmente y se reintenta automáticamente al volver online
 * (PWA: no perder un control por caída de red). Los errores REALES de negocio
 * (HTTP 4xx) NO se encolan: se devuelven para mostrarlos.
 */

export interface ControlPendiente {
  id: string;
  autorizacionId: number;
  numero: number;
  body: unknown;
  ts: number;
}

const KEY = 'wms_outbox_control';
const listeners = new Set<() => void>();

function leer(): ControlPendiente[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}
function escribir(items: ControlPendiente[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}

export function pendientes(): ControlPendiente[] {
  return leer();
}
export function cantidadPendiente(): number {
  return leer().length;
}
export function suscribir(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function esErrorDeRed(err: unknown): boolean {
  // ApiError = respuesta HTTP (negocio). Cualquier otra cosa (TypeError de
  // fetch) o estar offline = problema de red.
  if (err instanceof ApiError) return false;
  return true;
}

/**
 * Envía un control. Devuelve {ok:true} si se envió, {encolado:true} si se
 * guardó offline. Lanza si es un error de negocio (para mostrarlo en la UI).
 */
export async function enviarControl(
  autorizacionId: number,
  numero: number,
  body: unknown,
): Promise<{ ok?: true; encolado?: true }> {
  const path = `/devoluciones/autorizaciones/${autorizacionId}/bultos/${numero}/control`;
  if (!navigator.onLine) {
    encolar({ autorizacionId, numero, body });
    return { encolado: true };
  }
  try {
    await api.post(path, body);
    return { ok: true };
  } catch (err) {
    if (esErrorDeRed(err)) {
      encolar({ autorizacionId, numero, body });
      return { encolado: true };
    }
    throw err;
  }
}

function encolar(p: Omit<ControlPendiente, 'id' | 'ts'>): void {
  const items = leer();
  // Dedupe por autorizacion+bulto: el último control gana.
  const filtrados = items.filter(
    (i) => !(i.autorizacionId === p.autorizacionId && i.numero === p.numero),
  );
  filtrados.push({
    ...p,
    id: `${p.autorizacionId}-${p.numero}-${Date.now()}`,
    ts: Date.now(),
  });
  escribir(filtrados);
}

let sincronizando = false;

/** Reintenta enviar todos los pendientes. Devuelve cuántos se sincronizaron. */
export async function sincronizar(): Promise<number> {
  if (sincronizando || !navigator.onLine) return 0;
  sincronizando = true;
  let ok = 0;
  try {
    for (const item of leer()) {
      const path = `/devoluciones/autorizaciones/${item.autorizacionId}/bultos/${item.numero}/control`;
      try {
        await api.post(path, item.body);
        escribir(leer().filter((i) => i.id !== item.id));
        ok++;
      } catch (err) {
        if (err instanceof ApiError) {
          // Error de negocio: lo descartamos para no trabar la cola (quedó obsoleto).
          escribir(leer().filter((i) => i.id !== item.id));
        } else {
          // Red: cortamos y reintentamos después.
          break;
        }
      }
    }
  } finally {
    sincronizando = false;
  }
  return ok;
}

/** Engancha reintentos automáticos: al volver online y cada 20s. */
export function iniciarOutbox(): void {
  window.addEventListener('online', () => void sincronizar());
  setInterval(() => {
    if (cantidadPendiente() > 0) void sincronizar();
  }, 20_000);
  if (cantidadPendiente() > 0) void sincronizar();
}
