import { api } from './api';

/** Datos mínimos de un producto para miniatura + popup en devoluciones. */
export interface ProductoLite {
  isbn: string;
  titulo: string;
  editorial: string | null;
  imagenUrl: string | null;
}

interface ProductoCatalogo {
  id: number;
  titulo: string;
  editorial: string | null;
  imagenUrl: string | null;
  isbns: { isbn: string }[];
}

/**
 * Typeahead de catálogo para la carga de devoluciones: busca por título/ISBN/
 * código (server-side) y devuelve una sugerencia por producto con la imagen.
 * El ISBN devuelto es el que mejor matchea lo tipeado (prefijo) o el primero.
 */
export async function buscarProductos(q: string, take = 8): Promise<ProductoLite[]> {
  const term = q.trim();
  if (term.length < 4) return [];
  const r = await api.get<{ items: ProductoCatalogo[] }>(
    `/catalogo/productos?take=${take}&q=${encodeURIComponent(term)}`,
  );
  return r.items.map((p) => {
    const isbn = p.isbns.find((i) => i.isbn.startsWith(term))?.isbn ?? p.isbns[0]?.isbn ?? term;
    return { isbn, titulo: p.titulo, editorial: p.editorial, imagenUrl: p.imagenUrl };
  });
}
