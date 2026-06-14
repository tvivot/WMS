import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Ruta pública (URL) bajo la que se sirven los archivos subidos. */
export const UPLOADS_RUTA_PUBLICA = '/uploads';

/** Nombre de la carpeta de portadas (a la misma altura que public_html). */
const CARPETA = 'Tapas';

/**
 * Carpeta física donde se guardan las portadas subidas.
 *
 * Resolución:
 *  1. Si está seteada `UPLOADS_DIR`, se usa esa ruta absoluta (override).
 *  2. Si no, se ubica una carpeta `Tapas` **a la misma altura que
 *     `public_html`**: en Hostinger la app Node corre en
 *     `/home/uXXXX/domains/<dominio>/nodejs` y `public_html` es su hermana,
 *     así que se busca `public_html` subiendo desde el cwd y se devuelve su
 *     hermana `Tapas` → `/home/uXXXX/domains/<dominio>/Tapas`. Queda FUERA del
 *     build (`dist/`), por lo que sobrevive a los redeploys.
 *  3. Fallback (dev local, sin `public_html`): `<cwd>/Tapas`.
 */
export function uploadsDir(): string {
  const env = process.env.UPLOADS_DIR?.trim();
  if (env) return env;

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'public_html'))) return join(dir, CARPETA);
    const padre = dirname(dir);
    if (padre === dir) break; // llegó a la raíz del filesystem
    dir = padre;
  }
  return join(process.cwd(), CARPETA);
}
