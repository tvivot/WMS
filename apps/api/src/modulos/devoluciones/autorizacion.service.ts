import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DevEstado, DevEstadoControl, DevExcepcionEstado, Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaService } from '../../core/auditoria/auditoria.service';
import {
  CatalogoService,
  normalizarCodigoFierro,
} from '../../core/catalogo/catalogo.service';
import { normalizarIsbn } from '../../core/catalogo/isbn.util';
import type { JwtPayload } from '../../core/auth/jwt-payload';
import {
  AsignarLoteDto,
  ConfirmarDto,
  ControlarBultoDto,
  CorregirControlDto,
  CrearAutorizacionDto,
  DeclararDto,
  RecibirDto,
  ResolverExcepcionDto,
  SolicitarExcepcionDto,
  TerminarPesajeDto,
} from './dto';
import {
  DEVOLUCION_ESTADO_CAMBIADO,
  DEVOLUCION_LOTE_EVALUADO,
  DEVOLUCION_PROCESADA,
  type DevolucionEstadoCambiadoEvent,
  type DevolucionLoteEvaluadoEvent,
  type DevolucionProcesadaEvent,
  type ReconciliacionLinea,
} from './eventos/eventos';
import {
  UBICACION_RESOLVER,
  type TipoUbicacion,
  type UbicacionResolverPort,
} from './puertos/ubicacion-resolver.port';
import {
  CONSIGNACION_PORT,
  type ConsignacionPort,
} from './puertos/consignacion.port';

const PESO_TOLERANCIA = 0.001;

/** Tope de filas de datos que se procesan en una importación (anti-DoS). */
const IMPORT_MAX_FILAS = 5000;

/** Archivo que inyecta multer (forma mínima, sin depender de tipos ambient). */
export interface ArchivoImportado {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

/** Una columna detectada en el archivo (índice 1-based + encabezado + ejemplo). */
export interface ColumnaArchivo {
  indice: number;
  encabezado: string;
  ejemplo: string | null;
}

export interface LineaImportada {
  isbn: string;
  cantidad: number;
  productoId: number | null;
  titulo: string | null;
  editorial: string | null;
  imagenUrl: string | null;
  // Cómo se identificó el producto en el archivo: por ISBN (principal) o por el
  // código interno de Fierro (alternativa). Informativo para el cliente.
  via: 'isbn' | 'fierro';
}

export interface ErrorImportacion {
  fila: number;
  isbn: string | null;
  cantidad: string | null;
  motivo: string;
}

export interface PreviewImportacion {
  columnas: ColumnaArchivo[];
  mapeo: { isbnCol: number | null; cantidadCol: number | null; tieneEncabezado: boolean };
  // null mientras no haya un mapeo resuelto (el cliente todavía debe elegir columnas).
  resultado: {
    lineas: LineaImportada[];
    errores: ErrorImportacion[];
    filasLeidas: number;
    totalUnidades: number;
    truncado: boolean;
  } | null;
}

/**
 * Extrae el texto de una celda de exceljs cubriendo los tipos que trae
 * (string, número, fecha, fórmula, hyperlink, rich text). Los números se pasan
 * por `String` para NO perder dígitos del EAN-13 (un ISBN cargado como número).
 */
/**
 * Neutraliza inyección de fórmulas en Excel/CSV: una celda de texto que empieza
 * con = + - @ (o tab/CR) se evalúa como fórmula al abrir el archivo. Se le
 * antepone un apóstrofo para forzar que Excel la trate como texto literal.
 * Aplica a TODO dato de texto de origen externo (cliente, ERP, catálogo).
 */
function celdaSegura<T>(value: T): T | string {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function celdaTexto(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text.trim(); // hyperlink {text,hyperlink}
    if (Array.isArray(o.richText)) {
      return o.richText.map((r) => (r as { text?: string }).text ?? '').join('').trim();
    }
    if ('result' in o) return celdaTexto(o.result); // fórmula → su resultado
    return '';
  }
  return String(value).trim();
}

/** Etiquetas legibles de estado para el export (el front usa su propio mapa). */
const ESTADO_LABEL_EXPORT: Record<DevEstado, string> = {
  A_APROBAR: 'A aprobar',
  APROBADO: 'Aprobado',
  EN_TRANSITO: 'En tránsito',
  ENTREGADO: 'Entregado',
  EN_PROCESO_DEVOLUCION: 'En proceso de devolución',
  PROCESANDO: 'Procesando',
  VALIDANDO: 'Validando',
  CON_DIFERENCIAS: 'Con diferencias',
  PROCESADO: 'Procesado',
};

/** Actor para las transiciones que dispara el sistema (cron de validación). */
type ActorTransicion = { sub: number; tipo: 'usuario' | 'cliente' | 'sistema' };
const SISTEMA: ActorTransicion = { sub: 0, tipo: 'sistema' };

@Injectable()
export class AutorizacionService {
  private readonly logger = new Logger(AutorizacionService.name);
  /** Anti-solape del chequeo periódico de lotes (evita re-emitir/duplicar mails). */
  private evaluandoLotes = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
    private readonly auditoria: AuditoriaService,
    private readonly eventos: EventEmitter2,
    @Inject(UBICACION_RESOLVER)
    private readonly ubicaciones: UbicacionResolverPort,
    @Inject(CONSIGNACION_PORT)
    private readonly consignacion: ConsignacionPort,
  ) {}

  // ---- helpers ----

  private async obtenerOr404(id: number) {
    const a = await this.prisma.devAutorizacion.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Autorización no encontrada');
    return a;
  }

  private verificarPropiedad(actor: JwtPayload, clienteId: number): void {
    if (actor.tipo === 'cliente' && actor.sub !== clienteId) {
      throw new ForbiddenException('No es tu autorización');
    }
  }

  /** Acumula observaciones de cada etapa sin pisar las anteriores. */
  private acumularObservacion(
    previa: string | null,
    etapa: string,
    nueva?: string,
  ): string | null {
    if (!nueva) return previa;
    const etiquetada = `${etapa}: ${nueva}`;
    return previa ? `${previa} | ${etiquetada}` : etiquetada;
  }

  private exigirEstado(actual: DevEstado, esperado: DevEstado): void {
    if (actual !== esperado) {
      throw new BadRequestException(
        `Transición inválida: estado actual ${actual}, se esperaba ${esperado}`,
      );
    }
  }

  private async transicionar(
    id: number,
    actor: ActorTransicion,
    estadoAnterior: DevEstado,
    estadoNuevo: DevEstado,
    extra: Record<string, unknown> = {},
  ) {
    // Update CONDICIONADO por el estado actual (concurrencia optimista): si otra
    // operación (doble click, otro worker, el cron) ya transicionó, count=0 y se
    // aborta — evita la doble transición y la doble emisión de eventos.
    const { count } = await this.prisma.devAutorizacion.updateMany({
      where: { id, estado: estadoAnterior },
      data: { estado: estadoNuevo, ...extra },
    });
    if (count === 0) {
      throw new BadRequestException(
        'La devolución ya cambió de estado; recargá y reintentá',
      );
    }
    const actualizada = await this.prisma.devAutorizacion.findUniqueOrThrow({
      where: { id },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'cambio_estado',
      entidad: 'dev_autorizacion',
      entidadId: String(id),
      estadoAnterior,
      estadoNuevo,
    });
    const ev: DevolucionEstadoCambiadoEvent = {
      autorizacionId: id,
      clienteId: actualizada.clienteId,
      estadoAnterior,
      estadoNuevo,
      actorId: actor.sub,
      actorTipo: actor.tipo,
      ts: new Date().toISOString(),
    };
    this.eventos.emit(DEVOLUCION_ESTADO_CAMBIADO, ev);
    return actualizada;
  }

  // ---- transiciones ----

  /** A Aprobar: la crea Cliente / Vendedor / Gerencial (permiso solicitud.crear). */
  async crear(actor: JwtPayload, dto: CrearAutorizacionDto) {
    let clienteId: number;
    let depositoId: number;

    if (actor.tipo === 'cliente') {
      clienteId = actor.sub;
      const cli = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cli || !cli.activo) {
        throw new BadRequestException('Cliente inactivo: no puede operar en el WMS');
      }
      depositoId = dto.depositoId ?? cli.depositoId ?? (await this.depositoPorDefecto());
    } else {
      if (!dto.clienteId) {
        throw new BadRequestException('clienteId es requerido para usuarios internos');
      }
      clienteId = dto.clienteId;
      const cli = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cli) throw new BadRequestException('Cliente inexistente');
      if (!cli.activo) {
        throw new BadRequestException('Cliente inactivo: no se pueden crear devoluciones');
      }
      depositoId = dto.depositoId ?? cli.depositoId ?? (await this.depositoPorDefecto());
    }

    // Motivo obligatorio: debe existir y estar activo para el módulo devoluciones.
    const motivo = await this.prisma.motivo.findFirst({
      where: { id: dto.motivoId, modulo: 'devoluciones', activo: true },
    });
    if (!motivo) throw new BadRequestException('Motivo inexistente o inactivo');
    // "Otro" (requiereObservacion) exige una observación cargada.
    const observaciones = dto.observaciones?.trim() || null;
    if (motivo.requiereObservacion && !observaciones) {
      throw new BadRequestException(
        `El motivo "${motivo.nombre}" exige cargar una observación`,
      );
    }

    const creada = await this.prisma.devAutorizacion.create({
      data: {
        estado: DevEstado.A_APROBAR,
        clienteId,
        depositoId,
        creadoPorId: actor.sub,
        creadoPorTipo: actor.tipo,
        motivoId: motivo.id,
        cantidadUnidades: dto.cantidadUnidades,
        observaciones,
      },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'crear',
      entidad: 'dev_autorizacion',
      entidadId: String(creada.id),
      estadoNuevo: DevEstado.A_APROBAR,
    });
    return creada;
  }

  private async depositoPorDefecto(): Promise<number> {
    const d = await this.prisma.deposito.findFirst({ orderBy: { id: 'asc' } });
    if (!d) throw new BadRequestException('No hay depósitos configurados');
    return d.id;
  }

  /** Aprobado: permiso solicitud.aprobar. */
  async aprobar(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.A_APROBAR);
    return this.transicionar(id, actor, a.estado, DevEstado.APROBADO);
  }

  /**
   * Guardado de la carga del cliente (estado APROBADO). Es un BORRADOR con
   * semántica de MERGE: solo toca lo que el caller envía. Omitir un campo lo deja
   * como estaba (no lo borra) → guardar parcial sin perder lo ya cargado. Para
   * borrar líneas se manda `lineas: []` explícito. El gate de "completo" (líneas +
   * bultos + peso + transportista) vive en despachar().
   */
  async declarar(actor: JwtPayload, id: number, dto: DeclararDto) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);

    // Las líneas se tocan SOLO si el caller las envió (undefined = no cambiar).
    const tocaLineas = dto.lineas !== undefined;
    const resueltas: { isbn: string; productoId: number | null; cantidad: number }[] = [];
    if (tocaLineas) {
      // Resolver ISBN→producto; rechazar no catalogados (no líneas fantasma).
      const noCatalogados: string[] = [];
      // Resolución en bloque (1 query) en vez de un findUnique por línea (N+1).
      const productos = await this.catalogo.resolverPorIsbnBatch(
        dto.lineas!.map((l) => l.isbn),
      );
      for (const linea of dto.lineas!) {
        const norm = normalizarIsbn(linea.isbn);
        if (!norm) {
          noCatalogados.push(linea.isbn);
          continue;
        }
        const prod = productos.get(norm);
        if (!prod) {
          noCatalogados.push(linea.isbn);
          continue;
        }
        // Mismo ISBN repetido en el payload (p.ej. ISBN-10 y 13 del mismo título): sumar.
        const ya = resueltas.find((r) => r.isbn === norm);
        if (ya) ya.cantidad += linea.cantidad;
        else resueltas.push({ isbn: norm, productoId: prod.id, cantidad: linea.cantidad });
      }
      if (noCatalogados.length > 0) {
        throw new BadRequestException(
          `ISBN no catalogados (se avisó, no se cargan): ${noCatalogados.join(', ')}`,
        );
      }

      // Regla de consignación: el cliente solo puede declarar lo que tiene en
      // consignación. Un título fuera de la lista, o por encima del saldo, exige
      // una excepción APROBADA (permiso devolucion.autorizar_excepcion).
      // Permitido por ISBN = saldo consignación + Σ excepciones aprobadas.
      const permitido = await this.permitidoPorIsbn(
        id,
        a.clienteId,
        resueltas.map((r) => r.isbn),
      );
      const excedidos = resueltas.filter((r) => r.cantidad > (permitido.get(r.isbn) ?? 0));
      if (excedidos.length > 0) {
        const detalle = excedidos
          .map((r) => {
            const ok = permitido.get(r.isbn) ?? 0;
            return `${r.isbn} (declarás ${r.cantidad}, en consignación ${ok}, falta autorizar ${r.cantidad - ok})`;
          })
          .join('; ');
        throw new BadRequestException(
          `Estos libros están fuera de la consignación del cliente o la superan; ` +
            `requieren autorización de Gerencia: ${detalle}`,
        );
      }
    }

    // El transportista declarado debe existir y estar activo.
    if (dto.transportistaId !== undefined && dto.transportistaId !== null) {
      const t = await this.prisma.transportista.findUnique({
        where: { id: dto.transportistaId },
      });
      if (!t || !t.activo) {
        throw new BadRequestException('Transportista inexistente o inactivo');
      }
    }

    // Merge: solo los campos presentes en el DTO. Lo omitido se preserva.
    const datos: {
      bultosDeclarados?: number;
      pesoTotalDeclarado?: number;
      transportistaId?: number;
    } = {};
    if (dto.bultosDeclarados !== undefined) datos.bultosDeclarados = dto.bultosDeclarados;
    if (dto.pesoTotalDeclarado !== undefined) datos.pesoTotalDeclarado = dto.pesoTotalDeclarado;
    if (dto.transportistaId !== undefined) datos.transportistaId = dto.transportistaId;

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (tocaLineas) {
      ops.push(
        this.prisma.devDeclaracion.deleteMany({ where: { autorizacionId: id } }),
        this.prisma.devDeclaracion.createMany({
          data: resueltas.map((r) => ({
            autorizacionId: id,
            isbn: r.isbn,
            productoId: r.productoId,
            cantidad: r.cantidad,
          })),
        }),
      );
    }
    if (Object.keys(datos).length > 0) {
      ops.push(this.prisma.devAutorizacion.update({ where: { id }, data: datos }));
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
    return this.detalle(id);
  }

  /**
   * Previsualiza una importación de líneas desde un Excel/CSV (cliente que procesó
   * la devolución en otro sistema). NO PERSISTE NADA: parsea el archivo, resuelve
   * cada artículo a producto —por **ISBN** (identidad principal) o, si no matchea,
   * por su **código interno de Fierro** (ERP)— y devuelve qué libros/cantidades se
   * importarían y qué filas fallaron, para que el cliente lo revise y lo acepte
   * antes de cargarlo en la declaración (la persistencia sigue pasando por
   * declarar() → mismo gate y misma validación de consignación; las líneas viajan
   * por el ISBN canónico del producto). Solo en estado APROBADO y sobre la propia
   * devolución (un cliente no importa en la de otro).
   *
   * Si no se indica el mapeo de columnas, devuelve solo el listado de columnas
   * (con auto-detección por encabezado) para que el cliente elija la columna del
   * identificador (ISBN o Cód. Fierro) y la de cantidad.
   */
  async previsualizarImportacion(
    actor: JwtPayload,
    id: number,
    archivo: ArchivoImportado,
    opts: { isbnCol?: number; cantidadCol?: number; tieneEncabezado?: boolean },
  ): Promise<PreviewImportacion> {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);

    const ws = await this.leerHoja(archivo);
    const tieneEncabezado = opts.tieneEncabezado ?? true;

    // Columnas: encabezado (si lo hay) + un valor de ejemplo de la primera fila de datos.
    const totalCols = Math.max(ws.columnCount, ws.getRow(1).cellCount);
    const filaDatos = tieneEncabezado ? 2 : 1;
    const columnas: ColumnaArchivo[] = [];
    for (let c = 1; c <= totalCols; c++) {
      const encabezado = tieneEncabezado
        ? celdaTexto(ws.getRow(1).getCell(c).value) || `Columna ${c}`
        : `Columna ${c}`;
      const ejemplo = celdaTexto(ws.getRow(filaDatos).getCell(c).value) || null;
      columnas.push({ indice: c, encabezado, ejemplo });
    }

    // Mapeo: lo pedido por el cliente o, si falta, auto-detección por encabezado.
    let isbnCol = opts.isbnCol ?? null;
    let cantidadCol = opts.cantidadCol ?? null;
    if (tieneEncabezado) {
      if (isbnCol === null) {
        // La columna identificadora acepta ISBN (principal) o código de Fierro:
        // se autodetecta por encabezados de cualquiera de los dos.
        isbnCol =
          columnas.find((col) =>
            /isbn|ean|c[oó]digo|fierro|art[ií]culo|sku/i.test(col.encabezado),
          )?.indice ?? null;
      }
      if (cantidadCol === null) {
        // La cantidad nunca puede caer en la misma columna que el ISBN.
        cantidadCol =
          columnas.find(
            (col) => /cant|unidad|qty|stock/i.test(col.encabezado) && col.indice !== isbnCol,
          )?.indice ?? null;
      }
    }

    const mapeo = { isbnCol, cantidadCol, tieneEncabezado };
    // Sin mapeo resoluble: que el cliente elija las columnas en el front.
    if (isbnCol === null || cantidadCol === null) {
      return { columnas, mapeo, resultado: null };
    }
    // La misma columna para el identificador y la cantidad daría líneas con el
    // código como cantidad.
    if (isbnCol === cantidadCol) {
      throw new BadRequestException(
        'La columna del identificador (ISBN o Cód. Fierro) y la de cantidad no pueden ser la misma',
      );
    }

    // Recorrido de filas de datos: junta candidatos y filas con error. El
    // identificador se guarda CRUDO: puede ser un ISBN o un código de Fierro; la
    // resolución (ISBN primero, Fierro como alternativa) se hace después en bloque.
    const ultimaFila = ws.rowCount;
    const topeFila = Math.min(ultimaFila, filaDatos + IMPORT_MAX_FILAS - 1);
    const truncado = ultimaFila > topeFila;
    const candidatos: { fila: number; ident: string; cantidad: number }[] = [];
    const errores: ErrorImportacion[] = [];
    let filasLeidas = 0;

    for (let r = filaDatos; r <= topeFila; r++) {
      const fila = ws.getRow(r);
      const identRaw = celdaTexto(fila.getCell(isbnCol).value);
      const cantRaw = celdaTexto(fila.getCell(cantidadCol).value);
      if (!identRaw && !cantRaw) continue; // fila vacía: se ignora
      filasLeidas++;

      if (!identRaw) {
        errores.push({ fila: r, isbn: null, cantidad: cantRaw || null, motivo: 'Falta el ISBN o código de Fierro' });
        continue;
      }
      // Estricto: solo dígitos. Evita que separadores de miles/decimales se
      // malinterpreten en silencio (p.ej. "1.000" → 1 con Number()).
      if (!/^\d+$/.test(cantRaw)) {
        errores.push({ fila: r, isbn: identRaw, cantidad: cantRaw || null, motivo: 'Cantidad inválida (debe ser un entero ≥ 1, sin separadores)' });
        continue;
      }
      const cantidad = Number(cantRaw);
      if (cantidad < 1) {
        errores.push({ fila: r, isbn: identRaw, cantidad: cantRaw || null, motivo: 'Cantidad inválida (debe ser ≥ 1)' });
        continue;
      }
      candidatos.push({ fila: r, ident: identRaw, cantidad });
    }

    // Resolución en bloque (sin N+1), con el ISBN como identidad PRINCIPAL:
    //  1) los identificadores que son ISBN válido y catalogado resuelven por ISBN;
    //  2) el resto se intenta por código de Fierro (ERP).
    // Las líneas viajan por el ISBN canónico del producto → declarar()/consignación
    // no cambian.
    const porIsbn = await this.catalogo.resolverPorIsbnBatch(
      candidatos.map((c) => c.ident),
    );
    const restoParaFierro = candidatos.filter((c) => {
      const norm = normalizarIsbn(c.ident);
      return !norm || !porIsbn.has(norm);
    });
    const porFierro = await this.catalogo.resolverPorCodigoFierroBatch(
      restoParaFierro.map((c) => c.ident),
    );

    const lineas = new Map<string, LineaImportada>();
    const acumular = (
      isbn: string,
      cantidad: number,
      prod: { id: number; titulo: string; editorial: string | null; imagenUrl: string | null },
      via: 'isbn' | 'fierro',
    ) => {
      const ya = lineas.get(isbn);
      if (ya) {
        ya.cantidad += cantidad;
        // El ISBN es la vía principal: si alguna fila matcheó por ISBN, se muestra así.
        if (via === 'isbn') ya.via = 'isbn';
      } else {
        lineas.set(isbn, {
          isbn,
          cantidad,
          productoId: prod.id,
          titulo: prod.titulo,
          editorial: prod.editorial,
          imagenUrl: prod.imagenUrl,
          via,
        });
      }
    };

    for (const cand of candidatos) {
      const norm = normalizarIsbn(cand.ident);
      const prod = norm ? porIsbn.get(norm) : undefined;
      if (prod) {
        acumular(norm!, cand.cantidad, prod, 'isbn');
        continue;
      }
      // Match case-insensitive: el Map viene indexado en mayúsculas (el índice
      // único de Fierro es case-insensitive en MySQL).
      const claveFierro = normalizarCodigoFierro(cand.ident);
      const pf = claveFierro ? porFierro.get(claveFierro.toUpperCase()) : undefined;
      if (pf) {
        if (!pf.isbnCanonico) {
          errores.push({ fila: cand.fila, isbn: cand.ident, cantidad: String(cand.cantidad), motivo: `Código de Fierro ${cand.ident}: el producto no tiene ISBN asociado` });
          continue;
        }
        acumular(pf.isbnCanonico, cand.cantidad, pf, 'fierro');
        continue;
      }
      errores.push({ fila: cand.fila, isbn: cand.ident, cantidad: String(cand.cantidad), motivo: 'No catalogado (ni por ISBN ni por código de Fierro)' });
    }

    const lineasArr = [...lineas.values()];
    const totalUnidades = lineasArr.reduce((acc, l) => acc + l.cantidad, 0);
    // Errores ordenados por fila para que el cliente los ubique en su archivo.
    errores.sort((x, y) => x.fila - y.fila);

    return {
      columnas,
      mapeo,
      resultado: { lineas: lineasArr, errores, filasLeidas, totalUnidades, truncado },
    };
  }

  /** Carga la primera hoja del archivo (xlsx o csv). Valida que sea legible. */
  private async leerHoja(archivo: ArchivoImportado) {
    const esCsv =
      /\.csv$/i.test(archivo.originalname) ||
      archivo.mimetype === 'text/csv' ||
      archivo.mimetype === 'application/csv';
    const wb = new Workbook();
    try {
      if (esCsv) {
        return await wb.csv.read(Readable.from(archivo.buffer));
      }
      // exceljs tipa el parámetro como `Buffer extends ArrayBuffer`: pasamos el
      // ArrayBuffer subyacente (lo acepta en runtime) y evitamos la fricción de
      // tipos con el Buffer de Node.
      const ab = archivo.buffer.buffer.slice(
        archivo.buffer.byteOffset,
        archivo.buffer.byteOffset + archivo.buffer.byteLength,
      ) as ArrayBuffer;
      await wb.xlsx.load(ab);
    } catch {
      throw new BadRequestException('No se pudo leer el archivo: ¿es un Excel (.xlsx) o CSV válido?');
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount === 0) {
      throw new BadRequestException('El archivo no tiene datos');
    }
    return ws;
  }

  /**
   * Lo permitido a declarar por ISBN = saldo en consignación del cliente +
   * Σ excepciones APROBADAS de esa devolución. Ausencia de saldo = 0.
   */
  private async permitidoPorIsbn(
    autorizacionId: number,
    clienteId: number,
    isbns: string[],
  ): Promise<Map<string, number>> {
    const [saldos, aprobadas] = await Promise.all([
      this.consignacion.saldosDe(clienteId, isbns),
      this.prisma.devExcepcionConsignacion.findMany({
        where: {
          autorizacionId,
          estado: DevExcepcionEstado.APROBADA,
          isbn: { in: isbns },
        },
        select: { isbn: true, cantidad: true },
      }),
    ]);
    const mapa = new Map<string, number>();
    for (const isbn of isbns) mapa.set(isbn, saldos.get(isbn) ?? 0);
    for (const e of aprobadas) mapa.set(e.isbn, (mapa.get(e.isbn) ?? 0) + e.cantidad);
    return mapa;
  }

  /**
   * Solicitar autorización para declarar un ISBN fuera de la consignación (o por
   * encima del saldo) en esta devolución. La crea el cliente dueño o quien arma
   * la devolución; queda PENDIENTE hasta que la resuelva alguien con permiso.
   */
  async solicitarExcepcion(actor: JwtPayload, id: number, dto: SolicitarExcepcionDto) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);

    const norm = normalizarIsbn(dto.isbn);
    if (!norm) throw new BadRequestException(`ISBN inválido: ${dto.isbn}`);
    const productos = await this.catalogo.resolverPorIsbnBatch([norm]);
    const prod = productos.get(norm);
    if (!prod) {
      throw new BadRequestException(`ISBN no catalogado: ${dto.isbn}`);
    }

    // Evita apilar autorizaciones del mismo ISBN: si ya hay una PENDIENTE o
    // APROBADA, no se crea otra (el aprobador ajusta la cantidad de la existente).
    const yaExiste = await this.prisma.devExcepcionConsignacion.findFirst({
      where: {
        autorizacionId: id,
        isbn: norm,
        estado: { in: [DevExcepcionEstado.PENDIENTE, DevExcepcionEstado.APROBADA] },
      },
    });
    if (yaExiste) {
      throw new BadRequestException(
        yaExiste.estado === DevExcepcionEstado.APROBADA
          ? 'Ese ISBN ya tiene una autorización aprobada en esta devolución'
          : 'Ya hay una solicitud pendiente para ese ISBN',
      );
    }

    const creada = await this.prisma.devExcepcionConsignacion.create({
      data: {
        autorizacionId: id,
        isbn: norm,
        productoId: prod.id,
        cantidad: dto.cantidad,
        estado: DevExcepcionEstado.PENDIENTE,
        solicitadoPorId: actor.sub,
        solicitadoPorTipo: actor.tipo,
        motivoSolicitud: dto.motivo ?? null,
      },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'solicitar_excepcion',
      entidad: 'dev_excepcion_consignacion',
      entidadId: String(creada.id),
      detalle: { autorizacionId: id, isbn: norm, cantidad: dto.cantidad },
    });
    return this.detalle(id);
  }

  /**
   * Resolver (aprobar/rechazar) una excepción. El endpoint exige el permiso
   * devolucion.autorizar_excepcion (Gerencia). El aprobador puede ajustar la
   * cantidad autorizada. Solo opera sobre excepciones PENDIENTES.
   */
  async resolverExcepcion(
    actor: JwtPayload,
    id: number,
    excepcionId: number,
    dto: ResolverExcepcionDto,
  ) {
    const exc = await this.prisma.devExcepcionConsignacion.findUnique({
      where: { id: excepcionId },
    });
    if (!exc || exc.autorizacionId !== id) {
      throw new NotFoundException('Excepción inexistente');
    }
    if (exc.estado !== DevExcepcionEstado.PENDIENTE) {
      throw new BadRequestException('La excepción ya fue resuelta');
    }

    await this.prisma.devExcepcionConsignacion.update({
      where: { id: excepcionId },
      data: {
        estado: dto.aprobar ? DevExcepcionEstado.APROBADA : DevExcepcionEstado.RECHAZADA,
        cantidad: dto.aprobar && dto.cantidad ? dto.cantidad : exc.cantidad,
        resueltoPorId: actor.sub,
        resueltoEn: new Date(),
        motivoResolucion: dto.motivo ?? null,
      },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: dto.aprobar ? 'aprobar_excepcion' : 'rechazar_excepcion',
      entidad: 'dev_excepcion_consignacion',
      entidadId: String(excepcionId),
      detalle: { autorizacionId: id, isbn: exc.isbn },
    });
    return this.detalle(id);
  }

  /** Cola de excepciones PENDIENTES para los aprobadores (permiso). */
  async excepcionesPendientes() {
    const pendientes = await this.prisma.devExcepcionConsignacion.findMany({
      where: { estado: DevExcepcionEstado.PENDIENTE },
      orderBy: { createdAt: 'asc' },
    });
    if (pendientes.length === 0) return [];

    const info = await this.infoPorProducto(
      pendientes.map((e) => e.productoId).filter((x): x is number => x !== null),
    );
    const autIds = [...new Set(pendientes.map((e) => e.autorizacionId))];
    const auts = await this.prisma.devAutorizacion.findMany({
      where: { id: { in: autIds } },
      select: { id: true, clienteId: true },
    });
    const clienteIds = [...new Set(auts.map((x) => x.clienteId))];
    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: clienteIds } },
      select: { id: true, nroCliente: true, nombre: true },
    });
    const autMapa = new Map(auts.map((x) => [x.id, x]));
    const cliMapa = new Map(clientes.map((c) => [c.id, c]));

    return pendientes.map((e) => {
      const p = e.productoId !== null ? info.get(e.productoId) : undefined;
      const aut = autMapa.get(e.autorizacionId);
      return {
        id: e.id,
        autorizacionId: e.autorizacionId,
        isbn: e.isbn,
        cantidad: e.cantidad,
        titulo: p?.titulo ?? null,
        editorial: p?.editorial ?? null,
        imagenUrl: p?.imagenUrl ?? null,
        motivoSolicitud: e.motivoSolicitud,
        createdAt: e.createdAt,
        cliente: aut ? (cliMapa.get(aut.clienteId) ?? null) : null,
      };
    });
  }

  /** Despacho: APROBADO → En tránsito. */
  async despachar(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);
    const lineas = await this.prisma.devDeclaracion.count({ where: { autorizacionId: id } });
    if (lineas === 0 || !a.bultosDeclarados || a.transportistaId === null) {
      throw new BadRequestException(
        'Faltan datos para despachar: líneas, bultos y transportista',
      );
    }
    return this.transicionar(id, actor, a.estado, DevEstado.EN_TRANSITO);
  }

  /** Recepción: En tránsito → Entregado (permiso deposito.recibir). */
  async recibir(actor: JwtPayload, id: number, dto: RecibirDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.EN_TRANSITO);
    if (
      a.bultosDeclarados !== null &&
      dto.bultosRecibidos !== a.bultosDeclarados &&
      !dto.observaciones
    ) {
      throw new BadRequestException(
        'Los bultos recibidos difieren de los declarados: observación obligatoria',
      );
    }
    // Crear los bultos a controlar (1..bultosRecibidos).
    await this.prisma.$transaction([
      this.prisma.devBulto.deleteMany({ where: { autorizacionId: id } }),
      this.prisma.devBulto.createMany({
        data: Array.from({ length: dto.bultosRecibidos }, (_, i) => ({
          autorizacionId: id,
          numero: i + 1,
          estadoControl: DevEstadoControl.NO_CONTROLADO,
        })),
      }),
    ]);
    return this.transicionar(id, actor, a.estado, DevEstado.ENTREGADO, {
      bultosRecibidos: dto.bultosRecibidos,
      observaciones: this.acumularObservacion(a.observaciones, 'Recepción', dto.observaciones),
    });
  }

  /**
   * Las ubicaciones son INFORMATIVAS: opcionales al ingresar/cerrar, no bloquean.
   * Si se carga una, se valida por el puerto (así el futuro módulo Ubicaciones
   * sigue mandando y el seam no se rompe); si viene vacía, se guarda null.
   */
  private async ubicacionOpcional(
    codigo: string | undefined,
    tipo: TipoUbicacion,
    etiqueta: string,
  ): Promise<string | null> {
    const limpio = codigo?.trim();
    if (!limpio) return null;
    if (!(await this.ubicaciones.esValidaPara(limpio, tipo))) {
      throw new BadRequestException(`${etiqueta} inválida`);
    }
    return limpio;
  }

  /** Entregado → En proceso de devolución: arranca el proceso (solo se pesará). */
  async iniciarProceso(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.ENTREGADO);
    await this.transicionar(id, actor, a.estado, DevEstado.EN_PROCESO_DEVOLUCION);
    return this.detalle(id);
  }

  /**
   * Control de un bulto: se PESA y se marca controlado (estado En proceso de
   * devolución). El conteo de libros por ISBN se hace en OTRO proceso; la
   * reconciliación compara lo declarado por el cliente contra el lote del ERP.
   */
  async controlarBulto(
    actor: JwtPayload,
    id: number,
    numero: number,
    dto: ControlarBultoDto,
  ) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.EN_PROCESO_DEVOLUCION);
    const bulto = await this.prisma.devBulto.findUnique({
      where: { autorizacionId_numero: { autorizacionId: id, numero } },
    });
    if (!bulto) throw new NotFoundException('Bulto inexistente');

    await this.prisma.devBulto.update({
      where: { id: bulto.id },
      data: { peso: dto.peso, estadoControl: DevEstadoControl.CONTROLADO },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'controlar_bulto',
      entidad: 'dev_bulto',
      entidadId: `${id}/${numero}`,
      detalle: { peso: dto.peso },
    });
    return this.detalle(id);
  }

  /**
   * En proceso de devolución → Procesando: termina el pesaje. Exige todos los
   * bultos pesados; chequea suma de pesos vs peso total declarado (no bloquea,
   * exige observación si difiere).
   */
  async terminarPesaje(actor: JwtPayload, id: number, dto: TerminarPesajeDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.EN_PROCESO_DEVOLUCION);
    const bultos = await this.prisma.devBulto.findMany({ where: { autorizacionId: id } });
    if (bultos.length === 0) {
      throw new BadRequestException('No hay bultos para procesar');
    }
    const sinPesar = bultos.filter((b) => b.estadoControl !== DevEstadoControl.CONTROLADO);
    if (sinPesar.length > 0) {
      throw new BadRequestException(`Hay ${sinPesar.length} bulto(s) sin pesar`);
    }
    const sumaPesos = bultos.reduce((acc, b) => acc + (b.peso ? Number(b.peso) : 0), 0);
    const declarado = a.pesoTotalDeclarado ? Number(a.pesoTotalDeclarado) : null;
    if (
      declarado !== null &&
      Math.abs(sumaPesos - declarado) > PESO_TOLERANCIA &&
      !dto.observaciones
    ) {
      throw new BadRequestException(
        `Suma de pesos (${sumaPesos}) ≠ peso declarado (${declarado}): observación obligatoria`,
      );
    }
    await this.transicionar(id, actor, a.estado, DevEstado.PROCESANDO, {
      observaciones: this.acumularObservacion(a.observaciones, 'Pesaje', dto.observaciones),
    });
    return this.detalle(id);
  }

  /**
   * Procesando → Validando: se ingresa el nº de lote del ERP (Fierro). NO exige
   * que el lote ya exista (puede no haber llegado por la API): la validación la
   * hace el cron en Validando. En Validando se puede CORREGIR el lote sin cambiar
   * de estado (sigue validando con el nuevo código).
   */
  async ingresarLote(actor: JwtPayload, id: number, dto: AsignarLoteDto) {
    const a = await this.obtenerOr404(id);
    const codigo = dto.loteCodigo.trim();
    if (!codigo) throw new BadRequestException('El número de lote es obligatorio');
    // Procesando: ingresa el lote y pasa a Validando.
    // Con diferencias: corregir el lote VUELVE a Validando para re-comparar (salida
    // del atasco si el lote estaba mal tipeado).
    if (a.estado === DevEstado.PROCESANDO || a.estado === DevEstado.CON_DIFERENCIAS) {
      await this.transicionar(id, actor, a.estado, DevEstado.VALIDANDO, { loteCodigo: codigo });
      return this.detalle(id);
    }
    // Validando: corrige el lote sin cambiar de estado (sigue validando).
    if (a.estado === DevEstado.VALIDANDO) {
      await this.prisma.devAutorizacion.update({ where: { id }, data: { loteCodigo: codigo } });
      await this.auditoria.registrar({
        actorId: actor.sub,
        actorTipo: actor.tipo,
        accion: 'corregir_lote',
        entidad: 'dev_autorizacion',
        entidadId: String(id),
        detalle: { loteCodigo: codigo },
      });
      return this.detalle(id);
    }
    throw new BadRequestException(
      'El número de lote se ingresa/corrige en Procesando, Validando o Con diferencias',
    );
  }

  /**
   * Con diferencias → Procesado: el responsable revisa las diferencias, carga una
   * observación obligatoria (qué controló) y confirma. Permiso devolucion.validar.
   */
  async confirmarConDiferencias(actor: JwtPayload, id: number, dto: ConfirmarDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.CON_DIFERENCIAS);
    if (!dto.observaciones?.trim()) {
      throw new BadRequestException('Cargá una observación sobre las diferencias para confirmar');
    }
    const reconciliacion = await this.calcularReconciliacion(id, a.loteCodigo ?? null);
    const actualizada = await this.procesar(actor, a, reconciliacion, {
      observaciones: dto.observaciones,
      ubicacionDestinoBueno: dto.ubicacionDestinoBueno,
      ubicacionDestinoMalo: dto.ubicacionDestinoMalo,
    });
    return { autorizacion: actualizada, reconciliacion };
  }

  /**
   * Transición a Procesado + emisión de devolucion.procesada. La usan el camino
   * automático (cron, sin diferencias) y el manual (responsable confirma). Los
   * destinos son informativos y opcionales (vía puerto).
   */
  private async procesar(
    actor: ActorTransicion,
    a: { id: number; estado: DevEstado; clienteId: number; depositoId: number; observaciones: string | null },
    reconciliacion: ReconciliacionLinea[],
    opts: { observaciones?: string; ubicacionDestinoBueno?: string; ubicacionDestinoMalo?: string } = {},
  ) {
    const ubicacionDestinoBueno = await this.ubicacionOpcional(
      opts.ubicacionDestinoBueno,
      'picking',
      'Ubicación destino (buenos)',
    );
    const ubicacionDestinoMalo = await this.ubicacionOpcional(
      opts.ubicacionDestinoMalo,
      'dañados',
      'Ubicación destino (malos)',
    );
    const actualizada = await this.transicionar(a.id, actor, a.estado, DevEstado.PROCESADO, {
      ubicacionDestinoBueno,
      ubicacionDestinoMalo,
      observaciones: this.acumularObservacion(a.observaciones, 'Cierre', opts.observaciones),
    });
    const ev: DevolucionProcesadaEvent = {
      autorizacionId: a.id,
      clienteId: actualizada.clienteId,
      depositoId: actualizada.depositoId,
      reconciliacion,
      ubicacionDestinoBueno: ubicacionDestinoBueno ?? undefined,
      ubicacionDestinoMalo: ubicacionDestinoMalo ?? undefined,
      ts: new Date().toISOString(),
    };
    this.eventos.emit(DEVOLUCION_PROCESADA, ev);
    return actualizada;
  }

  /**
   * Validación periódica (la dispara el cron cada 15 min): por cada devolución en
   * VALIDANDO con lote asignado, espera a que el lote llegue de Fierro y compara
   * declarado vs lote. Sin diferencias → PROCESADO (automático). Con diferencias →
   * CON_DIFERENCIAS + emite devolucion.lote_evaluado (Notificaciones avisa a los
   * responsables). El cambio de estado es la dedup natural (sale de VALIDANDO).
   * Nunca lanza por una devolución: un fallo aislado no frena el resto.
   */
  async evaluarLotesPendientes(): Promise<{
    revisadas: number;
    procesadas: number;
    conDiferencias: number;
  }> {
    if (this.evaluandoLotes) return { revisadas: 0, procesadas: 0, conDiferencias: 0 };
    this.evaluandoLotes = true;
    try {
      const enValidacion = await this.prisma.devAutorizacion.findMany({
        where: { estado: DevEstado.VALIDANDO },
      });
      let procesadas = 0;
      let conDiferencias = 0;
      for (const a of enValidacion) {
        try {
          if (!a.loteCodigo) continue;
          const lote = await this.prisma.devLote.findUnique({ where: { codigo: a.loteCodigo } });
          if (!lote) continue; // el lote aún no llegó de Fierro → sigue validando
          const cli = await this.prisma.cliente.findUnique({
            where: { id: a.clienteId },
            select: { nroCliente: true },
          });
          // No se auto-procesa si NO se puede confirmar pertenencia: cliente sin
          // resolver (cli null) o nroCliente que no coincide → sigue en VALIDANDO.
          if (!cli || cli.nroCliente.trim() !== (lote.nroCliente ?? '').trim()) {
            this.logger.warn(
              `Devolución ${a.id}: no se pudo verificar que el lote ${a.loteCodigo} sea del cliente; sigue en validación`,
            );
            continue;
          }
          const reconciliacion = await this.calcularReconciliacion(a.id, a.loteCodigo);
          const hayDiferencias = reconciliacion.some((l) => this.esLineaConDiferencia(l));
          if (hayDiferencias) {
            await this.transicionar(a.id, SISTEMA, a.estado, DevEstado.CON_DIFERENCIAS);
            const ev: DevolucionLoteEvaluadoEvent = {
              autorizacionId: a.id,
              clienteId: a.clienteId,
              loteCodigo: a.loteCodigo,
              reconciliacion,
              hayDiferencias: true,
              ts: new Date().toISOString(),
            };
            this.eventos.emit(DEVOLUCION_LOTE_EVALUADO, ev);
            conDiferencias++;
          } else {
            await this.procesar(SISTEMA, a, reconciliacion);
            procesadas++;
          }
        } catch (err) {
          this.logger.warn(
            `Validación falló para la devolución ${a.id}: ${(err as Error).message}`,
          );
        }
      }
      return { revisadas: enValidacion.length, procesadas, conDiferencias };
    } finally {
      this.evaluandoLotes = false;
    }
  }

  /**
   * Una línea cuenta como diferencia si: hay diferencia ≠ 0 contra el lote, O el
   * cliente declaró un ISBN que NO figura en el lote del ERP (cantidadFierro null
   * con declarado > 0) — eso también es un descuadre, no "sin diferencias".
   */
  private esLineaConDiferencia(l: ReconciliacionLinea): boolean {
    if (l.cantidadFierro === null) return l.declarado > 0;
    return l.diferencia !== null && l.diferencia !== 0;
  }

  /**
   * Corrección post-Procesado (permiso devolucion.corregir; por defecto solo
   * Administrador). Una devolución Procesada NO se reabre: la corrección re-pesa
   * un bulto, queda en auditoría y re-emite devolucion.procesada con
   * correccion=true para los consumidores.
   */
  async corregirControl(
    actor: JwtPayload,
    id: number,
    numero: number,
    dto: CorregirControlDto,
  ) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.PROCESADO);
    const bulto = await this.prisma.devBulto.findUnique({
      where: { autorizacionId_numero: { autorizacionId: id, numero } },
    });
    if (!bulto) throw new NotFoundException('Bulto inexistente');

    await this.prisma.$transaction([
      this.prisma.devBulto.update({
        where: { id: bulto.id },
        data: { peso: dto.peso },
      }),
      this.prisma.devAutorizacion.update({
        where: { id },
        data: {
          observaciones: this.acumularObservacion(
            a.observaciones,
            `Corrección bulto ${numero}`,
            dto.observaciones ?? 'peso corregido',
          ),
        },
      }),
    ]);
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'correccion_control',
      entidad: 'dev_bulto',
      entidadId: `${id}/${numero}`,
      detalle: { peso: dto.peso, observaciones: dto.observaciones ?? null },
    });

    const reconciliacion = await this.calcularReconciliacion(id, a.loteCodigo ?? null);
    const ev: DevolucionProcesadaEvent = {
      autorizacionId: id,
      clienteId: a.clienteId,
      depositoId: a.depositoId,
      reconciliacion,
      ubicacionDestinoBueno: a.ubicacionDestinoBueno ?? undefined,
      ubicacionDestinoMalo: a.ubicacionDestinoMalo ?? undefined,
      correccion: true,
      ts: new Date().toISOString(),
    };
    this.eventos.emit(DEVOLUCION_PROCESADA, ev);

    return { autorizacion: await this.detalle(id), reconciliacion };
  }

  // ---- consultas ----

  /** Detalle con control de propiedad: un cliente solo ve lo suyo. */
  async detalleAutorizado(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    return this.detalle(id);
  }

  /** Reconciliación con control de propiedad: un cliente solo ve lo suyo. */
  async reconciliacionAutorizada(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    return this.calcularReconciliacion(id, a.loteCodigo ?? null);
  }

  /**
   * Reconciliación por ISBN: lo DECLARADO por el cliente en el WMS vs la cantidad
   * del LOTE del ERP (Fierro). `diferencia = declarado - cantidadFierro` (null si
   * el ISBN no está en el lote, o si la devolución todavía no tiene lote). El
   * conteo real de libros por título lo hace otro proceso, no acá.
   */
  async calcularReconciliacion(
    id: number,
    loteCodigo: string | null,
  ): Promise<ReconciliacionLinea[]> {
    const declaraciones = await this.prisma.devDeclaracion.findMany({
      where: { autorizacionId: id },
    });
    const lote = loteCodigo
      ? await this.prisma.devLote.findUnique({
          where: { codigo: loteCodigo },
          include: { items: true },
        })
      : null;

    const mapa = new Map<string, ReconciliacionLinea>();
    const get = (isbn: string, productoId: number | null): ReconciliacionLinea => {
      let l = mapa.get(isbn);
      if (!l) {
        l = {
          isbn,
          productoId,
          titulo: null,
          declarado: 0,
          cantidadFierro: null,
          diferencia: null,
        };
        mapa.set(isbn, l);
      }
      if (l.productoId === null && productoId !== null) l.productoId = productoId;
      return l;
    };

    for (const d of declaraciones) {
      get(d.isbn, d.productoId).declarado += d.cantidad;
    }
    // Título de Fierro como fallback para ISBN que sólo están en el lote.
    const tituloFierro = new Map<string, string | null>();
    for (const it of lote?.items ?? []) {
      const l = get(it.isbn, null);
      l.cantidadFierro = (l.cantidadFierro ?? 0) + it.cantidad;
      if (!tituloFierro.has(it.isbn)) tituloFierro.set(it.isbn, it.titulo ?? null);
    }

    const lineas = [...mapa.values()].sort((a, b) => a.isbn.localeCompare(b.isbn));
    for (const l of lineas) {
      l.diferencia = l.cantidadFierro === null ? null : l.declarado - l.cantidadFierro;
    }

    // Título desde el catálogo (por ID, sin FK); si no resuelve, el de Fierro.
    const info = await this.infoPorProducto(
      lineas.map((l) => l.productoId).filter((x): x is number => x !== null),
    );
    for (const l of lineas) {
      l.titulo =
        l.productoId !== null
          ? (info.get(l.productoId)?.titulo ?? null)
          : (tituloFierro.get(l.isbn) ?? null);
    }
    return lineas;
  }

  /**
   * Info de catálogo por productoId (referencia por ID, sin FK cruzada): título,
   * editorial e imagen. La imagen + editorial alimentan la miniatura y el popup
   * de producto en el front al reabrir una devolución ya cargada.
   */
  private async infoPorProducto(
    ids: number[],
  ): Promise<Map<number, { titulo: string; editorial: string | null; imagenUrl: string | null }>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return new Map();
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: unicos } },
      select: { id: true, titulo: true, editorial: true, imagenUrl: true },
    });
    return new Map(
      productos.map((p) => [p.id, { titulo: p.titulo, editorial: p.editorial, imagenUrl: p.imagenUrl }]),
    );
  }

  async listar(
    actor: JwtPayload,
    params: { estado?: DevEstado; clienteId?: number; take?: number },
  ) {
    const where: { estado?: DevEstado; clienteId?: number } = {};
    if (params.estado) where.estado = params.estado;
    // Cliente: solo ve lo suyo.
    if (actor.tipo === 'cliente') where.clienteId = actor.sub;
    else if (params.clienteId) where.clienteId = params.clienteId;
    const items = await this.prisma.devAutorizacion.findMany({
      where,
      orderBy: { id: 'desc' },
      // Guardarraíl: la grilla muestra las más recientes (índices estado/clienteId).
      // El export pide un tope mayor porque no tiene costo de render.
      take: params.take ?? 1000,
    });
    // Nombre del cliente para la grilla (referencia por ID, sin FK).
    const ids = [...new Set(items.map((i) => i.clienteId))];
    const clientes = ids.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: ids } },
          select: { id: true, nroCliente: true, nombre: true },
        })
      : [];
    const mapa = new Map(clientes.map((c) => [c.id, c]));
    return items.map((i) => ({ ...i, cliente: mapa.get(i.clienteId) ?? null }));
  }

  /**
   * Export a Excel (.xlsx) de devoluciones. Reusa `listar` → respeta la propiedad
   * (un cliente solo exporta lo suyo) y los filtros de la grilla. Dos hojas:
   * cabecera (una fila por devolución) y detalle (una fila por línea/ISBN).
   */
  async exportarExcel(
    actor: JwtPayload,
    params: { estado?: DevEstado; clienteId?: number },
  ): Promise<Buffer> {
    // Tope alto para el export (un .xlsx no tiene costo de render como la grilla).
    // Si se alcanza, avisamos en una hoja "Nota" para no ocultar un truncado.
    const LIMITE_EXPORT = 20000;
    const items = await this.listar(actor, { ...params, take: LIMITE_EXPORT });
    const truncado = items.length >= LIMITE_EXPORT;
    const ids = items.map((i) => i.id);

    // Detalle de líneas + nombres de transportista + títulos de catálogo (batch).
    const declaraciones = ids.length
      ? await this.prisma.devDeclaracion.findMany({
          where: { autorizacionId: { in: ids } },
          orderBy: [{ autorizacionId: 'asc' }, { isbn: 'asc' }],
        })
      : [];
    const transpIds = [
      ...new Set(items.map((i) => i.transportistaId).filter((x): x is number => x !== null)),
    ];
    const transportistas = transpIds.length
      ? await this.prisma.transportista.findMany({
          where: { id: { in: transpIds } },
          select: { id: true, nombre: true },
        })
      : [];
    const transpMap = new Map(transportistas.map((t) => [t.id, t.nombre]));
    // Nombres de motivo (batch) para la cabecera del export.
    const motivoIds = [
      ...new Set(items.map((i) => i.motivoId).filter((x): x is number => x !== null)),
    ];
    const motivos = motivoIds.length
      ? await this.prisma.motivo.findMany({
          where: { id: { in: motivoIds } },
          select: { id: true, nombre: true },
        })
      : [];
    const motivoMap = new Map(motivos.map((m) => [m.id, m.nombre]));
    const info = await this.infoPorProducto(
      declaraciones.map((d) => d.productoId).filter((x): x is number => x !== null),
    );

    const wb = new Workbook();
    wb.creator = 'WMS Grupal';

    const hoja = wb.addWorksheet('Devoluciones');
    hoja.columns = [
      { header: '#', key: 'id', width: 8 },
      { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Cliente N°', key: 'nroCliente', width: 14 },
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'Motivo', key: 'motivo', width: 26 },
      { header: 'Unidades declaradas', key: 'cantidadUnidades', width: 18 },
      { header: 'Bultos declarados', key: 'bultos', width: 16 },
      { header: 'Peso total (kg)', key: 'peso', width: 14 },
      { header: 'Transportista', key: 'transportista', width: 24 },
      { header: 'Creada', key: 'creada', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Actualizada', key: 'actualizada', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    ];
    for (const i of items) {
      hoja.addRow({
        id: i.id,
        estado: ESTADO_LABEL_EXPORT[i.estado],
        nroCliente: celdaSegura(i.cliente?.nroCliente ?? ''),
        cliente: celdaSegura(i.cliente?.nombre ?? String(i.clienteId)),
        motivo: celdaSegura(i.motivoId !== null ? (motivoMap.get(i.motivoId) ?? '') : ''),
        cantidadUnidades: i.cantidadUnidades ?? '',
        bultos: i.bultosDeclarados ?? '',
        peso: i.pesoTotalDeclarado !== null ? Number(i.pesoTotalDeclarado) : '',
        transportista: celdaSegura(i.transportistaId !== null ? (transpMap.get(i.transportistaId) ?? '') : ''),
        creada: i.createdAt,
        actualizada: i.updatedAt,
      });
    }
    hoja.getRow(1).font = { bold: true };
    hoja.autoFilter = { from: 'A1', to: 'K1' };

    const det = wb.addWorksheet('Detalle por ISBN');
    det.columns = [
      { header: 'Devolución #', key: 'autId', width: 12 },
      { header: 'ISBN', key: 'isbn', width: 18 },
      { header: 'Título', key: 'titulo', width: 44 },
      { header: 'Cantidad', key: 'cantidad', width: 10 },
    ];
    for (const d of declaraciones) {
      det.addRow({
        autId: d.autorizacionId,
        isbn: celdaSegura(d.isbn),
        titulo: celdaSegura(d.productoId !== null ? (info.get(d.productoId)?.titulo ?? '') : ''),
        cantidad: d.cantidad,
      });
    }
    det.getRow(1).font = { bold: true };
    det.autoFilter = { from: 'A1', to: 'D1' };

    // No ocultar un truncado: si se alcanzó el tope, dejamos constancia visible.
    if (truncado) {
      const nota = wb.addWorksheet('Nota');
      nota.getColumn(1).width = 90;
      nota.getCell('A1').value =
        `Se exportaron las ${LIMITE_EXPORT} devoluciones más recientes (tope del export). ` +
        `Hay más registros: afiná el filtro por estado para acotar el resultado.`;
      nota.getCell('A1').font = { bold: true, color: { argb: 'FFB45309' } };
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async detalle(id: number) {
    const a = await this.prisma.devAutorizacion.findUnique({
      where: { id },
      include: {
        declaraciones: true,
        bultos: { orderBy: { numero: 'asc' } },
        excepciones: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!a) throw new NotFoundException('Autorización no encontrada');

    // Datos del núcleo resueltos por ID (sin FK): títulos, cliente, transportista.
    const info = await this.infoPorProducto([
      ...a.declaraciones.map((d) => d.productoId).filter((x): x is number => x !== null),
      ...a.excepciones.map((e) => e.productoId).filter((x): x is number => x !== null),
    ]);
    const [cliente, transportista, creadoPor, motivo] = await Promise.all([
      this.prisma.cliente.findUnique({
        where: { id: a.clienteId },
        select: { id: true, nroCliente: true, nombre: true },
      }),
      a.transportistaId
        ? this.prisma.transportista.findUnique({
            where: { id: a.transportistaId },
            select: { id: true, nombre: true },
          })
        : Promise.resolve(null),
      a.creadoPorTipo === 'cliente'
        ? this.prisma.cliente
            .findUnique({
              where: { id: a.creadoPorId },
              select: { nroCliente: true, nombre: true },
            })
            .then((c) =>
              c ? { tipo: 'cliente' as const, nombre: `${c.nroCliente} · ${c.nombre}` } : null,
            )
        : this.prisma.usuario
            .findUnique({
              where: { id: a.creadoPorId },
              select: { nombre: true, username: true },
            })
            .then((u) => (u ? { tipo: 'usuario' as const, nombre: u.nombre } : null)),
      a.motivoId
        ? this.prisma.motivo.findUnique({
            where: { id: a.motivoId },
            select: { id: true, nombre: true },
          })
        : Promise.resolve(null),
    ]);

    const conTitulo = <T extends { productoId: number | null }>(x: T) => {
      const p = x.productoId !== null ? info.get(x.productoId) : undefined;
      return {
        ...x,
        titulo: p?.titulo ?? null,
        editorial: p?.editorial ?? null,
        imagenUrl: p?.imagenUrl ?? null,
      };
    };
    return {
      ...a,
      cliente,
      transportista,
      creadoPor,
      motivo,
      declaraciones: a.declaraciones.map(conTitulo),
      bultos: a.bultos,
      excepciones: a.excepciones.map(conTitulo),
    };
  }
}
