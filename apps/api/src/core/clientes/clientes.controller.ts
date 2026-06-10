import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import { ClientesService } from './clientes.service';
import { CrearClienteDto, EditarClienteDto } from './dto';

@RequierePermiso(PERMISOS.CLIENTE_ADMINISTRAR)
@Controller('clientes')
export class ClientesController {
  constructor(private readonly svc: ClientesService) {}

  @Get()
  listar(@Query('q') q?: string) {
    return this.svc.listar(q);
  }

  @Post()
  crear(@Body() dto: CrearClienteDto) {
    return this.svc.crear(dto);
  }

  @Put(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarClienteDto) {
    return this.svc.editar(id, dto);
  }

  @Post(':id/reset-clave')
  reset(@Param('id', ParseIntPipe) id: number) {
    return this.svc.resetClave(id);
  }
}
