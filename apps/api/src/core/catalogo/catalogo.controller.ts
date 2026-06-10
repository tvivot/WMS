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
import { CatalogoService } from './catalogo.service';
import { ProductoDto, ProductosBulkDto } from './dto';

@Controller('catalogo/productos')
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  /** Listado con búsqueda por título/código/ISBN. */
  @Get()
  listar(
    @Query('q') q?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.catalogo.listar({
      q,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  /** Resolver ISBN escaneado → producto (usado por el escaneo de devoluciones). */
  @Get('por-isbn/:isbn')
  porIsbn(@Param('isbn') isbn: string) {
    return this.catalogo.resolverPorIsbn(isbn);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.catalogo.obtener(id);
  }

  @RequierePermiso(PERMISOS.CATALOGO_ADMINISTRAR)
  @Post()
  crear(@Body() dto: ProductoDto) {
    return this.catalogo.upsertProducto(dto);
  }

  @RequierePermiso(PERMISOS.CATALOGO_ADMINISTRAR)
  @Put(':id')
  async editar(@Param('id', ParseIntPipe) id: number, @Body() dto: ProductoDto) {
    await this.catalogo.obtener(id); // 404 si no existe
    return this.catalogo.upsertProducto(dto);
  }

  /** Carga masiva por API (alta de catálogo: código interno + ISBN + unidades). */
  @RequierePermiso(PERMISOS.CATALOGO_ADMINISTRAR)
  @Post('bulk')
  bulk(@Body() dto: ProductosBulkDto) {
    return this.catalogo.bulkUpsert(dto.productos);
  }
}
