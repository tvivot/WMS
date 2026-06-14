import { Controller, Get, Post } from '@nestjs/common';
import { RequierePermiso } from '../../core/auth/decoradores';
import { PERMISOS } from '../../core/auth/permisos';
import { WooCommerceService } from './woocommerce.service';

/**
 * Disparo manual y estado del conector WooCommerce (solo catálogo.administrar).
 * Útil para probar la sincronización a demanda y ver el resultado.
 */
@RequierePermiso(PERMISOS.CATALOGO_ADMINISTRAR)
@Controller('integraciones/woocommerce')
export class WooCommerceController {
  constructor(private readonly woo: WooCommerceService) {}

  @Get('estado')
  estado() {
    return { configurado: this.woo.estaConfigurado(), variables: this.woo.detalleConfig() };
  }

  /** Completa portadas faltantes desde WooCommerce (SKU = ISBN) y devuelve el resumen. */
  @Post('sync-imagenes')
  sync() {
    return this.woo.sincronizarImagenes();
  }
}
