import { Module } from '@nestjs/common';
import { CatalogoModule } from '../../core/catalogo/catalogo.module';
import { AutorizacionController } from './autorizacion.controller';
import { AutorizacionService } from './autorizacion.service';
import { LoteScheduler } from './lote-scheduler';
import { InformesController } from './informes/informes.controller';
import { InformesService } from './informes/informes.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { TextFreeUbicacionResolverAdapter } from './puertos/ubicacion-resolver.adapter';
import { UBICACION_RESOLVER } from './puertos/ubicacion-resolver.port';
import { PrismaConsignacionAdapter } from './puertos/consignacion.adapter';
import { CONSIGNACION_PORT } from './puertos/consignacion.port';
import { PrismaLoteAdapter } from './puertos/lote.adapter';
import { DEVOLUCIONES_LOTE_PORT } from './puertos/lote.port';

@Module({
  imports: [CatalogoModule],
  controllers: [AutorizacionController, InformesController, StockController],
  providers: [
    AutorizacionService,
    LoteScheduler,
    InformesService,
    StockService,
    // Seam de ubicaciones: hoy texto libre. Cuando exista Ubicaciones, se
    // cambia SOLO esta línea por el adapter que delega en UbicacionesPort.
    { provide: UBICACION_RESOLVER, useClass: TextFreeUbicacionResolverAdapter },
    // Puerto inbound del saldo en consignación: Integraciones lo invoca para
    // cargar el snapshot del ERP. Dueño del dato = Devoluciones.
    { provide: CONSIGNACION_PORT, useClass: PrismaConsignacionAdapter },
    // Puerto inbound de los lotes de devolución del ERP (Fierro). Dueño = Devoluciones.
    { provide: DEVOLUCIONES_LOTE_PORT, useClass: PrismaLoteAdapter },
  ],
  // Se exportan los puertos para que Integraciones inyecte el token (no internos).
  exports: [CONSIGNACION_PORT, DEVOLUCIONES_LOTE_PORT],
})
export class DevolucionesModule {}
