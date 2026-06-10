import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CrearClienteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nroCliente!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nombre!: string;

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
  @IsInt()
  paisId?: number;

  @IsOptional()
  @IsInt()
  depositoId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
