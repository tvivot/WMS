import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Actor, RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import type { JwtPayload } from '../auth/jwt-payload';
import { ClientesService } from './clientes.service';
import { ClientesImportarDto, CrearClienteDto, EditarClienteDto, ResetClaveDto } from './dto';

@Controller('clientes')
export class ClientesController {
  constructor(private readonly svc: ClientesService) {}

  @RequierePermiso(PERMISOS.CLIENTE_ADMINISTRAR)
  @Get()
  listar(@Query('q') q?: string) {
    return this.svc.listar(q);
  }

  /**
   * Autocomplete para formularios: busca por número de cliente o nombre.
   * Lo usan usuarios internos (vendedor/gerencial/depósito); un cliente
   * externo NO puede listar otros clientes.
   */
  @RequierePermiso(PERMISOS.SOLICITUD_CREAR, PERMISOS.CLIENTE_ADMINISTRAR)
  @Get('buscar')
  buscar(@Actor() actor: JwtPayload, @Query('q') q?: string) {
    if (actor.tipo === 'cliente') {
      throw new ForbiddenException('No disponible para clientes');
    }
    return this.svc.buscar(q ?? '');
  }

  @RequierePermiso(PERMISOS.CLIENTE_ADMINISTRAR)
  @Post()
  crear(@Body() dto: CrearClienteDto) {
    return this.svc.crear(dto);
  }

  /**
   * Importación masiva desde el sistema externo (integrador).
   * Upsert por nro_cliente; máx. 1000 por request. Ver docs/integraciones/manual-api-clientes.md
   */
  @RequierePermiso(PERMISOS.CLIENTE_ADMINISTRAR)
  @Post('import')
  importar(@Body() dto: ClientesImportarDto) {
    return this.svc.importar(dto.clientes);
  }

  @RequierePermiso(PERMISOS.CLIENTE_ADMINISTRAR)
  @Put(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarClienteDto) {
    return this.svc.editar(id, dto);
  }

  @RequierePermiso(PERMISOS.CLIENTE_ADMINISTRAR)
  @Post(':id/reset-clave')
  reset(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetClaveDto) {
    return this.svc.resetClave(id, dto.clave);
  }
}
