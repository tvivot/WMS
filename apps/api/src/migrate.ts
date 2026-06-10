import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Aplica las migraciones pendientes (`prisma migrate deploy`) al arrancar la app.
 * Permite migrar en Hostinger sin acceso a terminal. Es idempotente: si no hay
 * migraciones pendientes, no hace nada. Si falla, loguea y NO frena el arranque
 * (la app igual levanta y /api/health reporta el estado de la DB).
 */
export function runMigrations(): void {
  try {
    // Resuelve el CLI de Prisma desde node_modules (independiente del cwd).
    const prismaCli = require.resolve('prisma/build/index.js');
    // __dirname en runtime = apps/api/dist → schema en apps/api/prisma.
    const schemaPath = join(__dirname, '..', 'prisma', 'schema.prisma');
    execFileSync('node', [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
      stdio: 'inherit',
    });
    // eslint-disable-next-line no-console
    console.log('[wms-api] migraciones aplicadas (migrate deploy)');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[wms-api] no se pudieron aplicar migraciones:',
      (err as Error).message,
    );
  }
}
