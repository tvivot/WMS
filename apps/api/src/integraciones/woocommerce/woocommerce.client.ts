import { WooConfig } from './woocommerce.config';

/**
 * Cliente mínimo de la REST API de WooCommerce (v3). Solo lectura.
 * Autentica con consumer key/secret por Basic Auth sobre HTTPS.
 */
export class WooCommerceClient {
  constructor(private readonly cfg: WooConfig) {}

  private auth(): string {
    return 'Basic ' + Buffer.from(`${this.cfg.key}:${this.cfg.secret}`).toString('base64');
  }

  /** Arma la URL de consulta; con `credsEnUrl` agrega key/secret al query string. */
  private urlProductos(sku: string, credsEnUrl: boolean): string {
    const params = new URLSearchParams({ sku, _fields: 'id,sku,images', per_page: '1' });
    if (credsEnUrl) {
      params.set('consumer_key', this.cfg.key);
      params.set('consumer_secret', this.cfg.secret);
    }
    return `${this.cfg.url}/wp-json/wc/v3/products?${params.toString()}`;
  }

  /**
   * Devuelve la URL de la primera imagen del producto cuyo SKU coincide, o null
   * si no hay producto con ese SKU o no tiene imagen. Lanza si la API falla.
   *
   * Autenticación en dos pasos para no filtrar las credenciales en logs: primero
   * intenta SOLO con el header Basic (las claves no viajan en la URL). Si el
   * servidor stripea el header Authorization (típico en hosting WordPress
   * compartido) y responde 401, reintenta con las credenciales en el query
   * string — método soportado por WooCommerce sobre HTTPS.
   */
  async imagenPorSku(sku: string): Promise<string | null> {
    let res = await fetch(this.urlProductos(sku, false), {
      headers: { Authorization: this.auth(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      res = await fetch(this.urlProductos(sku, true), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    }
    if (!res.ok) {
      // El cuerpo de WooCommerce trae el motivo real (p. ej. code
      // "woocommerce_rest_authentication_error" / "Consumer key is invalid").
      let detalle = '';
      try {
        const cuerpo = (await res.json()) as { code?: string; message?: string };
        detalle = [cuerpo.code, cuerpo.message].filter(Boolean).join(': ');
      } catch {
        detalle = (await res.text().catch(() => '')).slice(0, 120);
      }
      throw new Error(`WooCommerce HTTP ${res.status}${detalle ? ` — ${detalle}` : ''}`);
    }
    const data = (await res.json()) as Array<{ images?: { src?: string }[] }>;
    const producto = Array.isArray(data) ? data[0] : undefined;
    const src = producto?.images?.[0]?.src;
    return src && src.trim() ? src.trim() : null;
  }
}
