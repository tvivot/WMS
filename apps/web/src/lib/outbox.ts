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

/** Control encolado que el servidor RECHAZÓ al resincronizar (error de negocio). */
export interface ControlFallido extends ControlPendiente {
  error: string;
}

const KEY = 'wms_outbox_control';
const KEY_FALLIDOS = 'wms_outbox_fallidos';
const listeners = new Set<() => void>();

function leerDe<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}
const leer = () => leerDe<ControlPendiente>(KEY);
const leerFallidos = () => leerDe<ControlFallido>(KEY_FALLIDOS);

function escribir(items: ControlPendiente[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}
function escribirFallidos(items: ControlFallido[]): void {
  localStorage.setItem(KEY_FALLIDOS, JSON.stringify(items));
  listeners.forEach((l) => l());
}

export function pendientes(): ControlPendiente[] {
  return leer();
}
export function cantidadPendiente(): number {
  return leer().length;
}
export function fallidos(): ControlFallido[] {
  return leerFallidos();
}
export function descartarFallido(id: string): void {
  escribirFallidos(leerFallidos().filter((f) => f.id !== id));
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
          // Error de negocio: NO se descarta en silencio — pasa a la lista de
          // fallidos para que el operario lo vea y decida (es un control
          // hecho offline que el servidor rechazó).
          escribir(leer().filter((i) => i.id !== item.id));
          escribirFallidos([...leerFallidos(), { ...item, error: err.message }]);
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

let outboxIniciado = false;

/** Engancha reintentos automáticos: al volver online y cada 20s. */
export function iniciarOutbox(): void {
  // Idempotente: el outbox es un singleton de por vida (se arranca una vez en
  // el boot). El guard evita duplicar el listener y el interval ante un HMR en
  // desarrollo (que volvería a ejecutar este módulo).
  if (outboxIniciado) return;
  outboxIniciado = true;
  window.addEventListener('online', () => void sincronizar());
  setInterval(() => {
    if (cantidadPendiente() > 0) void sincronizar();
  }, 20_000);
  if (cantidadPendiente() > 0) void sincronizar();
}
