/**
 * Catálogo de permisos granulares (RBAC). Los roles son paquetes de permisos
 * configurables por el Administrador. Estos códigos son el contrato estable.
 */
export const PERMISOS = {
  SOLICITUD_CREAR: 'solicitud.crear',
  SOLICITUD_APROBAR: 'solicitud.aprobar',
  DEPOSITO_RECIBIR: 'deposito.recibir',
  DEPOSITO_INGRESAR: 'deposito.ingresar',
  DEPOSITO_CONTROLAR: 'deposito.controlar',
  CLIENTE_ADMINISTRAR: 'cliente.administrar',
  USUARIO_ADMINISTRAR: 'usuario.administrar',
  ROL_ADMINISTRAR: 'rol.administrar',
  INFORMES_VER: 'informes.ver',
  CATALOGO_ADMINISTRAR: 'catalogo.administrar',
  TRANSPORTISTA_ADMINISTRAR: 'transportista.administrar',
  MOTIVO_ADMINISTRAR: 'motivo.administrar',
  NOTIFICACIONES_ADMINISTRAR: 'notificaciones.administrar',
  DEVOLUCION_CORREGIR: 'devolucion.corregir',
  DEVOLUCION_STOCK_VER: 'devolucion.stock.ver',
  CONSIGNACION_IMPORTAR: 'consignacion.importar',
  DEVOLUCION_AUTORIZAR_EXCEPCION: 'devolucion.autorizar_excepcion',
} as const;

export type PermisoCodigo = (typeof PERMISOS)[keyof typeof PERMISOS];

export const PERMISOS_DESCRIPCION: Record<string, string> = {
  [PERMISOS.SOLICITUD_CREAR]: 'Crear solicitudes de devolución',
  [PERMISOS.SOLICITUD_APROBAR]: 'Aprobar solicitudes de devolución',
  [PERMISOS.DEPOSITO_RECIBIR]: 'Recibir mercadería en depósito',
  [PERMISOS.DEPOSITO_INGRESAR]: 'Registrar ingreso/ubicación en depósito',
  [PERMISOS.DEPOSITO_CONTROLAR]: 'Controlar bultos en depósito',
  [PERMISOS.CLIENTE_ADMINISTRAR]: 'Administrar clientes',
  [PERMISOS.USUARIO_ADMINISTRAR]: 'Administrar usuarios',
  [PERMISOS.ROL_ADMINISTRAR]: 'Administrar roles y permisos',
  [PERMISOS.INFORMES_VER]: 'Ver informes',
  [PERMISOS.CATALOGO_ADMINISTRAR]: 'Administrar catálogo de productos',
  [PERMISOS.TRANSPORTISTA_ADMINISTRAR]: 'Administrar transportistas',
  [PERMISOS.MOTIVO_ADMINISTRAR]: 'Administrar motivos de devolución',
  [PERMISOS.NOTIFICACIONES_ADMINISTRAR]:
    'Administrar notificaciones por email (grupos y reglas por estado)',
  [PERMISOS.DEVOLUCION_CORREGIR]:
    'Corregir devoluciones ya procesadas (queda en auditoría)',
  [PERMISOS.DEVOLUCION_STOCK_VER]:
    'Ver el stock de libros en devoluciones (ingresadas, sin procesar)',
  [PERMISOS.CONSIGNACION_IMPORTAR]:
    'Importar el saldo en consignación desde el ERP (integrador)',
  [PERMISOS.DEVOLUCION_AUTORIZAR_EXCEPCION]:
    'Autorizar devolución de libros fuera de la consignación del cliente',
};

const TODOS = Object.values(PERMISOS);

/** Mapa de roles por defecto (editable por el Administrador). */
export const ROLES_DEFAULT: Array<{
  nombre: string;
  descripcion: string;
  permisos: string[];
}> = [
  {
    nombre: 'Vendedor',
    descripcion: 'Crea y puede aprobar solicitudes; ve informes',
    permisos: [
      PERMISOS.SOLICITUD_CREAR,
      PERMISOS.SOLICITUD_APROBAR,
      PERMISOS.INFORMES_VER,
      PERMISOS.DEVOLUCION_STOCK_VER,
    ],
  },
  {
    nombre: 'Gerencial',
    descripcion: 'Crea/aprueba solicitudes, administra clientes, ve informes',
    permisos: [
      PERMISOS.SOLICITUD_CREAR,
      PERMISOS.SOLICITUD_APROBAR,
      PERMISOS.CLIENTE_ADMINISTRAR,
      PERMISOS.TRANSPORTISTA_ADMINISTRAR,
      PERMISOS.INFORMES_VER,
      PERMISOS.DEVOLUCION_STOCK_VER,
      PERMISOS.DEVOLUCION_AUTORIZAR_EXCEPCION,
    ],
  },
  {
    nombre: 'Deposito',
    descripcion: 'Recibe, ingresa y controla mercadería',
    permisos: [
      PERMISOS.DEPOSITO_RECIBIR,
      PERMISOS.DEPOSITO_INGRESAR,
      PERMISOS.DEPOSITO_CONTROLAR,
      PERMISOS.DEVOLUCION_STOCK_VER,
    ],
  },
  {
    nombre: 'Administrador',
    descripcion: 'Acceso total',
    permisos: TODOS,
  },
];

/** Permisos implícitos del login de cliente externo (solo lo suyo). */
export const PERMISOS_CLIENTE: string[] = [PERMISOS.SOLICITUD_CREAR];
