import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
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

  /** Motivo de la devolución (obligatorio). Debe existir en core_motivo para el
   *  módulo devoluciones. Si el motivo es de los que exigen observación ("Otro"),
   *  `observaciones` pasa a ser obligatoria (lo valida el servicio). */
  @IsInt()
  motivoId!: number;

  /** Cantidad de unidades (libros) a devolver, declarada al crear. Obligatoria. */
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  cantidadUnidades!: number;

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

/**
 * Carga del cliente. Es un GUARDADO DE BORRADOR: todo es opcional para que el
 * cliente pueda ir guardando mientras carga (líneas sin bultos/peso, o al revés).
 * La validación de "está completo" (líneas + bultos + peso + transportista) vive
 * en `despachar()`, que es el único gate antes de pasar a En tránsito.
 */
export class DeclararDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaDeclaracionDto)
  lineas?: LineaDeclaracionDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  bultosDeclarados?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  pesoTotalDeclarado?: number;

  @IsOptional()
  @IsInt()
  transportistaId?: number;
}

/**
 * Importación de líneas desde un Excel/CSV que el cliente procesó en otro sistema.
 * Acompaña al archivo (multipart): por eso los campos llegan como strings y se
 * convierten con class-transformer. Las columnas son 1-based (Columna 1 = la
 * primera). Si no se envían `isbnCol`/`cantidadCol`, el servicio devuelve solo el
 * listado de columnas (con auto-detección) para que el cliente elija el mapeo.
 */
export class ImportarDeclaracionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  isbnCol?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidadCol?: number;

  /** ¿La primera fila es encabezado? Por defecto sí. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  tieneEncabezado?: boolean;
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

/** Terminar pesaje: En proceso de devolución → Procesando (observación si difiere el peso). */
export class TerminarPesajeDto {
  @IsOptional()
  @IsString()
  observaciones?: string;
}

/**
 * Control de un bulto: se PESA el bulto y se marca controlado. El conteo de
 * libros por ISBN se hace en otro proceso (ya no acá). El peso es obligatorio:
 * controlar un bulto = registrar su peso.
 */
export class ControlarBultoDto {
  @IsNumber()
  @Min(0)
  peso!: number;
}

/** Corrección post-Procesado de un bulto (permiso devolucion.corregir): re-pesa. */
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

/** Ingreso/corrección del nº de lote del ERP (Procesando → Validando, o corregir en Validando). */
export class AsignarLoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  loteCodigo!: string;
}

/** Confirmación de una devolución con diferencias (Con diferencias → Procesado). */
export class ConfirmarDto {
  // Observación obligatoria del responsable sobre las diferencias revisadas.
  @IsString()
  @MinLength(1)
  observaciones!: string;

  // Destinos informativos: opcionales. Si se cargan, el puerto los valida.
  @IsOptional()
  @IsString()
  ubicacionDestinoBueno?: string;

  @IsOptional()
  @IsString()
  ubicacionDestinoMalo?: string;
}
