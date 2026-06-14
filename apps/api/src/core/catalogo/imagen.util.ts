/**
 * Utilidades de imagen para portadas de productos.
 * - Validación por "magic bytes" (no se confía en el mimetype que manda el
 *   cliente: es superficie de ataque, ver política de hardening).
 * - Conversión a WebP con sharp vía import dinámico + fallback, para que un
 *   fallo del módulo nativo en el hosting NO rompa la subida.
 */

export interface TipoImagen {
  ext: string;
  mime: string;
}

/** Detecta el tipo real de imagen leyendo los primeros bytes del archivo. */
export function detectarTipoImagen(buf: Buffer): TipoImagen | null {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  // GIF: "GIF87a" / "GIF89a"
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
    return { ext: 'gif', mime: 'image/gif' };
  }
  // WEBP: "RIFF"...."WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/**
 * Convierte una imagen a WebP redimensionada (ancho máx. para portadas) con
 * sharp. Import dinámico: si sharp no carga en el entorno (módulo nativo),
 * devuelve `null` para que el caller guarde el original sin comprimir en vez de
 * romper. Lanza si el buffer no es una imagen procesable (cuando sharp sí está).
 */
export async function convertirAWebp(buf: Buffer): Promise<Buffer | null> {
  let sharp: typeof import('sharp').default;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return null; // sharp no disponible → fallback al original
  }
  return sharp(buf)
    .rotate() // respeta orientación EXIF antes de redimensionar
    .resize({ width: 600, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}
