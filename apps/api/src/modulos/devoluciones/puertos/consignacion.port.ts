/**
 * Puerto inbound del saldo en consignación. El dato es dueño de Devoluciones
 * (tabla dev_consignacion_saldo) y entra SOLO por acá: Integraciones llama a
 * cargarSaldos() con el snapshot del ERP, sin tocar internos de Devoluciones.
 *
 * Si más adelante existe un módulo "Consignaciones" con el ciclo completo,
 * pasa a ser dueño de la tabla y expone su propio adapter: se cambia UNA línea
 * en devoluciones.module.ts (igual que UBICACION_RESOLVER), sin tocar el resto.
 */

/** Item crudo del snapshot del ERP (validado por DTO en Integraciones). */
export interface ConsignacionSaldoItem {
  /** Número de cliente del ERP; se resuelve a clienteId vía core_cliente. */
  nroCliente: string;
  /** ISBN; se normaliza (ISBN-10 → ISBN-13) antes de guardar. */
  isbn: string;
  /** Unidades en consignación (libros que el cliente tiene sin comprar). */
  cantidad: number;
}

export interface ConsignacionCargaResultado {
  recibidos: number;
  /** Clientes afectados (con al menos una línea válida). */
  clientes: number;
  /** Filas reemplazadas/insertadas. */
  upserts: number;
  /** nroCliente del snapshot no encontrados en core_cliente (no abortan). */
  clientesDesconocidos: string[];
  errores: { isbn: string; error: string }[];
}

export interface ConsignacionPort {
  /**
   * Carga el snapshot del ERP. Semántica full-replace POR CLIENTE: reemplaza
   * todos los saldos de cada cliente presente en el lote. Idempotente.
   * snapshotTs marca el instante del snapshot (descarta cargas fuera de orden).
   */
  cargarSaldos(
    snapshotTs: string,
    items: ConsignacionSaldoItem[],
  ): Promise<ConsignacionCargaResultado>;

  /**
   * Lookup batch para la reconciliación: saldo en consignación por ISBN para un
   * cliente. La clave del Map es el ISBN normalizado; ausencia de clave = sin
   * dato (no es violación, no marca exceso).
   */
  saldosDe(clienteId: number, isbns: string[]): Promise<Map<string, number>>;
}

/** Token de inyección del puerto. */
export const CONSIGNACION_PORT = Symbol('CONSIGNACION_PORT');
