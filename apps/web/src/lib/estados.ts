export type Estado =
  | 'A_APROBAR'
  | 'APROBADO'
  | 'EN_TRANSITO'
  | 'ENTREGADO'
  | 'INGRESO_DEPOSITO'
  | 'PROCESADO';

export const ESTADOS_ORDEN: Estado[] = [
  'A_APROBAR',
  'APROBADO',
  'EN_TRANSITO',
  'ENTREGADO',
  'INGRESO_DEPOSITO',
  'PROCESADO',
];

export const ESTADO_LABEL: Record<Estado, string> = {
  A_APROBAR: 'A Aprobar',
  APROBADO: 'Aprobado',
  EN_TRANSITO: 'En tránsito',
  ENTREGADO: 'Entregado',
  INGRESO_DEPOSITO: 'Ingreso a depósito',
  PROCESADO: 'Procesado',
};

/** Clases Tailwind por estado (texto + fondo) para badges. */
export const ESTADO_CLASE: Record<Estado, string> = {
  A_APROBAR: 'bg-amber-100 text-amber-800',
  APROBADO: 'bg-sky-100 text-sky-800',
  EN_TRANSITO: 'bg-indigo-100 text-indigo-800',
  ENTREGADO: 'bg-violet-100 text-violet-800',
  INGRESO_DEPOSITO: 'bg-cyan-100 text-cyan-800',
  PROCESADO: 'bg-emerald-100 text-emerald-800',
};

export const PERMISOS = {
  SOLICITUD_CREAR: 'solicitud.crear',
  SOLICITUD_APROBAR: 'solicitud.aprobar',
  DEPOSITO_RECIBIR: 'deposito.recibir',
  DEPOSITO_INGRESAR: 'deposito.ingresar',
  DEPOSITO_CONTROLAR: 'deposito.controlar',
  CATALOGO_ADMINISTRAR: 'catalogo.administrar',
  INFORMES_VER: 'informes.ver',
} as const;
