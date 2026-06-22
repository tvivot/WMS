import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import { MotivosService } from './motivos.service';
import { CrearMotivoDto, EditarMotivoDto } from './dto';

@Controller('motivos')
export class MotivosController {
  constructor(private readonly svc: MotivosService) {}

  /**
   * Listado de motivos activos por módulo (default: devoluciones), para el
   * selector al crear. Cualquier actor autenticado (incluye clientes).
   */
  @Get()
  listar(@Query('modulo') modulo?: string) {
    return this.svc.listarPorModulo(modulo || 'devoluciones');
  }

  /** Listado completo para el ABM (incluye inactivos). Ruta literal ANTES de :id. */
  @RequierePermiso(PERMISOS.MOTIVO_ADMINISTRAR)
  @Get('admin')
  listarAdmin(@Query('modulo') modulo?: string) {
    return this.svc.listar(modulo);
  }

  @RequierePermiso(PERMISOS.MOTIVO_ADMINISTRAR)
  @Post()
  crear(@Body() dto: CrearMotivoDto) {
    return this.svc.crear(dto);
  }

  @RequierePermiso(PERMISOS.MOTIVO_ADMINISTRAR)
  @Put(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarMotivoDto) {
    return this.svc.editar(id, dto);
  }
}
