import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductoDto } from './dto';
import { normalizarIsbn } from './isbn.util';

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

    const producto = await this.prisma.producto.upsert({
      where: { codigoInterno: dto.codigoInterno },
      create: {
        codigoInterno: dto.codigoInterno,
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

  async listar(params: { q?: string; skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 200);
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
