import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';
import { AppModule } from './app.module';
import { construirDocOpenApi } from './openapi.config';

/**
 * Genera docs/openapi.yaml (el contrato de la API para el WMS).
 * Correr: `node apps/api/dist/openapi-gen.js` (tras `npm run build:api`, que
 * aplica el plugin de Swagger para extraer los schemas de los DTOs).
 */
async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  const doc = construirDocOpenApi(app);
  const dir = join(__dirname, '..', '..', '..', 'docs');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'openapi.yaml');
  writeFileSync(out, stringify(doc));
  // eslint-disable-next-line no-console
  console.log('[openapi] generado', out);
  await app.close();
  process.exit(0);
}

void main();
