// Contratos compartidos entre API y PWA (DTOs, enums, tipos).
// Importar SOLO desde @wms/shared; este paquete no depende de ningún módulo.

/** Respuesta del endpoint de salud GET /api/health. */
export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  ts: string;
}

/**
 * Estados de la cabecera de una autorización de devolución (Módulo 1).
 * Stub presente desde el día 1 para fijar el contrato; la máquina de
 * estados se implementa en la etapa de Devoluciones.
 */
export enum EstadoDevolucion {
  A_APROBAR = 'A Aprobar',
  APROBADO = 'Aprobado',
  EN_TRANSITO = 'En tránsito',
  ENTREGADO = 'Entregado',
  EN_PROCESO_DEVOLUCION = 'En proceso de devolución',
  PROCESANDO = 'Procesando',
  VALIDANDO = 'Validando',
  CON_DIFERENCIAS = 'Con diferencias',
  PROCESADO = 'Procesado',
}
