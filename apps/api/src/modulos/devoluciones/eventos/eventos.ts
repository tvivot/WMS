/**
 * Eventos de dominio que emite Devoluciones. Otros módulos (Inventario,
 * Integraciones) se suscriben sin acoplarse a internos de Devoluciones.
 * Contrato estable — documentar cambios en docs/contratos/.
 */

export const DEVOLUCION_ESTADO_CAMBIADO = 'devolucion.estado_cambiado';
export const DEVOLUCION_PROCESADA = 'devolucion.procesada';

export interface DevolucionEstadoCambiadoEvent {
  autorizacionId: number;
  estadoAnterior: string;
  estadoNuevo: string;
  actorId: number;
  actorTipo: 'usuario' | 'cliente';
  ts: string;
}

export interface ReconciliacionLinea {
  isbn: string;
  productoId: number | null;
  titulo: string | null;
  declarado: number;
  recibido: number;
  bueno: number;
  malo: number;
}

export interface DevolucionProcesadaEvent {
  autorizacionId: number;
  clienteId: number;
  depositoId: number;
  reconciliacion: ReconciliacionLinea[];
  /** Informativas: pueden venir vacías (las ubicaciones no son obligatorias). */
  ubicacionDestinoBueno?: string;
  ubicacionDestinoMalo?: string;
  /** true cuando re-emite por una corrección post-Procesado (reemplaza el resultado anterior). */
  correccion?: boolean;
  ts: string;
}
