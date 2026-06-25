import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CrearGrupoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre!: string;

  /** Lista de emails separados por coma, punto y coma o salto de línea. */
  @IsString()
  @MaxLength(5000)
  emails!: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class EditarGrupoDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  emails?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/** Edición de una regla por estado: destinos (grupos/usuarios), flag cliente y plantilla. */
export class EditarReglaDto {
  @IsOptional()
  @IsBoolean()
  incluirCliente?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  asunto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  cuerpo?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  grupoIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  usuarioIds?: number[];
}

export class TestEnvioDto {
  @IsEmail()
  to!: string;
}
