import { Module } from '@nestjs/common';
import { CatalogoModule } from '../core/catalogo/catalogo.module';
import { WooCommerceController } from './woocommerce/woocommerce.controller';
import { WooCommerceService } from './woocommerce/woocommerce.service';

/**
 * Plataforma de Integraciones: el ÚNICO lugar que habla con sistemas externos.
 * Hoy: conector WooCommerce (portadas de productos por SKU = ISBN).
 * Usa el catálogo (core) por su servicio público; no toca internos de dominio.
 */
@Module({
  imports: [CatalogoModule],
  controllers: [WooCommerceController],
  providers: [WooCommerceService],
})
export class IntegracionesModule {}
