import { WooCommerceService } from './woocommerce.service';
import { normalizarWooUrl } from './woocommerce.config';
import type { CatalogoService } from '../../core/catalogo/catalogo.service';

/**
 * Normalización de WOO_URL: fuerza https y saca barras finales. Evita el
 * "Failed to parse URL" cuando la variable se carga sin esquema.
 */
describe('normalizarWooUrl', () => {
  it('antepone https:// cuando falta el esquema', () => {
    expect(normalizarWooUrl('grupaldistribuidora.com.ar')).toBe(
      'https://grupaldistribuidora.com.ar',
    );
  });
  it('eleva http:// a https://', () => {
    expect(normalizarWooUrl('http://tienda.com')).toBe('https://tienda.com');
  });
  it('respeta https:// y elimina barras finales', () => {
    expect(normalizarWooUrl('https://tienda.com/')).toBe('https://tienda.com');
  });
});

/**
 * Tests del núcleo de sincronización de portadas (sin HTTP): matcheo por
 * ISBN, multi-ISBN, "sin imagen" y manejo de errores por producto.
 */
describe('WooCommerceService.procesar', () => {
  function crear() {
    const seteadas: { id: number; url: string }[] = [];
    const catalogo = {
      setImagenUrl: async (id: number, url: string) => {
        seteadas.push({ id, url });
      },
    } as unknown as CatalogoService;
    return { svc: new WooCommerceService(catalogo), seteadas };
  }

  it('guarda la URL cuando WooCommerce devuelve imagen para el ISBN', async () => {
    const { svc, seteadas } = crear();
    const r = await svc.procesar(
      [{ id: 1, isbns: ['9780306406157'] }],
      async () => 'https://tienda.com/img/a.jpg',
    );
    expect(r).toMatchObject({ configurado: true, revisados: 1, actualizados: 1, sinImagen: 0 });
    expect(seteadas).toEqual([{ id: 1, url: 'https://tienda.com/img/a.jpg' }]);
  });

  it('prueba múltiples ISBNs hasta encontrar imagen', async () => {
    const { svc, seteadas } = crear();
    const buscar = async (sku: string) =>
      sku === '9783161484100' ? 'https://tienda.com/img/b.jpg' : null;
    const r = await svc.procesar([{ id: 2, isbns: ['0000000000000', '9783161484100'] }], buscar);
    expect(r.actualizados).toBe(1);
    expect(seteadas).toEqual([{ id: 2, url: 'https://tienda.com/img/b.jpg' }]);
  });

  it('cuenta "sin imagen" cuando ningún ISBN matchea', async () => {
    const { svc, seteadas } = crear();
    const r = await svc.procesar([{ id: 3, isbns: ['x', 'y'] }], async () => null);
    expect(r).toMatchObject({ actualizados: 0, sinImagen: 1 });
    expect(seteadas).toHaveLength(0);
  });

  it('un error en un producto no aborta el lote', async () => {
    const { svc, seteadas } = crear();
    const buscar = async (sku: string) => {
      if (sku === 'boom') throw new Error('WooCommerce HTTP 500');
      return 'https://tienda.com/img/c.jpg';
    };
    const r = await svc.procesar(
      [
        { id: 4, isbns: ['boom'] },
        { id: 5, isbns: ['ok'] },
      ],
      buscar,
    );
    expect(r.actualizados).toBe(1);
    expect(r.errores).toEqual([{ productoId: 4, error: 'WooCommerce HTTP 500' }]);
    expect(seteadas).toEqual([{ id: 5, url: 'https://tienda.com/img/c.jpg' }]);
  });
});
