import { Injectable } from '@nestjs/common';
import { DevEstado } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Estados en los que la mercadería YA está físicamente en el depósito pero
 * todavía NO se procesó (cierre). Procesado sale del stock de devoluciones:
 * a partir de ahí el alta de stock real la maneja Inventario vía evento.
 */
const ESTADOS_STOCK = [DevEstado.ENTREGADO, DevEstado.INGRESO_DEPOSITO];

type ProductoInfo = {
  titulo: string;
  editorial: string | null;
  imagenUrl: string | null;
};

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stock de devoluciones: libros declarados ("en principio") por título,
   * agregados sobre todas las devoluciones que están en depósito sin procesar.
   * La cantidad es la DECLARADA por el cliente (lo controlado real se ve al
   * procesar). Una vez Procesada, la devolución deja de contar acá.
   */
  async stock() {
    const declaraciones = await this.prisma.devDeclaracion.findMany({
      where: { autorizacion: { estado: { in: ESTADOS_STOCK } } },
      select: { isbn: true, productoId: true, cantidad: true, autorizacionId: true },
    });

    type Acc = {
      productoId: number | null;
      isbn: string;
      cantidad: number;
      devs: Set<number>;
    };
    const mapa = new Map<string, Acc>();
    for (const d of declaraciones) {
      // Agrupar por producto (un título puede tener varios ISBN); si la línea
      // no resolvió producto, agrupar por ISBN para no perderla.
      const key = d.productoId !== null ? `p${d.productoId}` : `i${d.isbn}`;
      let a = mapa.get(key);
      if (!a) {
        a = { productoId: d.productoId, isbn: d.isbn, cantidad: 0, devs: new Set() };
        mapa.set(key, a);
      }
      a.cantidad += d.cantidad;
      a.devs.add(d.autorizacionId);
    }

    const info = await this.infoPorProducto(
      [...mapa.values()].map((a) => a.productoId).filter((x): x is number => x !== null),
    );

    const items = [...mapa.values()]
      .map((a) => {
        const p = a.productoId !== null ? info.get(a.productoId) : undefined;
        return {
          productoId: a.productoId,
          isbn: a.isbn,
          titulo: p?.titulo ?? null,
          editorial: p?.editorial ?? null,
          imagenUrl: p?.imagenUrl ?? null,
          cantidad: a.cantidad,
          devoluciones: a.devs.size,
        };
      })
      .sort(
        (x, y) =>
          y.cantidad - x.cantidad ||
          (x.titulo ?? x.isbn).localeCompare(y.titulo ?? y.isbn),
      );

    return {
      items,
      totalTitulos: items.length,
      totalLibros: items.reduce((s, i) => s + i.cantidad, 0),
      totalDevoluciones: new Set(declaraciones.map((d) => d.autorizacionId)).size,
    };
  }

  /**
   * Drill-down de un título: en qué devoluciones está (de las que están en
   * depósito sin procesar), con la cantidad de ese título por devolución y el
   * contenido completo (todos los libros + cantidades) de cada una.
   */
  async detalle(productoId: number | null, isbn: string | null) {
    const filtroLinea =
      productoId !== null ? { productoId } : { isbn: isbn ?? '__none__' };
    const matching = await this.prisma.devDeclaracion.findMany({
      where: { ...filtroLinea, autorizacion: { estado: { in: ESTADOS_STOCK } } },
      select: { autorizacionId: true, cantidad: true, isbn: true, productoId: true },
    });
    if (matching.length === 0) return { producto: null, devoluciones: [] };

    const cantidadPorAut = new Map<number, number>();
    for (const m of matching) {
      cantidadPorAut.set(
        m.autorizacionId,
        (cantidadPorAut.get(m.autorizacionId) ?? 0) + m.cantidad,
      );
    }
    const autIds = [...cantidadPorAut.keys()];

    const autorizaciones = await this.prisma.devAutorizacion.findMany({
      where: { id: { in: autIds } },
      orderBy: { id: 'desc' },
      include: { declaraciones: true },
    });

    // Cliente + títulos resueltos por ID (referencia sin FK cruzada).
    const clienteIds = [...new Set(autorizaciones.map((a) => a.clienteId))];
    const clientes = clienteIds.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: clienteIds } },
          select: { id: true, nroCliente: true, nombre: true },
        })
      : [];
    const clienteMapa = new Map(clientes.map((c) => [c.id, c]));

    const info = await this.infoPorProducto(
      autorizaciones.flatMap((a) =>
        a.declaraciones.map((d) => d.productoId).filter((x): x is number => x !== null),
      ),
    );
    const conTitulo = (d: { isbn: string; productoId: number | null; cantidad: number }) => {
      const p = d.productoId !== null ? info.get(d.productoId) : undefined;
      return {
        isbn: d.isbn,
        productoId: d.productoId,
        cantidad: d.cantidad,
        titulo: p?.titulo ?? null,
        editorial: p?.editorial ?? null,
        imagenUrl: p?.imagenUrl ?? null,
      };
    };

    const devoluciones = autorizaciones.map((a) => ({
      autorizacionId: a.id,
      estado: a.estado,
      createdAt: a.createdAt,
      ubicacionEspera: a.ubicacionEspera,
      cliente: clienteMapa.get(a.clienteId) ?? null,
      cantidad: cantidadPorAut.get(a.id) ?? 0,
      lineas: a.declaraciones
        .map(conTitulo)
        .sort((x, y) => (x.titulo ?? x.isbn).localeCompare(y.titulo ?? y.isbn)),
    }));

    // Encabezado del título buscado.
    const repr = matching[0];
    const p = repr.productoId !== null ? info.get(repr.productoId) : undefined;
    const producto = {
      productoId: repr.productoId,
      isbn: repr.isbn,
      titulo: p?.titulo ?? null,
      editorial: p?.editorial ?? null,
      imagenUrl: p?.imagenUrl ?? null,
    };

    return { producto, devoluciones };
  }

  /**
   * Info de catálogo por productoId (referencia por ID, sin FK cruzada).
   * Espeja el helper de AutorizacionService; se mantiene local para no acoplar
   * el stock a la máquina de estados.
   */
  private async infoPorProducto(ids: number[]): Promise<Map<number, ProductoInfo>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return new Map();
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: unicos } },
      select: { id: true, titulo: true, editorial: true, imagenUrl: true },
    });
    return new Map(
      productos.map((p) => [
        p.id,
        { titulo: p.titulo, editorial: p.editorial, imagenUrl: p.imagenUrl },
      ]),
    );
  }
}
