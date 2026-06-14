import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CatalogoService } from '../../core/catalogo/catalogo.service';
import { leerWooConfig } from './woocommerce.config';
import { WooCommerceClient } from './woocommerce.client';
import { enBloques } from '../../core/util/bloques';

export interface ResultadoSyncImagenes {
  configurado: boolean;
  revisados: number;
  actualizados: number;
  sinImagen: number;
  errores: { productoId: number; error: string }[];
  /** true si se rechazó por haber ya una corrida en progreso (no se arrancó otra). */
  enCurso?: boolean;
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
  /** Evita que dos corridas del @Interval se solapen si una tarda de más. */
  private sincEnCurso = false;

  constructor(private readonly catalogo: CatalogoService) {}

  estaConfigurado(): boolean {
    return leerWooConfig() !== null;
  }

  /**
   * Presencia de cada variable (NO devuelve los valores: solo true/false) para
   * que el admin pueda diagnosticar qué falta sin exponer secretos.
   */
  detalleConfig(): { url: boolean; key: boolean; secret: boolean } {
    return {
      url: !!process.env.WOO_URL?.trim(),
      key: !!process.env.WOO_KEY?.trim(),
      secret: !!process.env.WOO_SECRET?.trim(),
    };
  }

  /**
   * Corrida automática cada 48 h (desde el arranque del proceso) para mantener
   * las portadas al día. No hace nada si WooCommerce no está configurado.
   */
  @Interval('woo-sync-imagenes', 48 * 60 * 60 * 1000)
  async syncProgramado(): Promise<void> {
    if (!this.estaConfigurado()) return;
    try {
      const r = await this.sincronizarImagenes();
      if (r.enCurso) return; // ya había una corrida en progreso
      this.logger.log(
        `Sync imágenes WooCommerce: ${r.actualizados} actualizadas, ` +
          `${r.sinImagen} sin imagen, ${r.errores.length} errores (de ${r.revisados}).`,
      );
    } catch (err) {
      this.logger.error(`Sync imágenes WooCommerce falló: ${(err as Error).message}`);
    }
  }

  /**
   * Completa portadas faltantes consultando WooCommerce por SKU = ISBN.
   * Recorre TODO el catálogo sin imagen paginando por cursor de `id` (de a 200),
   * hasta agotar o llegar a `maxProductos`. Antes solo hacía una página de 200 y,
   * como los irresolubles quedaban al frente, nunca avanzaba más allá.
   *
   * Guard de reentrancia (compartido cron + disparo manual): si ya hay una
   * corrida en progreso devuelve `enCurso: true` sin arrancar otra en paralelo
   * (evita duplicar carga contra WooCommerce y la DB).
   */
  async sincronizarImagenes(maxProductos = Infinity): Promise<ResultadoSyncImagenes> {
    const cfg = leerWooConfig();
    if (!cfg) {
      return { configurado: false, revisados: 0, actualizados: 0, sinImagen: 0, errores: [] };
    }
    if (this.sincEnCurso) {
      return { configurado: true, revisados: 0, actualizados: 0, sinImagen: 0, errores: [], enCurso: true };
    }
    this.sincEnCurso = true;
    try {
      const client = new WooCommerceClient(cfg);
      const acc: ResultadoSyncImagenes = {
        configurado: true, revisados: 0, actualizados: 0, sinImagen: 0, errores: [],
      };
      const PAGINA = 200;
      let desdeId = 0;
      while (acc.revisados < maxProductos) {
        const productos = await this.catalogo.productosSinImagen({ limite: PAGINA, desdeId });
        if (productos.length === 0) break;
        const r = await this.procesar(productos, (sku) => client.imagenPorSku(sku));
        acc.revisados += r.revisados;
        acc.actualizados += r.actualizados;
        acc.sinImagen += r.sinImagen;
        acc.errores.push(...r.errores);
        desdeId = productos[productos.length - 1].id; // cursor: avanza siempre
      }
      return acc;
    } finally {
      this.sincEnCurso = false;
    }
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

    // Procesa un producto: prueba sus ISBN (SKU) hasta encontrar imagen.
    const procesarUno = async (p: { id: number; isbns: string[] }): Promise<void> => {
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
    };

    // Concurrencia acotada: antes era 1 request HTTP por ISBN en serie (con
    // timeout de 15s c/u → el lote de 200 se hacía eterno). Se procesan
    // CONCURRENCIA productos en paralelo por bloque, sin saturar al servidor
    // de WooCommerce. Los contadores se actualizan en el hilo único de JS.
    const CONCURRENCIA = 8;
    for (const bloque of enBloques(productos, CONCURRENCIA)) {
      await Promise.all(bloque.map(procesarUno));
    }

    return { configurado: true, revisados: productos.length, actualizados, sinImagen, errores };
  }
}
