/**
 * Utilidades de plantilla y destinatarios para las notificaciones por email.
 * Sin dependencias del módulo Devoluciones (transversal).
 */

/** Etiquetas legibles por estado (paridad con el front y el export). */
export const ESTADO_LABEL: Record<string, string> = {
  A_APROBAR: 'A aprobar',
  APROBADO: 'Aprobado',
  EN_TRANSITO: 'En tránsito',
  ENTREGADO: 'Entregado',
  EN_PROCESO_DEVOLUCION: 'En proceso de devolución',
  PROCESANDO: 'Procesando',
  VALIDANDO: 'Validando',
  CON_DIFERENCIAS: 'Con diferencias',
  PROCESADO: 'Procesado',
};

export function estadoLabel(estado: string): string {
  return ESTADO_LABEL[estado] ?? estado;
}

export interface ContextoPlantilla {
  nro: number | string;
  cliente: string;
  estado: string;
  estadoAnterior?: string;
  fecha: string;
  /** Texto libre extra (p.ej. el detalle de diferencias de un chequeo de lote). */
  detalle?: string;
}

/**
 * Reemplaza los placeholders {{clave}} por su valor del contexto. Una clave sin
 * valor se deja vacía (no rompe el envío). Tolera espacios: {{ nro }}.
 */
export function renderPlantilla(plantilla: string, ctx: ContextoPlantilla): string {
  const valores: Record<string, string> = {
    nro: String(ctx.nro),
    cliente: ctx.cliente,
    estado: estadoLabel(ctx.estado),
    estadoAnterior: ctx.estadoAnterior ? estadoLabel(ctx.estadoAnterior) : '',
    fecha: ctx.fecha,
    detalle: ctx.detalle ?? '',
  };
  return plantilla.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, clave: string) =>
    clave in valores ? valores[clave] : m,
  );
}

/**
 * Validación de email deliberadamente simple (local@dominio.tld sin espacios).
 * No pretende cubrir todo el RFC: filtra basura para que UN destinatario
 * malformado no tire abajo el envío entero a Graph (sendMail es todo-o-nada).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esEmailValido(email: string): boolean {
  return EMAIL_RE.test(email);
}

/**
 * Parte una lista de emails (coma, punto y coma o salto de línea), recorta,
 * descarta vacíos/inválidos y deduplica preservando el orden (case-insensitive).
 */
export function parsearEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const parte of raw.split(/[,;\n\r]+/)) {
    const email = parte.trim();
    if (!email || !esEmailValido(email)) continue;
    const clave = email.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(email);
  }
  return out;
}

/** Une varias listas de emails deduplicando (case-insensitive). */
export function unirEmails(...listas: string[][]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const lista of listas) {
    for (const email of lista) {
      const clave = email.toLowerCase();
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      out.push(email);
    }
  }
  return out;
}
