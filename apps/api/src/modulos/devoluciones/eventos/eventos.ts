/**
 * Eventos de dominio que emite Devoluciones. Otros módulos (Inventario,
 * Integraciones) se suscriben sin acoplarse a internos de Devoluciones.
 * Contrato estable — documentar cambios en docs/contratos/.
 */

export const DEVOLUCION_ESTADO_CAMBIADO = 'devolucion.estado_cambiado';
export const DEVOLUCION_PROCESADA = 'devolucion.procesada';
/** Emitido por el chequeo periódico de lotes cuando la reconciliación de una
 *  devolución (declarado vs lote del ERP) está disponible o cambió. Lo consume
 *  Notificaciones para avisar a los responsables. */
export const DEVOLUCION_LOTE_EVALUADO = 'devolucion.lote_evaluado';

export interface DevolucionEstadoCambiadoEvent {
  autorizacionId: number;
  /** Cliente dueño de la devolución. Lo consume Notificaciones (mail al cliente). */
  clienteId: number;
  estadoAnterior: string;
  estadoNuevo: string;
  actorId: number;
  actorTipo: 'usuario' | 'cliente' | 'sistema';
  ts: string;
}

export interface ReconciliacionLinea {
  isbn: string;
  productoId: number | null;
  titulo: string | null;
  /** Declarado por el cliente en el WMS (suma sobre las líneas declaradas). */
  declarado: number;
  /** Cantidad del lote del ERP (Fierro). null = el ISBN no está en el lote (o no hay lote). */
  cantidadFierro: number | null;
  /**
   * declarado - cantidadFierro. null si no hay dato de Fierro para el ISBN.
   * Positivo = el cliente declaró de más (sobrante); negativo = faltante.
   * El control de libros (cantidad real por título) se hace en otro proceso.
   */
  diferencia: number | null;
}

export interface DevolucionLoteEvaluadoEvent {
  autorizacionId: number;
  clienteId: number;
  loteCodigo: string;
  reconciliacion: ReconciliacionLinea[];
  /** true si hay al menos un ISBN con diferencia ≠ 0 entre declarado y lote. */
  hayDiferencias: boolean;
  ts: string;
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
