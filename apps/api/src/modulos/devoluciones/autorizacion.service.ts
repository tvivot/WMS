import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DevEstado, DevEstadoControl, DevExcepcionEstado, Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaService } from '../../core/auditoria/auditoria.service';
import { CatalogoService } from '../../core/catalogo/catalogo.service';
import { normalizarIsbn } from '../../core/catalogo/isbn.util';
import type { JwtPayload } from '../../core/auth/jwt-payload';
import {
  CerrarDto,
  ControlarBultoDto,
  CorregirControlDto,
  CrearAutorizacionDto,
  DeclararDto,
  IngresoDto,
  LineaControlDto,
  RecibirDto,
  ResolverExcepcionDto,
  SolicitarExcepcionDto,
} from './dto';
import {
  DEVOLUCION_ESTADO_CAMBIADO,
  DEVOLUCION_PROCESADA,
  type DevolucionEstadoCambiadoEvent,
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
  INGRESO_DEPOSITO: 'Ingreso a depósito',
  PROCESADO: 'Procesado',
};

@Injectable()
export class AutorizacionService {
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
    actor: JwtPayload,
    estadoAnterior: DevEstado,
    estadoNuevo: DevEstado,
    extra: Record<string, unknown> = {},
  ) {
    const actualizada = await this.prisma.devAutorizacion.update({
      where: { id },
      data: { estado: estadoNuevo, ...extra },
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
   * ISBN→producto y devuelve qué libros/cantidades se importarían y qué filas
   * fallaron, para que el cliente lo revise y lo acepte antes de cargarlo en la
   * declaración (la persistencia sigue pasando por declarar() → mismo gate y misma
   * validación de consignación). Solo en estado APROBADO y sobre la propia
   * devolución (un cliente no importa en la de otro).
   *
   * Si no se indica el mapeo de columnas, devuelve solo el listado de columnas
   * (con auto-detección por encabezado) para que el cliente elija ISBN y cantidad.
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
        isbnCol =
          columnas.find((col) => /isbn|ean|c[oó]digo/i.test(col.encabezado))?.indice ?? null;
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
    // La misma columna para ISBN y cantidad daría líneas con el ISBN como cantidad.
    if (isbnCol === cantidadCol) {
      throw new BadRequestException('La columna de ISBN y la de cantidad no pueden ser la misma');
    }

    // Recorrido de filas de datos: junta candidatos y filas con error.
    const ultimaFila = ws.rowCount;
    const topeFila = Math.min(ultimaFila, filaDatos + IMPORT_MAX_FILAS - 1);
    const truncado = ultimaFila > topeFila;
    const candidatos: { fila: number; isbn: string; cantidad: number }[] = [];
    const errores: ErrorImportacion[] = [];
    let filasLeidas = 0;

    for (let r = filaDatos; r <= topeFila; r++) {
      const fila = ws.getRow(r);
      const isbnRaw = celdaTexto(fila.getCell(isbnCol).value);
      const cantRaw = celdaTexto(fila.getCell(cantidadCol).value);
      if (!isbnRaw && !cantRaw) continue; // fila vacía: se ignora
      filasLeidas++;

      const norm = normalizarIsbn(isbnRaw);
      if (!norm) {
        errores.push({ fila: r, isbn: isbnRaw || null, cantidad: cantRaw || null, motivo: 'ISBN inválido' });
        continue;
      }
      // Estricto: solo dígitos. Evita que separadores de miles/decimales se
      // malinterpreten en silencio (p.ej. "1.000" → 1 con Number()).
      if (!/^\d+$/.test(cantRaw)) {
        errores.push({ fila: r, isbn: norm, cantidad: cantRaw || null, motivo: 'Cantidad inválida (debe ser un entero ≥ 1, sin separadores)' });
        continue;
      }
      const cantidad = Number(cantRaw);
      if (cantidad < 1) {
        errores.push({ fila: r, isbn: norm, cantidad: cantRaw || null, motivo: 'Cantidad inválida (debe ser ≥ 1)' });
        continue;
      }
      candidatos.push({ fila: r, isbn: norm, cantidad });
    }

    // Resolución de catálogo en bloque (sin N+1); no catalogado → fila con error.
    const productos = await this.catalogo.resolverPorIsbnBatch(candidatos.map((c) => c.isbn));
    const lineas = new Map<string, LineaImportada>();
    for (const cand of candidatos) {
      const prod = productos.get(cand.isbn);
      if (!prod) {
        errores.push({ fila: cand.fila, isbn: cand.isbn, cantidad: String(cand.cantidad), motivo: 'ISBN no catalogado' });
        continue;
      }
      const ya = lineas.get(cand.isbn);
      if (ya) ya.cantidad += cand.cantidad;
      else
        lineas.set(cand.isbn, {
          isbn: cand.isbn,
          cantidad: cand.cantidad,
          productoId: prod.id,
          titulo: prod.titulo,
          editorial: prod.editorial,
          imagenUrl: prod.imagenUrl,
        });
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

  /** Ingreso a depósito: registra ubicación de espera (informativa, vía puerto). */
  async ingreso(actor: JwtPayload, id: number, dto: IngresoDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.ENTREGADO);
    const ubicacionEspera = await this.ubicacionOpcional(
      dto.ubicacionEspera,
      'devoluciones',
      'Ubicación de espera',
    );
    return this.transicionar(id, actor, a.estado, DevEstado.INGRESO_DEPOSITO, {
      ubicacionEspera,
    });
  }

  /**
   * Resuelve y valida las líneas de control de un bulto: ISBN normalizado y
   * catalogado (misma regla que la declaración: avisar, no cargar fantasmas),
   * mal estado ≤ cantidad.
   */
  private async resolverControles(
    bultoId: number,
    controles: LineaControlDto[],
  ): Promise<
    { bultoId: number; isbn: string; productoId: number; cantidad: number; malEstado: number }[]
  > {
    const filas: { bultoId: number; isbn: string; productoId: number; cantidad: number; malEstado: number }[] = [];
    const noCatalogados: string[] = [];
    // Resolución en bloque (1 query) en vez de un findUnique por control (N+1).
    const productos = await this.catalogo.resolverPorIsbnBatch(
      controles.map((c) => c.isbn),
    );
    for (const c of controles) {
      const norm = normalizarIsbn(c.isbn);
      if (!norm) throw new BadRequestException(`ISBN inválido: ${c.isbn}`);
      const malo = c.malEstado ?? 0;
      if (malo > c.cantidad) {
        throw new BadRequestException('mal estado no puede superar la cantidad');
      }
      const prod = productos.get(norm);
      if (!prod) {
        noCatalogados.push(norm);
        continue;
      }
      const ya = filas.find((f) => f.isbn === norm);
      if (ya) {
        ya.cantidad += c.cantidad;
        ya.malEstado += malo;
      } else {
        filas.push({
          bultoId,
          isbn: norm,
          productoId: prod.id,
          cantidad: c.cantidad,
          malEstado: malo,
        });
      }
    }
    if (noCatalogados.length > 0) {
      throw new BadRequestException(
        `ISBN no catalogados (cargalos al catálogo antes de controlar): ${noCatalogados.join(', ')}`,
      );
    }
    return filas;
  }

  /** Control de un bulto: cantidades + mal estado por ISBN (estado INGRESO_DEPOSITO). */
  async controlarBulto(
    actor: JwtPayload,
    id: number,
    numero: number,
    dto: ControlarBultoDto,
  ) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.INGRESO_DEPOSITO);
    const bulto = await this.prisma.devBulto.findUnique({
      where: { autorizacionId_numero: { autorizacionId: id, numero } },
    });
    if (!bulto) throw new NotFoundException('Bulto inexistente');

    const filas = await this.resolverControles(bulto.id, dto.controles);

    await this.prisma.$transaction([
      this.prisma.devControl.deleteMany({ where: { bultoId: bulto.id } }),
      this.prisma.devControl.createMany({ data: filas }),
      this.prisma.devBulto.update({
        where: { id: bulto.id },
        data: {
          peso: dto.peso ?? bulto.peso,
          estadoControl: DevEstadoControl.CONTROLADO,
        },
      }),
    ]);
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'controlar_bulto',
      entidad: 'dev_bulto',
      entidadId: `${id}/${numero}`,
      detalle: { lineas: filas.length },
    });
    return this.detalle(id);
  }

  /** Cierre: reconciliación + destinos + Procesado + evento devolucion.procesada. */
  async cerrar(actor: JwtPayload, id: number, dto: CerrarDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.INGRESO_DEPOSITO);

    const bultos = await this.prisma.devBulto.findMany({ where: { autorizacionId: id } });
    if (bultos.length === 0) {
      throw new BadRequestException('No hay bultos para cerrar');
    }
    const sinControlar = bultos.filter(
      (b) => b.estadoControl !== DevEstadoControl.CONTROLADO,
    );
    if (sinControlar.length > 0) {
      throw new BadRequestException(
        `Hay ${sinControlar.length} bulto(s) sin controlar; no se puede procesar`,
      );
    }

    // Ubicaciones destino INFORMATIVAS (opcionales): buenos a picking/pallet,
    // malos a dañados/cuarentena. No bloquean el cierre; si se cargan, se validan.
    const ubicacionDestinoBueno = await this.ubicacionOpcional(
      dto.ubicacionDestinoBueno,
      'picking',
      'Ubicación destino (buenos)',
    );
    const ubicacionDestinoMalo = await this.ubicacionOpcional(
      dto.ubicacionDestinoMalo,
      'dañados',
      'Ubicación destino (malos)',
    );

    // Control de peso: suma de bultos vs peso total declarado (no bloquea, exige observación).
    const sumaPesos = bultos.reduce((acc, b) => acc + (b.peso ? Number(b.peso) : 0), 0);
    const declarado = a.pesoTotalDeclarado ? Number(a.pesoTotalDeclarado) : null;
    // La observación debe ser PROPIA del cierre: una observación previa
    // (p.ej. de la recepción) no justifica la diferencia de peso.
    if (
      declarado !== null &&
      Math.abs(sumaPesos - declarado) > PESO_TOLERANCIA &&
      !dto.observaciones
    ) {
      throw new BadRequestException(
        `Suma de pesos (${sumaPesos}) ≠ peso declarado (${declarado}): observación obligatoria`,
      );
    }

    const reconciliacion = await this.calcularReconciliacion(id, a.clienteId);

    // Exceso de consignación (recibido > saldo del ERP): no bloquea, exige
    // observación propia del cierre (mismo criterio que la diferencia de peso).
    if (reconciliacion.some((l) => l.excedeConsignacion) && !dto.observaciones) {
      const excedidos = reconciliacion
        .filter((l) => l.excedeConsignacion)
        .map((l) => l.isbn)
        .join(', ');
      throw new BadRequestException(
        `Hay devoluciones que exceden el saldo en consignación (${excedidos}): observación obligatoria`,
      );
    }

    const actualizada = await this.transicionar(
      id,
      actor,
      a.estado,
      DevEstado.PROCESADO,
      {
        ubicacionDestinoBueno,
        ubicacionDestinoMalo,
        observaciones: this.acumularObservacion(a.observaciones, 'Cierre', dto.observaciones),
      },
    );

    const ev: DevolucionProcesadaEvent = {
      autorizacionId: id,
      clienteId: a.clienteId,
      depositoId: a.depositoId,
      reconciliacion,
      ubicacionDestinoBueno: ubicacionDestinoBueno ?? undefined,
      ubicacionDestinoMalo: ubicacionDestinoMalo ?? undefined,
      ts: new Date().toISOString(),
    };
    // NO mueve stock: solo registra destino y emite el evento (lo consume Inventario).
    this.eventos.emit(DEVOLUCION_PROCESADA, ev);

    return { autorizacion: actualizada, reconciliacion };
  }

  /**
   * Corrección post-Procesado (permiso devolucion.corregir; por defecto solo
   * Administrador). Una devolución Procesada NO se reabre: la corrección
   * reemplaza el control de un bulto, queda en auditoría y re-emite
   * devolucion.procesada con correccion=true para los consumidores.
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

    const filas = await this.resolverControles(bulto.id, dto.controles);

    await this.prisma.$transaction([
      this.prisma.devControl.deleteMany({ where: { bultoId: bulto.id } }),
      this.prisma.devControl.createMany({ data: filas }),
      this.prisma.devBulto.update({
        where: { id: bulto.id },
        data: { peso: dto.peso ?? bulto.peso },
      }),
      this.prisma.devAutorizacion.update({
        where: { id },
        data: {
          observaciones: this.acumularObservacion(
            a.observaciones,
            `Corrección bulto ${numero}`,
            dto.observaciones ?? 'control corregido',
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
      detalle: { lineas: filas.length, observaciones: dto.observaciones ?? null },
    });

    const reconciliacion = await this.calcularReconciliacion(id, a.clienteId);
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
    return this.calcularReconciliacion(id, a.clienteId);
  }

  /**
   * Reconciliación declarado vs recibido por ISBN (agrega sobre todos los
   * bultos) + saldo en consignación del cliente. `excedeConsignacion` marca
   * (no bloquea) cuando se recibió más de lo que el cliente tenía en
   * consignación; saldo null = sin dato del ERP (nunca marca exceso).
   */
  async calcularReconciliacion(
    id: number,
    clienteId: number,
  ): Promise<ReconciliacionLinea[]> {
    const [declaraciones, bultos] = await Promise.all([
      this.prisma.devDeclaracion.findMany({ where: { autorizacionId: id } }),
      this.prisma.devBulto.findMany({
        where: { autorizacionId: id },
        include: { controles: true },
      }),
    ]);

    const mapa = new Map<string, ReconciliacionLinea>();
    const get = (isbn: string, productoId: number | null): ReconciliacionLinea => {
      let l = mapa.get(isbn);
      if (!l) {
        l = {
          isbn,
          productoId,
          titulo: null,
          declarado: 0,
          recibido: 0,
          bueno: 0,
          malo: 0,
          saldoConsignacion: null,
          excedeConsignacion: false,
        };
        mapa.set(isbn, l);
      }
      if (l.productoId === null && productoId !== null) l.productoId = productoId;
      return l;
    };

    for (const d of declaraciones) {
      get(d.isbn, d.productoId).declarado += d.cantidad;
    }
    for (const b of bultos) {
      for (const c of b.controles) {
        const l = get(c.isbn, c.productoId);
        l.recibido += c.cantidad;
        l.malo += c.malEstado;
        l.bueno += c.cantidad - c.malEstado;
      }
    }
    const lineas = [...mapa.values()].sort((a, b) => a.isbn.localeCompare(b.isbn));

    // Saldo en consignación por ISBN (lookup batch, sin N+1). Ausencia de dato
    // → null y nunca marca exceso.
    const saldos = await this.consignacion.saldosDe(
      clienteId,
      lineas.map((l) => l.isbn),
    );
    for (const l of lineas) {
      const saldo = saldos.get(l.isbn);
      l.saldoConsignacion = saldo ?? null;
      l.excedeConsignacion = saldo !== undefined && l.recibido > saldo;
    }

    // Título desde el catálogo (referencia por ID, sin FK).
    const info = await this.infoPorProducto(
      lineas.map((l) => l.productoId).filter((x): x is number => x !== null),
    );
    for (const l of lineas) {
      l.titulo = l.productoId !== null ? (info.get(l.productoId)?.titulo ?? null) : null;
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
        nroCliente: i.cliente?.nroCliente ?? '',
        cliente: i.cliente?.nombre ?? String(i.clienteId),
        motivo: i.motivoId !== null ? (motivoMap.get(i.motivoId) ?? '') : '',
        cantidadUnidades: i.cantidadUnidades ?? '',
        bultos: i.bultosDeclarados ?? '',
        peso: i.pesoTotalDeclarado !== null ? Number(i.pesoTotalDeclarado) : '',
        transportista: i.transportistaId !== null ? (transpMap.get(i.transportistaId) ?? '') : '',
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
        isbn: d.isbn,
        titulo: d.productoId !== null ? (info.get(d.productoId)?.titulo ?? '') : '',
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
        bultos: { include: { controles: true }, orderBy: { numero: 'asc' } },
        excepciones: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!a) throw new NotFoundException('Autorización no encontrada');

    // Datos del núcleo resueltos por ID (sin FK): títulos, cliente, transportista.
    const info = await this.infoPorProducto([
      ...a.declaraciones.map((d) => d.productoId).filter((x): x is number => x !== null),
      ...a.bultos.flatMap((b) =>
        b.controles.map((c) => c.productoId).filter((x): x is number => x !== null),
      ),
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
      bultos: a.bultos.map((b) => ({ ...b, controles: b.controles.map(conTitulo) })),
      excepciones: a.excepciones.map(conTitulo),
    };
  }
}
