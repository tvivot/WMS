import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Renglón de un lote de devolución enviado por el integrador (Fierro).
 * Hardening: la entrada del ERP es superficie de ataque (límites de tamaño y
 * tipo antes de procesar).
 */
export class LoteItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  isbn!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  cantidad!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  cantidadCliente?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  cantidadRechazada?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  titulo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  intCode?: string;
}

/** Cabecera + renglones de un lote de devolución del ERP. */
export class LoteDto {
  /** Identidad idempotente (= return_lot.document_id de Fierro). */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  codigo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  numero?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fecha?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nroCliente!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clienteNombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  deposito?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  estado?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  remitoCliente?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fechaRemitoCliente?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  totalItems?: number;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => LoteItemDto)
  items!: LoteItemDto[];
}

export class LotesImportarDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => LoteDto)
  lotes!: LoteDto[];
}
