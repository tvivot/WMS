import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { RequierePermiso } from '../../../core/auth/decoradores';
import { PERMISOS } from '../../../core/auth/permisos';
import { InformesService } from './informes.service';

@RequierePermiso(PERMISOS.INFORMES_VER)
@Controller('devoluciones/informes')
export class InformesController {
  constructor(private readonly svc: InformesService) {}

  @Get('resumen')
  resumen() {
    return this.svc.resumen();
  }

  @Get('por-cliente')
  porCliente() {
    return this.svc.porCliente();
  }

  @Get('serie')
  serie() {
    return this.svc.serie();
  }

  /** Clientes con consignación activa (cantidad de libros/títulos). */
  @Get('consignacion')
  consignacion() {
    return this.svc.consignacionPorCliente();
  }

  /** Drill-down: libros que un cliente tiene en consignación. */
  @Get('consignacion/detalle')
  consignacionDetalle(@Query('clienteId', ParseIntPipe) clienteId: number) {
    return this.svc.consignacionDetalle(clienteId);
  }
}
