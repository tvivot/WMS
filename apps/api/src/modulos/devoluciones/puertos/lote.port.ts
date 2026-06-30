/**
 * Puerto inbound de los lotes de devolución del ERP (Fierro). El dato es dueño
 * de Devoluciones (tablas dev_lote / dev_lote_item) y entra SOLO por acá:
 * Integraciones llama a importarLotes() con lo que manda el ERP, sin tocar
 * internos de Devoluciones. Identidad por `codigo` (= return_lot.document_id):
 * upsert idempotente que reemplaza los renglones del lote.
 *
 * La reconciliación (intra-módulo) lee dev_lote directamente; este puerto es
 * solo la entrada del integrador (cross-módulo).
 */

/** Renglón de un lote enviado por el ERP (validado por DTO en Integraciones). */
export interface LoteImportItem {
  isbn: string;
  cantidad: number;
  cantidadCliente?: number | null;
  cantidadRechazada?: number | null;
  titulo?: string | null;
  intCode?: string | null;
}

/** Cabecera + renglones de un lote enviado por el ERP. */
export interface LoteImport {
  /** Identidad idempotente (= return_lot.document_id de Fierro). */
  codigo: string;
  numero?: string | null;
  fecha?: string | null;
  nroCliente: string;
  clienteNombre?: string | null;
  deposito?: string | null;
  estado?: string | null;
  motivo?: string | null;
  remitoCliente?: string | null;
  fechaRemitoCliente?: string | null;
  totalItems?: number | null;
  items: LoteImportItem[];
}

export interface LoteImportResultado {
  recibidos: number;
  creados: number;
  actualizados: number;
  /** Lotes que no se pudieron procesar, con el motivo (no abortan el resto). */
  errores: { codigo: string; error: string }[];
}

export interface DevolucionesLotePort {
  /**
   * Upsert por `codigo` de los lotes del ERP, reemplazando los renglones de cada
   * uno. Idempotente: reenviar el mismo lote deja el mismo estado.
   */
  importarLotes(lotes: LoteImport[]): Promise<LoteImportResultado>;
}

/** Token de inyección del puerto. */
export const DEVOLUCIONES_LOTE_PORT = Symbol('DEVOLUCIONES_LOTE_PORT');
