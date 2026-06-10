import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CrearTransportistaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contacto?: string;
}

export class EditarTransportistaDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contacto?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
