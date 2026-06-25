/**
 * Configuración del envío de correo por Microsoft Graph (Office365), leída SOLO
 * de variables de entorno (nunca hardcodear secretos). Si falta alguna, el envío
 * queda deshabilitado: las notificaciones se registran en el log como PENDIENTE
 * y la UI avisa que Office365 no está configurado.
 *
 * Auth: client credentials (app-only) contra Azure AD. La app registrada precisa
 * el permiso de aplicación Mail.Send (con consentimiento de administrador).
 *   O365_TENANT_ID     = id del tenant (directorio) de Azure AD
 *   O365_CLIENT_ID     = id de la app registrada
 *   O365_CLIENT_SECRET = secreto de cliente de la app
 *   MAIL_FROM          = buzón remitente (debe existir en el tenant)
 */
export interface O365Config {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;
}

export function leerO365Config(): O365Config | null {
  const tenantId = process.env.O365_TENANT_ID?.trim();
  const clientId = process.env.O365_CLIENT_ID?.trim();
  const clientSecret = process.env.O365_CLIENT_SECRET?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!tenantId || !clientId || !clientSecret || !from) return null;
  return { tenantId, clientId, clientSecret, from };
}

/** Una variable de entorno de la integración, para la guía de configuración (UI). */
export interface VarO365 {
  /** Nombre de la variable de entorno a cargar en hPanel. */
  nombre: string;
  /** Para qué sirve (texto de ayuda). */
  descripcion: string;
  /** true si está presente en el entorno (NO se expone el valor; es un secreto). */
  presente: boolean;
  /** true si es secreto (nunca se muestra el valor). */
  secreto: boolean;
}

/**
 * Estado detallado de la config para la pantalla de notificaciones: qué variables
 * están cargadas y cuáles faltan. NUNCA devuelve valores de secretos; del remitente
 * (MAIL_FROM, no secreto) sí se devuelve el valor para confirmar a quién sale el mail.
 */
export function estadoO365(): {
  configurado: boolean;
  from: string | null;
  variables: VarO365[];
} {
  const v = {
    tenantId: process.env.O365_TENANT_ID?.trim(),
    clientId: process.env.O365_CLIENT_ID?.trim(),
    clientSecret: process.env.O365_CLIENT_SECRET?.trim(),
    from: process.env.MAIL_FROM?.trim(),
  };
  const variables: VarO365[] = [
    {
      nombre: 'O365_TENANT_ID',
      descripcion: 'ID del directorio (tenant) de Azure AD.',
      presente: !!v.tenantId,
      secreto: false,
    },
    {
      nombre: 'O365_CLIENT_ID',
      descripcion: 'ID de la aplicación registrada en Azure AD.',
      presente: !!v.clientId,
      secreto: false,
    },
    {
      nombre: 'O365_CLIENT_SECRET',
      descripcion: 'Secreto de cliente de la aplicación (valor, no el Secret ID).',
      presente: !!v.clientSecret,
      secreto: true,
    },
    {
      nombre: 'MAIL_FROM',
      descripcion: 'Buzón remitente; debe existir en el tenant.',
      presente: !!v.from,
      secreto: false,
    },
  ];
  return {
    configurado: !!(v.tenantId && v.clientId && v.clientSecret && v.from),
    from: v.from || null,
    variables,
  };
}
