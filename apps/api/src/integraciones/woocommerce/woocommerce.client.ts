import { WooConfig } from './woocommerce.config';

/**
 * Cliente mínimo de la REST API de WooCommerce (v3). Solo lectura.
 * Autentica con consumer key/secret por Basic Auth sobre HTTPS.
 */
export class WooCommerceClient {
  constructor(private readonly cfg: WooConfig) {}

  /**
   * Método de auth detectado para ESTE host: false = alcanza el header Basic;
   * true = el servidor stripea el header (típico hosting WordPress compartido)
   * y hay que mandar las credenciales en el query string. Se descubre con el
   * primer 401/403 y se RECUERDA, para no repetir el request fallido en cada
   * SKU (en un host que stripea serían 2× requests por producto, en cada sync).
   */
  private credsEnUrl = false;

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

  /** Un GET de productos; siempre manda el header Basic (inofensivo si se stripea). */
  private pedir(sku: string, credsEnUrl: boolean): Promise<Response> {
    return fetch(this.urlProductos(sku, credsEnUrl), {
      headers: { Authorization: this.auth(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  }

  /**
   * Devuelve la URL de la primera imagen del producto cuyo SKU coincide, o null
   * si no hay producto con ese SKU o no tiene imagen. Lanza si la API falla.
   *
   * Auth en dos pasos para no filtrar las credenciales en logs: arranca SOLO con
   * el header Basic (las claves no viajan en la URL). Si el servidor stripea el
   * header Authorization y responde 401/403, reintenta con las credenciales en
   * el query string (método soportado por WooCommerce sobre HTTPS) y recuerda
   * esa decisión para los SKUs siguientes.
   */
  async imagenPorSku(sku: string): Promise<string | null> {
    let res = await this.pedir(sku, this.credsEnUrl);
    if (!this.credsEnUrl && (res.status === 401 || res.status === 403)) {
      this.credsEnUrl = true;
      res = await this.pedir(sku, true);
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
