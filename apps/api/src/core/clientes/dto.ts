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
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CrearClienteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nroCliente!: string;

  /** Clave elegida por el administrador; si falta, se genera una aleatoria. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La clave debe tener al menos 8 caracteres' })
  @MaxLength(100)
  clave?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccion?: string;

  /** Correo(s) de contacto; admite varios separados por coma (notificaciones). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsInt()
  paisId?: number;

  @IsOptional()
  @IsInt()
  depositoId?: number;
}

export class EditarClienteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccion?: string;

  /** Correo(s) de contacto; admite varios separados por coma (notificaciones). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsInt()
  paisId?: number;

  @IsOptional()
  @IsInt()
  depositoId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/** Línea de importación desde el sistema externo (integrador). */
export class ClienteImportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nroCliente!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccion?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/** Reset de clave: con clave elegida o, si falta, generada aleatoria. */
export class ResetClaveDto {
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La clave debe tener al menos 8 caracteres' })
  @MaxLength(100)
  clave?: string;
}

export class ClientesImportarDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ClienteImportDto)
  clientes!: ClienteImportDto[];
}
