import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CrearMotivoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre!: string;

  /** Módulo dueño del motivo. Por defecto 'devoluciones' (único consumidor hoy). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  modulo?: string;

  /** Si true, al elegir este motivo se exige cargar una observación (caso "Otro"). */
  @IsOptional()
  @IsBoolean()
  requiereObservacion?: boolean;
}

export class EditarMotivoDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  requiereObservacion?: boolean;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
