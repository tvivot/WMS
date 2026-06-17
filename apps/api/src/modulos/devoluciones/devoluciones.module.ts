import { Module } from '@nestjs/common';
import { CatalogoModule } from '../../core/catalogo/catalogo.module';
import { AutorizacionController } from './autorizacion.controller';
import { AutorizacionService } from './autorizacion.service';
import { InformesController } from './informes/informes.controller';
import { InformesService } from './informes/informes.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { TextFreeUbicacionResolverAdapter } from './puertos/ubicacion-resolver.adapter';
import { UBICACION_RESOLVER } from './puertos/ubicacion-resolver.port';
import { PrismaConsignacionAdapter } from './puertos/consignacion.adapter';
import { CONSIGNACION_PORT } from './puertos/consignacion.port';

@Module({
  imports: [CatalogoModule],
  controllers: [AutorizacionController, InformesController, StockController],
  providers: [
    AutorizacionService,
    InformesService,
    StockService,
    // Seam de ubicaciones: hoy texto libre. Cuando exista Ubicaciones, se
    // cambia SOLO esta línea por el adapter que delega en UbicacionesPort.
    { provide: UBICACION_RESOLVER, useClass: TextFreeUbicacionResolverAdapter },
    // Puerto inbound del saldo en consignación: Integraciones lo invoca para
    // cargar el snapshot del ERP. Dueño del dato = Devoluciones.
    { provide: CONSIGNACION_PORT, useClass: PrismaConsignacionAdapter },
  ],
  // Se exporta el puerto para que Integraciones inyecte el token (no internos).
  exports: [CONSIGNACION_PORT],
})
export class DevolucionesModule {}
