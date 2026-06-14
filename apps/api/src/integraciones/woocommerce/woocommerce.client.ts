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

  /**
   * Devuelve la URL de la primera imagen del producto cuyo SKU coincide, o null
   * si no hay producto con ese SKU o no tiene imagen. Lanza si la API falla.
   */
  async imagenPorSku(sku: string): Promise<string | null> {
    const url =
      `${this.cfg.url}/wp-json/wc/v3/products` +
      `?sku=${encodeURIComponent(sku)}&_fields=id,sku,images&per_page=1`;
    const res = await fetch(url, {
      headers: { Authorization: this.auth(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
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
