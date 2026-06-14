import { detectarTipoImagen } from './imagen.util';

/**
 * El tipo se detecta por los bytes reales del archivo (no por el mimetype que
 * manda el cliente), que es lo que protege contra subir contenido disfrazado.
 */
describe('detectarTipoImagen', () => {
  const conCabecera = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

  it('reconoce JPEG', () => {
    expect(detectarTipoImagen(conCabecera([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      ext: 'jpg', mime: 'image/jpeg',
    });
  });

  it('reconoce PNG', () => {
    expect(
      detectarTipoImagen(conCabecera([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toEqual({ ext: 'png', mime: 'image/png' });
  });

  it('reconoce GIF', () => {
    expect(detectarTipoImagen(Buffer.from('GIF89a' + '\0'.repeat(16)))).toEqual({
      ext: 'gif', mime: 'image/gif',
    });
  });

  it('reconoce WebP (RIFF....WEBP)', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(8),
    ]);
    expect(detectarTipoImagen(buf)).toEqual({ ext: 'webp', mime: 'image/webp' });
  });

  it('rechaza texto plano (contenido disfrazado)', () => {
    expect(detectarTipoImagen(Buffer.from('esto no es una imagen, igual lo mando'))).toBeNull();
  });

  it('rechaza buffer demasiado corto', () => {
    expect(detectarTipoImagen(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('rechaza un PDF (magic %PDF)', () => {
    expect(detectarTipoImagen(Buffer.from('%PDF-1.7' + '\0'.repeat(16)))).toBeNull();
  });
});
