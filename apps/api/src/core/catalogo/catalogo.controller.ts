import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import { CatalogoService } from './catalogo.service';
import { ProductoDto, ProductosBulkDto, ProductosImportarDto } from './dto';

/** Tamaño máximo de la imagen de portada que se acepta subir (8 MB). */
const MAX_IMAGEN_BYTES = 8 * 1024 * 1024;

/** Forma mínima del archivo que inyecta multer (evita depender de tipos ambient). */
interface ArchivoSubido {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

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

  /**
   * Importación masiva desde el sistema externo (integrador).
   * Catálogo simplificado ISBN + Título + Editorial; upsert por ISBN; máx. 1000
   * por request. Ver docs/integraciones/manual-api-catalogo.md
   */
  @RequierePermiso(PERMISOS.CATALOGO_ADMINISTRAR)
  @Post('import')
  importar(@Body() dto: ProductosImportarDto) {
    return this.catalogo.importarProductos(dto.productos);
  }

  /**
   * Sube/reemplaza la portada de un producto (multipart, campo `imagen`).
   * La imagen se valida, se comprime a WebP y se guarda; devuelve el link
   * público autogenerado. Máx. 8 MB.
   */
  @RequierePermiso(PERMISOS.CATALOGO_ADMINISTRAR)
  @Post(':id/imagen')
  @UseInterceptors(FileInterceptor('imagen', { limits: { fileSize: MAX_IMAGEN_BYTES } }))
  subirImagen(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() imagen: ArchivoSubido,
  ) {
    return this.catalogo.setImagen(id, imagen);
  }

  @RequierePermiso(PERMISOS.CATALOGO_ADMINISTRAR)
  @Delete(':id/imagen')
  eliminarImagen(@Param('id', ParseIntPipe) id: number) {
    return this.catalogo.eliminarImagen(id);
  }
}
