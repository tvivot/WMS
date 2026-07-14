import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ProductoDto {
  /**
   * Identificador maestro del producto. Opcional: si no se envía, el catálogo
   * lo deriva del primer ISBN válido (el ISBN actúa como código interno).
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  codigoInterno?: string;

  /** Código interno del producto en el ERP (Fierro). Opcional y único. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  codigoFierro?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  titulo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  editorial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  autor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unidadBase?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  equivCaja?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  equivPallet?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  isbns?: string[];

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class ProductosBulkDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ProductoDto)
  productos!: ProductoDto[];
}

/**
 * Línea de importación masiva desde el sistema externo (integrador).
 * Catálogo simplificado: ISBN + Título + Editorial. El ISBN es la clave de
 * identidad (actúa como código interno). Ver docs/integraciones/manual-api-catalogo.md.
 */
export class ProductoImportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  isbn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  titulo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  editorial?: string;

  /**
   * Código interno del producto en el ERP (Fierro). Opcional. Único en el WMS:
   * si el mismo código llega asignado a otro ISBN se informa en `errores` y no
   * aborta el lote (ver catalogo.service.importarProductos).
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  codigoFierro?: string;
}

export class ProductosImportarDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ProductoImportDto)
  productos!: ProductoImportDto[];
}
