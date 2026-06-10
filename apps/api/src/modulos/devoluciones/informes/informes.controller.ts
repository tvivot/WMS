import { Controller, Get } from '@nestjs/common';
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
}
