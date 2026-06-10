import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import { TransportistasService } from './transportistas.service';
import { CrearTransportistaDto, EditarTransportistaDto } from './dto';

@Controller('transportistas')
export class TransportistasController {
  constructor(private readonly svc: TransportistasService) {}

  /**
   * Listado de transportistas activos para elegir al declarar una devolución.
   * Cualquier actor autenticado (incluye clientes): solo id + nombre.
   */
  @Get()
  listarActivos() {
    return this.svc.listarActivos();
  }

  @RequierePermiso(PERMISOS.TRANSPORTISTA_ADMINISTRAR)
  @Get('admin')
  listar() {
    return this.svc.listar();
  }

  @RequierePermiso(PERMISOS.TRANSPORTISTA_ADMINISTRAR)
  @Post()
  crear(@Body() dto: CrearTransportistaDto) {
    return this.svc.crear(dto);
  }

  @RequierePermiso(PERMISOS.TRANSPORTISTA_ADMINISTRAR)
  @Put(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarTransportistaDto) {
    return this.svc.editar(id, dto);
  }
}
