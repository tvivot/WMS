/**
 * Configuración del conector WooCommerce, leída SOLO de variables de entorno
 * (nunca hardcodear secretos). Si falta alguna, el conector queda inerte.
 *   WOO_URL    = https://tu-tienda.com   (raíz del sitio WooCommerce)
 *   WOO_KEY    = consumer key (ck_...)
 *   WOO_SECRET = consumer secret (cs_...)
 */
export interface WooConfig {
  url: string;
  key: string;
  secret: string;
}

export function leerWooConfig(): WooConfig | null {
  const url = process.env.WOO_URL?.trim();
  const key = process.env.WOO_KEY?.trim();
  const secret = process.env.WOO_SECRET?.trim();
  if (!url || !key || !secret) return null;
  return { url: url.replace(/\/+$/, ''), key, secret };
}

/** Origen (scheme+host) de WOO_URL para sumarlo al CSP img-src; null si no hay. */
export function wooImgHost(): string | null {
  const u = process.env.WOO_URL?.trim();
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}
