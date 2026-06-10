import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginUsuarioDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  clave!: string;
}

export class LoginClienteDto {
  @IsString()
  @IsNotEmpty()
  nroCliente!: string;

  @IsString()
  @IsNotEmpty()
  clave!: string;
}

export class CambiarClaveDto {
  @IsString()
  @IsNotEmpty()
  claveActual!: string;

  @IsString()
  @MinLength(8, { message: 'La nueva clave debe tener al menos 8 caracteres' })
  claveNueva!: string;
}
