// Copia cross-platform del build de la PWA (apps/web/dist) al dir de estáticos
// de la API (apps/api/src/static). Se ejecuta ANTES de compilar la API, para
// que nest-cli copie static/** a dist/static.
import { rm, cp, mkdir, access } from 'node:fs/promises';

const src = 'apps/web/dist';
const dest = 'apps/api/src/static';

try {
  await access(src);
} catch {
  console.error(`[copy-web] No existe ${src}. Corré "npm run build:web" primero.`);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-web] copiado ${src} -> ${dest}`);
