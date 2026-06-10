import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import { RolesService } from './roles.service';
import { CrearRolDto, EditarRolDto } from './dto';

@RequierePermiso(PERMISOS.ROL_ADMINISTRAR)
@Controller('roles')
export class RolesController {
  constructor(private readonly svc: RolesService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  /** Catálogo de permisos disponibles para asignar. */
  @Get('permisos')
  permisos() {
    return this.svc.catalogoPermisos();
  }

  @Post()
  crear(@Body() dto: CrearRolDto) {
    return this.svc.crear(dto);
  }

  @Put(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarRolDto) {
    return this.svc.editar(id, dto);
  }
}
