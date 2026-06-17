import { Module } from '@nestjs/common';
import { CatalogoModule } from '../core/catalogo/catalogo.module';
import { DevolucionesModule } from '../modulos/devoluciones/devoluciones.module';
import { WooCommerceController } from './woocommerce/woocommerce.controller';
import { WooCommerceService } from './woocommerce/woocommerce.service';
import { ConsignacionController } from './consignacion/consignacion.controller';

/**
 * Plataforma de Integraciones: el ÚNICO lugar que habla con sistemas externos.
 * Hoy: conector WooCommerce (portadas de productos por SKU = ISBN) e import de
 * saldo en consignación del ERP (delega en el puerto inbound de Devoluciones).
 * Usa los módulos de dominio por sus puertos/servicios públicos; no toca internos.
 */
@Module({
  imports: [CatalogoModule, DevolucionesModule],
  controllers: [WooCommerceController, ConsignacionController],
  providers: [WooCommerceService],
})
export class IntegracionesModule {}
