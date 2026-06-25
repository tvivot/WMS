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
import { NotificacionesService } from './notificaciones.service';
import {
  CrearGrupoDto,
  EditarGrupoDto,
  EditarReglaDto,
  TestEnvioDto,
} from './dto';

/** Administración de notificaciones por email (grupos, reglas por estado, prueba). */
@RequierePermiso(PERMISOS.NOTIFICACIONES_ADMINISTRAR)
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly svc: NotificacionesService) {}

  @Get('estado')
  estado() {
    return this.svc.estado();
  }

  // ---- Grupos ----

  @Get('grupos')
  listarGrupos() {
    return this.svc.listarGrupos();
  }

  @Post('grupos')
  crearGrupo(@Body() dto: CrearGrupoDto) {
    return this.svc.crearGrupo(dto);
  }

  @Put('grupos/:id')
  editarGrupo(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarGrupoDto) {
    return this.svc.editarGrupo(id, dto);
  }

  /** Usuarios internos con email, para el selector de destinos de una regla. */
  @Get('usuarios')
  usuarios() {
    return this.svc.listarUsuariosNotificables();
  }

  // ---- Reglas por estado ----

  @Get('reglas')
  listarReglas(@Query('modulo') modulo?: string) {
    return this.svc.listarReglas(modulo || 'devoluciones');
  }

  @Put('reglas/:id')
  editarRegla(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarReglaDto) {
    return this.svc.editarRegla(id, dto);
  }

  // ---- Prueba ----

  @Post('test')
  test(@Body() dto: TestEnvioDto) {
    return this.svc.enviarPrueba(dto.to);
  }
}
