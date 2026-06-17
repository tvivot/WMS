import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CrearAutorizacionDto {
  /** Requerido si el actor es interno (usuario); ignorado si es cliente. */
  @IsOptional()
  @IsInt()
  clienteId?: number;

  @IsOptional()
  @IsInt()
  depositoId?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class LineaDeclaracionDto {
  @IsString()
  isbn!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;
}

export class DeclararDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaDeclaracionDto)
  lineas!: LineaDeclaracionDto[];

  @IsInt()
  @Min(1)
  bultosDeclarados!: number;

  @IsNumber()
  @Min(0)
  pesoTotalDeclarado!: number;

  @IsOptional()
  @IsInt()
  transportistaId?: number;
}

export class RecibirDto {
  // Mínimo 1: recibir 0 bultos dejaría la devolución sin nada que controlar
  // (estado sin salida). Si no llegó nada, queda En tránsito hasta que llegue.
  @IsInt()
  @Min(1)
  bultosRecibidos!: number;

  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class IngresoDto {
  // Informativa: opcional. Si se carga, el puerto la valida.
  @IsOptional()
  @IsString()
  ubicacionEspera?: string;
}

export class LineaControlDto {
  @IsString()
  isbn!: string;

  @IsInt()
  @Min(0)
  cantidad!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  malEstado?: number;
}

export class ControlarBultoDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  peso?: number;

  // Al menos una línea: un bulto vacío se registra con su ISBN y cantidad 0,
  // no con una lista vacía (evita marcar "controlado" sin haber cargado nada).
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaControlDto)
  controles!: LineaControlDto[];
}

/** Corrección post-Procesado de un bulto (permiso devolucion.corregir). */
export class CorregirControlDto extends ControlarBultoDto {
  @IsOptional()
  @IsString()
  observaciones?: string;
}

/** El cliente (o quien arma la devolución) solicita autorizar un ISBN fuera de
 *  su consignación, por una cantidad, en ESA devolución. */
export class SolicitarExcepcionDto {
  @IsString()
  isbn!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}

/** Resolución de una excepción por un usuario con permiso (Gerencia). */
export class ResolverExcepcionDto {
  @IsBoolean()
  aprobar!: boolean;

  /** Cantidad autorizada (la puede ajustar el aprobador). Por defecto, la solicitada. */
  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}

export class CerrarDto {
  // Destinos informativos: opcionales para procesar. Si se cargan, el puerto los valida.
  @IsOptional()
  @IsString()
  ubicacionDestinoBueno?: string;

  @IsOptional()
  @IsString()
  ubicacionDestinoMalo?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;
}
