import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { Actor, RequierePermiso } from '../auth/decoradores';
import type { JwtPayload } from '../auth/jwt-payload';
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

  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number, @Actor() actor: JwtPayload) {
    return this.svc.eliminar(id, actor.sub);
  }
}
