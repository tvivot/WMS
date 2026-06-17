import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Línea de saldo en consignación enviada por el integrador (ERP).
 * Hardening: la entrada del ERP es superficie de ataque (límites de tamaño y
 * tipo antes de procesar). nroCliente + ISBN + cantidad; nada más.
 */
export class ConsignacionItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nroCliente!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  isbn!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  cantidad!: number;
}

/**
 * Snapshot de saldo en consignación. Full-replace por cliente (idempotente).
 * snapshotTs = instante del snapshot del ERP; el ERP pagina si supera 5000,
 * PERO un cliente no debe partirse entre páginas (la página 2 reemplazaría a
 * la 1 para ese cliente). Ver docs/contratos/consignacion-port.md.
 */
export class ConsignacionImportDto {
  @IsISO8601()
  snapshotTs!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ConsignacionItemDto)
  items!: ConsignacionItemDto[];
}
