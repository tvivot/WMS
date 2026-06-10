import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  codigoInterno!: string;

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
