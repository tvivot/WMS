import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UPLOADS_RUTA_PUBLICA, uploadsDir } from '../storage/uploads';
import { ProductoDto, ProductoImportDto } from './dto';
import { convertirAWebp, detectarTipoImagen } from './imagen.util';
import { normalizarIsbn } from './isbn.util';

/** Subcarpeta (bajo uploads) y prefijo de URL para las portadas de productos. */
const SUBCARPETA_PRODUCTOS = 'productos';

export interface ProductoResuelto {
  id: number;
  codigoInterno: string;
  titulo: string;
  editorial: string | null;
  isbn: string;
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

    const producto = await this.prisma.producto.upsert({
      where: { codigoInterno },
      create: {
        codigoInterno,
        titulo: dto.titulo,
        editorial: dto.editorial ?? null,
        autor: dto.autor ?? null,
        unidadBase: dto.unidadBase ?? 'unidad',
        equivCaja: dto.equivCaja ?? 1,
        equivPallet: dto.equivPallet ?? 1,
        activo: dto.activo ?? true,
      },
      update: {
        titulo: dto.titulo,
        editorial: dto.editorial ?? null,
        autor: dto.autor ?? null,
        unidadBase: dto.unidadBase ?? 'unidad',
        equivCaja: dto.equivCaja ?? 1,
        equivPallet: dto.equivPallet ?? 1,
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
    });

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

  async bulkUpsert(
    productos: ProductoDto[],
  ): Promise<{ procesados: number; isbnsInvalidos: string[] }> {
    let procesados = 0;
    const isbnsInvalidos: string[] = [];
    for (const p of productos) {
      const r = await this.upsertProducto(p);
      procesados++;
      isbnsInvalidos.push(...r.isbnsInvalidos);
    }
    return { procesados, isbnsInvalidos };
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
    let creados = 0;
    let actualizados = 0;
    const errores: { isbn: string; error: string }[] = [];

    for (const item of items) {
      const isbn = normalizarIsbn(item.isbn);
      if (!isbn) {
        errores.push({ isbn: item.isbn, error: 'ISBN inválido' });
        continue;
      }
      try {
        // La identidad es el ISBN: si ya está catalogado, se actualiza ese
        // producto; si no, se crea uno nuevo con código interno = ISBN.
        const existente = await this.prisma.productoIsbn.findUnique({
          where: { isbn },
          select: { productoId: true },
        });
        if (existente) {
          await this.prisma.producto.update({
            where: { id: existente.productoId },
            data: { titulo: item.titulo, editorial: item.editorial ?? null },
          });
          actualizados++;
        } else {
          // ISBN no catalogado: crea (o reusa) el producto con código = ISBN
          // y lo vincula. upsert evita chocar si el código ya existiera suelto.
          const producto = await this.prisma.producto.upsert({
            where: { codigoInterno: isbn },
            create: {
              codigoInterno: isbn,
              titulo: item.titulo,
              editorial: item.editorial ?? null,
            },
            update: { titulo: item.titulo, editorial: item.editorial ?? null },
          });
          await this.prisma.productoIsbn.create({
            data: { isbn, productoId: producto.id },
          });
          creados++;
        }
      } catch (err) {
        errores.push({ isbn, error: (err as Error).message.slice(0, 200) });
      }
    }
    return { recibidos: items.length, creados, actualizados, errores };
  }

  async listar(params: { q?: string; skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 500);
    const skip = params.skip ?? 0;
    const where = params.q
      ? {
          OR: [
            { titulo: { contains: params.q } },
            { codigoInterno: { contains: params.q } },
            { isbns: { some: { isbn: { contains: params.q } } } },
          ],
        }
      : {};
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
      titulo: fila.producto.titulo,
      editorial: fila.producto.editorial,
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
}
