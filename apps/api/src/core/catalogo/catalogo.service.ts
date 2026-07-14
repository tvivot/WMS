import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UPLOADS_RUTA_PUBLICA, uploadsDir } from '../storage/uploads';
import { ProductoDto, ProductoImportDto } from './dto';
import { convertirAWebp, detectarTipoImagen } from './imagen.util';
import { normalizarIsbn } from './isbn.util';
import { enBloques } from '../util/bloques';

/** Subcarpeta (bajo uploads) y prefijo de URL para las portadas de productos. */
const SUBCARPETA_PRODUCTOS = 'productos';

export interface ProductoResuelto {
  id: number;
  codigoInterno: string;
  codigoFierro: string | null;
  titulo: string;
  editorial: string | null;
  imagenUrl: string | null;
  isbn: string;
}

/**
 * Producto resuelto por su código interno de Fierro (ERP). `isbnCanonico` es el
 * ISBN con el que el producto viaja por el circuito de devoluciones (null si el
 * producto no tiene ISBN asociado).
 */
export interface ProductoPorFierro {
  id: number;
  codigoInterno: string;
  codigoFierro: string;
  titulo: string;
  editorial: string | null;
  imagenUrl: string | null;
  isbnCanonico: string | null;
}

/**
 * Normaliza el código interno de Fierro: trim y string vacío → null (un texto en
 * blanco NO debe reservar el índice único ni "asignar" el producto en el ERP).
 */
export function normalizarCodigoFierro(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

@Injectable()
export class CatalogoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normaliza+valida ISBNs; descarta inválidos y deduplica. */
  private normalizarIsbns(isbns: string[] | undefined): {
    validos: string[];
    invalidos: string[];
  } {
    const validos = new Set<string>();
    const invalidos: string[] = [];
    for (const raw of isbns ?? []) {
      const n = normalizarIsbn(raw);
      if (n) validos.add(n);
      else invalidos.push(raw);
    }
    return { validos: [...validos], invalidos };
  }

  async upsertProducto(dto: ProductoDto): Promise<{ id: number; isbnsInvalidos: string[] }> {
    const { validos, invalidos } = this.normalizarIsbns(dto.isbns);

    // El código interno es opcional: si no viene, se usa el primer ISBN válido
    // (el ISBN actúa como identificador maestro). Sin código ni ISBN no hay alta.
    const codigoInterno = dto.codigoInterno?.trim() || validos[0];
    if (!codigoInterno) {
      throw new BadRequestException(
        'Se requiere código interno o al menos un ISBN válido',
      );
    }

    const codigoFierro = normalizarCodigoFierro(dto.codigoFierro);

    let producto: { id: number };
    try {
      producto = await this.prisma.producto.upsert({
        where: { codigoInterno },
        create: {
          codigoInterno,
          codigoFierro,
          titulo: dto.titulo,
          editorial: dto.editorial ?? null,
          autor: dto.autor ?? null,
          unidadBase: dto.unidadBase ?? 'unidad',
          equivCaja: dto.equivCaja ?? 1,
          equivPallet: dto.equivPallet ?? 1,
          activo: dto.activo ?? true,
        },
        update: {
          codigoFierro,
          titulo: dto.titulo,
          editorial: dto.editorial ?? null,
          autor: dto.autor ?? null,
          unidadBase: dto.unidadBase ?? 'unidad',
          equivCaja: dto.equivCaja ?? 1,
          equivPallet: dto.equivPallet ?? 1,
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        },
        // Solo el id: el alta NO depende de columnas de imagen (la portada es
        // opcional y va por otra vía), así no se acopla a imagen_url.
        select: { id: true },
      });
    } catch (e) {
      // P2002 = violación de índice único. Solo lo traducimos a un 400 claro si
      // el índice violado es el de codigoFierro (el de codigoInterno es la clave
      // del upsert, no puede chocar acá). Cualquier otro P2002 futuro se relanza
      // tal cual en vez de reportar un mensaje de Fierro equivocado.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        this.esViolacionCodigoFierro(e)
      ) {
        throw new BadRequestException(
          `El código Fierro "${codigoFierro}" ya está asignado a otro producto`,
        );
      }
      throw e;
    }

    // Sincroniza ISBNs: agrega los nuevos (un ISBN pertenece a un solo producto).
    for (const isbn of validos) {
      await this.prisma.productoIsbn.upsert({
        where: { isbn },
        update: { productoId: producto.id },
        create: { isbn, productoId: producto.id },
      });
    }

    return { id: producto.id, isbnsInvalidos: invalidos };
  }

  /**
   * True si el P2002 corresponde al índice único de `codigoFierro`. Prisma expone
   * el índice/columnas en `meta.target` (string con el nombre del índice en MySQL
   * o array de campos), así que se busca la marca en cualquiera de las dos formas.
   */
  private esViolacionCodigoFierro(
    e: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = e.meta?.target;
    const texto = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return texto.includes('codigo_fierro') || texto.includes('codigoFierro');
  }

  async bulkUpsert(productos: ProductoDto[]): Promise<{
    procesados: number;
    isbnsInvalidos: string[];
    errores: { codigoInterno?: string; error: string }[];
  }> {
    let procesados = 0;
    const isbnsInvalidos: string[] = [];
    const errores: { codigoInterno?: string; error: string }[] = [];
    // Concurrencia acotada (5 a la vez): reduce el wall-clock del lote sin
    // saturar el pool de conexiones ni arriesgar choques de ISBN entre filas.
    for (const bloque of enBloques(productos, 5)) {
      await Promise.all(
        bloque.map(async (p) => {
          try {
            const ok = await this.upsertProducto(p);
            procesados++;
            isbnsInvalidos.push(...ok.isbnsInvalidos);
          } catch (e) {
            // Una fila que falla (p. ej. código Fierro ya asignado a otro
            // producto, incluida la carrera entre dos filas del mismo bloque)
            // NO aborta el lote: se informa y el resto continúa.
            errores.push({
              codigoInterno: p.codigoInterno,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }),
      );
    }
    return { procesados, isbnsInvalidos, errores };
  }

  /**
   * Importación masiva desde el sistema externo (integrador): catálogo
   * simplificado ISBN + Título + Editorial. Upsert por ISBN (clave de
   * identidad = código interno). Idempotente: reenviar el mismo lote produce
   * el mismo resultado. Una fila con ISBN inválido no aborta el lote: se
   * informa en `errores`. Ver docs/integraciones/manual-api-catalogo.md.
   */
  async importarProductos(items: ProductoImportDto[]): Promise<{
    recibidos: number;
    creados: number;
    actualizados: number;
    errores: { isbn: string; error: string }[];
  }> {
    const errores: { isbn: string; error: string }[] = [];

    // 1) Normalizar ISBN y descartar inválidos (sin abortar el lote). Dedup por
    //    ISBN (la última fila gana) para no procesar el mismo dos veces.
    interface Fila {
      isbn: string;
      titulo: string;
      editorial: string | null;
      codigoFierro: string | null;
    }
    const porIsbn = new Map<string, Fila>();
    for (const item of items) {
      const isbn = normalizarIsbn(item.isbn);
      if (!isbn) {
        errores.push({ isbn: item.isbn, error: 'ISBN inválido' });
        continue;
      }
      porIsbn.set(isbn, {
        isbn,
        titulo: item.titulo,
        editorial: item.editorial ?? null,
        codigoFierro: normalizarCodigoFierro(item.codigoFierro),
      });
    }
    const unicos = [...porIsbn.values()];

    // 2) Lookup masivo de los ISBN ya catalogados (una query por bloque), en vez
    //    de un findUnique por fila (antes: N round-trips serializados).
    const productoPorIsbn = new Map<string, number>();
    for (const bloque of enBloques(unicos.map((v) => v.isbn), 1000)) {
      const filas = await this.prisma.productoIsbn.findMany({
        where: { isbn: { in: bloque } },
        select: { isbn: true, productoId: true },
      });
      for (const f of filas) productoPorIsbn.set(f.isbn, f.productoId);
    }

    // 2.b) Resolver colisiones del código Fierro (índice único) ANTES de escribir:
    //      así una asignación duplicada del ERP no aborta el lote (INSERT IGNORE
    //      saltearía el producto entero; una update chocaría la transacción).
    //      El código que colisiona se descarta (queda null) y se informa en
    //      `errores`; el resto de esa fila (título/editorial) igual se aplica.
    await this.resolverColisionesFierro(unicos, productoPorIsbn, errores);

    // 3) Actualizar los existentes: varias updates por transacción.
    const existentes = unicos.filter((v) => productoPorIsbn.has(v.isbn));
    let actualizados = 0;
    for (const bloque of enBloques(existentes, 200)) {
      await this.prisma.$transaction(
        bloque.map((v) =>
          this.prisma.producto.update({
            where: { id: productoPorIsbn.get(v.isbn)! },
            data: {
              titulo: v.titulo,
              editorial: v.editorial,
              codigoFierro: v.codigoFierro,
            },
            select: { id: true },
          }),
        ),
      );
      actualizados += bloque.length;
    }

    // 4) Crear los nuevos: producto (código interno = ISBN) + vínculo del ISBN.
    //    createMany es idempotente (skipDuplicates); luego se releen los ids —
    //    cubre tanto los recién creados como un código que ya existiera suelto.
    const nuevos = unicos.filter((v) => !productoPorIsbn.has(v.isbn));
    let creados = 0;
    for (const bloque of enBloques(nuevos, 500)) {
      const alta = await this.prisma.producto.createMany({
        data: bloque.map((v) => ({
          codigoInterno: v.isbn,
          codigoFierro: v.codigoFierro,
          titulo: v.titulo,
          editorial: v.editorial,
        })),
        skipDuplicates: true,
      });
      const prods = await this.prisma.producto.findMany({
        where: { codigoInterno: { in: bloque.map((v) => v.isbn) } },
        select: { id: true, codigoInterno: true },
      });
      const idPorCodigo = new Map(prods.map((p) => [p.codigoInterno, p.id]));
      await this.prisma.productoIsbn.createMany({
        data: bloque
          .map((v) => ({ isbn: v.isbn, productoId: idPorCodigo.get(v.isbn) }))
          .filter((d): d is { isbn: string; productoId: number } => d.productoId !== undefined),
        skipDuplicates: true,
      });
      // createMany con skipDuplicates puede saltear un codigoInterno que ya
      // existía suelto: contar las altas REALES (alta.count), no el tamaño del
      // bloque, para no inflar "creados".
      creados += alta.count;
    }

    return { recibidos: items.length, creados, actualizados, errores };
  }

  /**
   * Desactiva (pone en null) los códigos Fierro del lote que colisionarían con el
   * índice único, informando cada caso en `errores`. Muta `filas[].codigoFierro`.
   * Dos fuentes de colisión:
   *   a) Duplicado dentro del mismo lote (dos ISBN con el mismo código): gana el
   *      último; los anteriores pierden el código.
   *   b) Código ya asignado en la base a OTRO producto (distinto al de este ISBN).
   */
  private async resolverColisionesFierro(
    filas: { isbn: string; codigoFierro: string | null }[],
    productoPorIsbn: Map<string, number>,
    errores: { isbn: string; error: string }[],
  ): Promise<void> {
    // a) Dedup dentro del lote: último gana.
    const ganadorPorCodigo = new Map<string, string>(); // codigoFierro -> isbn
    for (const f of filas) {
      if (f.codigoFierro) ganadorPorCodigo.set(f.codigoFierro, f.isbn);
    }
    for (const f of filas) {
      if (f.codigoFierro && ganadorPorCodigo.get(f.codigoFierro) !== f.isbn) {
        errores.push({
          isbn: f.isbn,
          error: `Código Fierro "${f.codigoFierro}" duplicado en el lote`,
        });
        f.codigoFierro = null;
      }
    }

    // b) Choque contra la base: buscar el dueño actual de cada código y, si es un
    //    producto distinto al que corresponde a este ISBN, descartar el código.
    const codigos = [
      ...new Set(filas.map((f) => f.codigoFierro).filter((c): c is string => !!c)),
    ];
    if (codigos.length === 0) return;

    const duenoPorCodigo = new Map<string, number>(); // codigoFierro -> productoId
    for (const bloque of enBloques(codigos, 1000)) {
      const prods = await this.prisma.producto.findMany({
        where: { codigoFierro: { in: bloque } },
        select: { id: true, codigoFierro: true },
      });
      for (const p of prods) {
        if (p.codigoFierro) duenoPorCodigo.set(p.codigoFierro, p.id);
      }
    }
    for (const f of filas) {
      if (!f.codigoFierro) continue;
      const dueno = duenoPorCodigo.get(f.codigoFierro);
      const propio = productoPorIsbn.get(f.isbn); // undefined si es alta nueva
      if (dueno !== undefined && dueno !== propio) {
        errores.push({
          isbn: f.isbn,
          error: `Código Fierro "${f.codigoFierro}" ya asignado a otro producto`,
        });
        f.codigoFierro = null;
      }
    }
  }

  /** Longitud mínima de token para FULLTEXT (innodb_ft_min_token_size = 3). */
  private static readonly FT_MIN = 3;

  /**
   * Arma una expresión boolean-mode de FULLTEXT desde el texto del usuario:
   * cada palabra de >= 3 chars se vuelve `+palabra*` (AND + prefijo). Strippea
   * los operadores boolean-mode (+ - > < ( ) ~ * " @) para no romper la query
   * ni alterar la semántica (hardening: sanitizar toda entrada). Devuelve null
   * si no quedó ningún token utilizable → el caller degrada a `contains`.
   */
  private exprFulltext(q: string): string | null {
    const terminos = q
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[+\-><()~*"@{}]/g, ''))
      .filter((w) => w.length >= CatalogoService.FT_MIN)
      .map((w) => `+${w}*`);
    return terminos.length ? terminos.join(' ') : null;
  }

  /**
   * Escapa los comodines de LIKE (`\` `%` `_`) para que en startsWith/contains
   * se tomen como literales. Sin esto, buscar `%` genera `LIKE '%%'` y devuelve
   * toda la tabla (Prisma NO escapa el valor de startsWith/contains en MySQL).
   */
  private escaparLike(s: string): string {
    return s.replace(/[\\%_]/g, '\\$&');
  }

  async listar(params: { q?: string; skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 500);
    const skip = params.skip ?? 0;
    const q = params.q?.trim();

    // Búsqueda indexada (sin full scan):
    //  - título: FULLTEXT MATCH(titulo) AGAINST(... IN BOOLEAN MODE) por palabra
    //    con prefijo; si el término es < 3 chars degrada a LIKE (contains).
    //  - código interno / ISBN: prefijo (startsWith → LIKE 'q%') sobre sus
    //    índices @unique, sargable, en vez del contains (no indexable) anterior.
    let where: Prisma.ProductoWhereInput = {};
    if (q) {
      const ft = this.exprFulltext(q);
      const qLike = this.escaparLike(q);
      const porTitulo: Prisma.ProductoWhereInput = ft
        ? { titulo: { search: ft } }
        : { titulo: { contains: qLike } };
      where = {
        OR: [
          porTitulo,
          { codigoInterno: { startsWith: qLike } },
          { codigoFierro: { startsWith: qLike } },
          { isbns: { some: { isbn: { startsWith: qLike } } } },
        ],
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.producto.count({ where }),
      this.prisma.producto.findMany({
        where,
        include: { isbns: true },
        orderBy: { titulo: 'asc' },
        skip,
        take,
      }),
    ]);
    return { total, items };
  }

  async obtener(id: number) {
    const p = await this.prisma.producto.findUnique({
      where: { id },
      include: { isbns: true },
    });
    if (!p) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  /**
   * Productos sin portada, con sus ISBNs. Para procesos que completan la imagen
   * desde una fuente externa (p. ej. el conector WooCommerce). `limite` acota
   * el lote por corrida.
   */
  async productosSinImagen(
    opts: { limite?: number; desdeId?: number } = {},
  ): Promise<{ id: number; isbns: string[] }[]> {
    const filas = await this.prisma.producto.findMany({
      // Cursor por `id`: el caller pagina con `desdeId` (último id procesado),
      // así el avance NO depende de si se encontró imagen. Sin el cursor, los
      // productos cuyo SKU no resuelve quedan con imagenUrl=null al frente y se
      // re-traían en cada corrida → el sync se atascaba en los primeros 200.
      where: {
        imagenUrl: null,
        activo: true,
        ...(opts.desdeId ? { id: { gt: opts.desdeId } } : {}),
      },
      select: { id: true, isbns: { select: { isbn: true } } },
      orderBy: { id: 'asc' },
      take: Math.min(opts.limite ?? 200, 1000),
    });
    return filas.map((f) => ({ id: f.id, isbns: f.isbns.map((i) => i.isbn) }));
  }

  /**
   * Setea la portada como una URL externa (no se descarga ni se guarda archivo).
   * La usa el conector WooCommerce para referenciar la imagen ya hosteada allá.
   */
  async setImagenUrl(productoId: number, url: string): Promise<void> {
    await this.prisma.producto.update({
      where: { id: productoId },
      data: { imagenUrl: url },
      select: { id: true },
    });
  }

  /**
   * Guarda la portada de un producto: valida que sea una imagen real (magic
   * bytes), la comprime a WebP (o guarda el original si sharp no está
   * disponible), la escribe en la carpeta de uploads y devuelve el link
   * público autogenerado, que queda en `producto.imagenUrl`.
   */
  async setImagen(
    id: number,
    file?: { buffer?: Buffer; size?: number },
  ): Promise<{ imagenUrl: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No se recibió ninguna imagen');
    }
    const tipo = detectarTipoImagen(file.buffer);
    if (!tipo) {
      throw new BadRequestException(
        'El archivo no es una imagen válida (JPG, PNG, WebP o GIF)',
      );
    }

    const producto = await this.prisma.producto.findUnique({
      where: { id },
      select: { id: true, imagenUrl: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    let datos: Buffer;
    let ext: string;
    try {
      const webp = await convertirAWebp(file.buffer);
      if (webp) {
        datos = webp;
        ext = 'webp';
      } else {
        // sharp no disponible en el entorno: se guarda el original sin comprimir.
        datos = file.buffer;
        ext = tipo.ext;
      }
    } catch {
      throw new BadRequestException('No se pudo procesar la imagen');
    }

    const dir = join(uploadsDir(), SUBCARPETA_PRODUCTOS);
    await mkdir(dir, { recursive: true });
    // Nombre derivado del id + sufijo aleatorio: evita path traversal (no usa el
    // nombre del cliente) y rompe el caché del navegador al reemplazar.
    const nombre = `producto-${id}-${randomBytes(4).toString('hex')}.${ext}`;
    await writeFile(join(dir, nombre), datos);

    // Borra la portada anterior (best-effort) para no acumular huérfanos.
    await this.borrarArchivoImagen(producto.imagenUrl);

    const imagenUrl = `${UPLOADS_RUTA_PUBLICA}/${SUBCARPETA_PRODUCTOS}/${nombre}`;
    await this.prisma.producto.update({ where: { id }, data: { imagenUrl } });
    return { imagenUrl };
  }

  /** Quita la portada de un producto (borra el archivo y limpia el campo). */
  async eliminarImagen(id: number): Promise<{ ok: true }> {
    const producto = await this.prisma.producto.findUnique({
      where: { id },
      select: { id: true, imagenUrl: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    await this.borrarArchivoImagen(producto.imagenUrl);
    await this.prisma.producto.update({ where: { id }, data: { imagenUrl: null } });
    return { ok: true };
  }

  /** Borra el archivo físico de una imagen a partir de su URL pública. */
  private async borrarArchivoImagen(imagenUrl: string | null): Promise<void> {
    if (!imagenUrl) return;
    const nombre = imagenUrl.split('/').pop();
    if (!nombre) return;
    try {
      await unlink(join(uploadsDir(), SUBCARPETA_PRODUCTOS, nombre));
    } catch {
      /* el archivo puede no existir (ya borrado / entorno distinto): se ignora */
    }
  }

  /**
   * Resuelve un ISBN escaneado a un producto del catálogo.
   * Lanza 404 si el ISBN no está catalogado (no se crean líneas fantasma).
   */
  async resolverPorIsbn(isbnEntrada: string): Promise<ProductoResuelto> {
    const isbn = normalizarIsbn(isbnEntrada);
    if (!isbn) throw new BadRequestException('ISBN inválido');
    const fila = await this.prisma.productoIsbn.findUnique({
      where: { isbn },
      include: { producto: true },
    });
    if (!fila) {
      throw new NotFoundException(`ISBN ${isbn} no catalogado`);
    }
    return {
      id: fila.producto.id,
      codigoInterno: fila.producto.codigoInterno,
      codigoFierro: fila.producto.codigoFierro,
      titulo: fila.producto.titulo,
      editorial: fila.producto.editorial,
      imagenUrl: fila.producto.imagenUrl,
      isbn,
    };
  }

  /** Resolución silenciosa (devuelve null si no existe) para uso interno. */
  async resolverPorIsbnOpcional(
    isbnEntrada: string,
  ): Promise<ProductoResuelto | null> {
    try {
      return await this.resolverPorIsbn(isbnEntrada);
    } catch {
      return null;
    }
  }

  /**
   * Resuelve VARIOS ISBN en UNA sola query (evita el N+1 de resolver uno por uno
   * dentro de un loop). Devuelve un Map por ISBN normalizado; los ISBN inválidos
   * o no catalogados simplemente no aparecen en el Map (el caller decide qué hacer).
   */
  async resolverPorIsbnBatch(
    isbnsEntrada: string[],
  ): Promise<Map<string, ProductoResuelto>> {
    const norms = [
      ...new Set(
        isbnsEntrada
          .map((i) => normalizarIsbn(i))
          .filter((n): n is string => !!n),
      ),
    ];
    if (norms.length === 0) return new Map();
    const filas = await this.prisma.productoIsbn.findMany({
      where: { isbn: { in: norms } },
      include: { producto: true },
    });
    return new Map(
      filas.map((f) => [
        f.isbn,
        {
          id: f.producto.id,
          codigoInterno: f.producto.codigoInterno,
          codigoFierro: f.producto.codigoFierro,
          titulo: f.producto.titulo,
          editorial: f.producto.editorial,
          imagenUrl: f.producto.imagenUrl,
          isbn: f.isbn,
        },
      ]),
    );
  }

  /**
   * Resuelve VARIOS códigos internos de Fierro (ERP) a producto en UNA query.
   * Alternativa al ISBN cuando el cliente identifica el artículo por su código de
   * Fierro. Como el circuito de devoluciones viaja por ISBN, se calcula el **ISBN
   * canónico** del producto: se prefiere un ISBN realmente **vinculado** (así
   * declarar(), que resuelve por la tabla de ISBN, lo encuentra sí o sí) y, si no
   * tiene ninguno, se cae al código interno cuando este es un ISBN válido (los
   * altas por import usan el ISBN como código interno). Es `null` si el producto
   * no tiene ISBN (combos): el caller decide qué hacer. El Map se indexa por el
   * código Fierro en MAYÚSCULAS (el índice único de MySQL es case-insensitive, así
   * que el match se hace case-insensitive para no perder un producto por diferencia
   * de capitalización entre el archivo del cliente y lo cargado por el ERP).
   */
  async resolverPorCodigoFierroBatch(
    codigos: string[],
  ): Promise<Map<string, ProductoPorFierro>> {
    const norms = [
      ...new Set(
        codigos
          .map((c) => normalizarCodigoFierro(c))
          .filter((c): c is string => !!c),
      ),
    ];
    if (norms.length === 0) return new Map();
    const prods = await this.prisma.producto.findMany({
      where: { codigoFierro: { in: norms } },
      include: { isbns: { select: { isbn: true }, orderBy: { id: 'asc' }, take: 1 } },
    });
    const m = new Map<string, ProductoPorFierro>();
    for (const p of prods) {
      if (!p.codigoFierro) continue;
      const isbnCanonico = p.isbns[0]?.isbn ?? normalizarIsbn(p.codigoInterno);
      m.set(p.codigoFierro.toUpperCase(), {
        id: p.id,
        codigoInterno: p.codigoInterno,
        codigoFierro: p.codigoFierro,
        titulo: p.titulo,
        editorial: p.editorial,
        imagenUrl: p.imagenUrl,
        isbnCanonico,
      });
    }
    return m;
  }
}
