export type Estado =
  | 'A_APROBAR'
  | 'APROBADO'
  | 'EN_TRANSITO'
  | 'ENTREGADO'
  | 'EN_PROCESO_DEVOLUCION'
  | 'PROCESANDO'
  | 'VALIDANDO'
  | 'CON_DIFERENCIAS'
  | 'PROCESADO';

export const ESTADOS_ORDEN: Estado[] = [
  'A_APROBAR',
  'APROBADO',
  'EN_TRANSITO',
  'ENTREGADO',
  'EN_PROCESO_DEVOLUCION',
  'PROCESANDO',
  'VALIDANDO',
  'CON_DIFERENCIAS',
  'PROCESADO',
];

/**
 * Camino LINEAL para el stepper. CON_DIFERENCIAS es una RAMA de VALIDANDO (no un
 * paso lineal): se excluye para no marcarlo como "pasado" en el camino feliz.
 * Una devolución en CON_DIFERENCIAS se muestra a la altura de VALIDANDO.
 */
export const ESTADOS_LINEA: Estado[] = [
  'A_APROBAR',
  'APROBADO',
  'EN_TRANSITO',
  'ENTREGADO',
  'EN_PROCESO_DEVOLUCION',
  'PROCESANDO',
  'VALIDANDO',
  'PROCESADO',
];

export const ESTADO_LABEL: Record<Estado, string> = {
  A_APROBAR: 'A Aprobar',
  APROBADO: 'Aprobado',
  EN_TRANSITO: 'En tránsito',
  ENTREGADO: 'Entregado',
  EN_PROCESO_DEVOLUCION: 'En proceso de devolución',
  PROCESANDO: 'Procesando',
  VALIDANDO: 'Validando',
  CON_DIFERENCIAS: 'Con diferencias',
  PROCESADO: 'Procesado',
};

/** Clases Tailwind por estado (texto + fondo) para badges. */
export const ESTADO_CLASE: Record<Estado, string> = {
  A_APROBAR: 'bg-amber-100 text-amber-800',
  APROBADO: 'bg-sky-100 text-sky-800',
  EN_TRANSITO: 'bg-indigo-100 text-indigo-800',
  ENTREGADO: 'bg-violet-100 text-violet-800',
  EN_PROCESO_DEVOLUCION: 'bg-cyan-100 text-cyan-800',
  PROCESANDO: 'bg-blue-100 text-blue-800',
  VALIDANDO: 'bg-purple-100 text-purple-800',
  CON_DIFERENCIAS: 'bg-rose-100 text-rose-800',
  PROCESADO: 'bg-emerald-100 text-emerald-800',
};

export const PERMISOS = {
  SOLICITUD_CREAR: 'solicitud.crear',
  SOLICITUD_APROBAR: 'solicitud.aprobar',
  DEPOSITO_RECIBIR: 'deposito.recibir',
  DEPOSITO_INGRESAR: 'deposito.ingresar',
  DEPOSITO_CONTROLAR: 'deposito.controlar',
  CATALOGO_ADMINISTRAR: 'catalogo.administrar',
  CLIENTE_ADMINISTRAR: 'cliente.administrar',
  USUARIO_ADMINISTRAR: 'usuario.administrar',
  ROL_ADMINISTRAR: 'rol.administrar',
  INFORMES_VER: 'informes.ver',
  TRANSPORTISTA_ADMINISTRAR: 'transportista.administrar',
  MOTIVO_ADMINISTRAR: 'motivo.administrar',
  NOTIFICACIONES_ADMINISTRAR: 'notificaciones.administrar',
  DEVOLUCION_CORREGIR: 'devolucion.corregir',
  DEVOLUCION_STOCK_VER: 'devolucion.stock.ver',
  DEVOLUCION_AUTORIZAR_EXCEPCION: 'devolucion.autorizar_excepcion',
  DEVOLUCION_VALIDAR: 'devolucion.validar',
} as const;
