import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import { UsuariosService } from './usuarios.service';
import { CrearUsuarioDto, EditarUsuarioDto, ResetClaveDto } from './dto';

@RequierePermiso(PERMISOS.USUARIO_ADMINISTRAR)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly svc: UsuariosService) {}

  @Get()
  listar(@Query('q') q?: string) {
    return this.svc.listar(q);
  }

  /** Roles disponibles (para asignar en el ABM). */
  @Get('roles')
  roles() {
    return this.svc.listarRoles();
  }

  @Post()
  crear(@Body() dto: CrearUsuarioDto) {
    return this.svc.crear(dto);
  }

  @Put(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarUsuarioDto) {
    return this.svc.editar(id, dto);
  }

  @Post(':id/reset-clave')
  reset(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetClaveDto) {
    return this.svc.resetClave(id, dto.clave);
  }
}
