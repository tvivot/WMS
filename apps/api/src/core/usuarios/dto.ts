import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CrearUsuarioDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  rolIds?: number[];

  /** Clave elegida por el administrador; si falta, se genera una aleatoria. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La clave debe tener al menos 8 caracteres' })
  @MaxLength(100)
  clave?: string;
}

/** Reset de clave: con clave elegida o, si falta, generada aleatoria. */
export class ResetClaveDto {
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La clave debe tener al menos 8 caracteres' })
  @MaxLength(100)
  clave?: string;
}

export class EditarUsuarioDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  rolIds?: number[];
}
