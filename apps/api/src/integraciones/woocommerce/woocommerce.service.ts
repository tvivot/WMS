import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CatalogoService } from '../../core/catalogo/catalogo.service';
import { leerWooConfig } from './woocommerce.config';
import { WooCommerceClient } from './woocommerce.client';

export interface ResultadoSyncImagenes {
  configurado: boolean;
  revisados: number;
  actualizados: number;
  sinImagen: number;
  errores: { productoId: number; error: string }[];
}

/** Busca la URL de imagen para un SKU (inyectable para testear sin HTTP). */
export type BuscadorImagen = (sku: string) => Promise<string | null>;

/**
 * Conector WooCommerce (Integraciones): completa la portada de los productos
 * del catálogo con la URL de la imagen ya hosteada en WooCommerce, matcheando
 * por SKU = ISBN. No descarga archivos: referencia la URL pública.
 * Inerte si no están las variables WOO_* (no rompe nada hasta configurarlas).
 */
@Injectable()
export class WooCommerceService {
  private readonly logger = new Logger(WooCommerceService.name);

  constructor(private readonly catalogo: CatalogoService) {}

  estaConfigurado(): boolean {
    return leerWooConfig() !== null;
  }

  /**
   * Corrida automática cada 48 h (desde el arranque del proceso) para mantener
   * las portadas al día. No hace nada si WooCommerce no está configurado.
   */
  @Interval('woo-sync-imagenes', 48 * 60 * 60 * 1000)
  async syncProgramado(): Promise<void> {
    if (!this.estaConfigurado()) return;
    const r = await this.sincronizarImagenes();
    this.logger.log(
      `Sync imágenes WooCommerce: ${r.actualizados} actualizadas, ` +
        `${r.sinImagen} sin imagen, ${r.errores.length} errores (de ${r.revisados}).`,
    );
  }

  /** Completa portadas faltantes consultando WooCommerce por SKU = ISBN. */
  async sincronizarImagenes(limite = 200): Promise<ResultadoSyncImagenes> {
    const cfg = leerWooConfig();
    if (!cfg) {
      return { configurado: false, revisados: 0, actualizados: 0, sinImagen: 0, errores: [] };
    }
    const client = new WooCommerceClient(cfg);
    const productos = await this.catalogo.productosSinImagen(limite);
    return this.procesar(productos, (sku) => client.imagenPorSku(sku));
  }

  /**
   * Núcleo testeable: por cada producto prueba sus ISBNs (SKU) hasta encontrar
   * una imagen; si la halla, la guarda como URL externa en el producto.
   */
  async procesar(
    productos: { id: number; isbns: string[] }[],
    buscar: BuscadorImagen,
  ): Promise<ResultadoSyncImagenes> {
    let actualizados = 0;
    let sinImagen = 0;
    const errores: { productoId: number; error: string }[] = [];

    for (const p of productos) {
      try {
        let src: string | null = null;
        for (const isbn of p.isbns) {
          src = await buscar(isbn);
          if (src) break;
        }
        if (src) {
          await this.catalogo.setImagenUrl(p.id, src);
          actualizados++;
        } else {
          sinImagen++;
        }
      } catch (err) {
        errores.push({ productoId: p.id, error: (err as Error).message.slice(0, 200) });
      }
    }

    return { configurado: true, revisados: productos.length, actualizados, sinImagen, errores };
  }
}
