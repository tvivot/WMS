import { Module } from '@nestjs/common';
import { CatalogoModule } from '../../core/catalogo/catalogo.module';
import { AutorizacionController } from './autorizacion.controller';
import { AutorizacionService } from './autorizacion.service';
import { TextFreeUbicacionResolverAdapter } from './puertos/ubicacion-resolver.adapter';
import { UBICACION_RESOLVER } from './puertos/ubicacion-resolver.port';

@Module({
  imports: [CatalogoModule],
  controllers: [AutorizacionController],
  providers: [
    AutorizacionService,
    // Seam de ubicaciones: hoy texto libre. Cuando exista Ubicaciones, se
    // cambia SOLO esta línea por el adapter que delega en UbicacionesPort.
    { provide: UBICACION_RESOLVER, useClass: TextFreeUbicacionResolverAdapter },
  ],
})
export class DevolucionesModule {}
