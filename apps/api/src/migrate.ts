import { execFile } from 'node:child_process';
import { join } from 'node:path';

/**
 * Aplica las migraciones pendientes (`prisma migrate deploy`) en SEGUNDO PLANO,
 * después de que la app ya está escuchando. Así el arranque nunca queda
 * bloqueado (en Hostinger, si el proceso no abre el puerto rápido, el panel lo
 * da por muerto → 503). Idempotente; si falla solo loguea y /api/health
 * refleja el estado real de la DB.
 */
export function runMigrationsAsync(): void {
  let prismaCli: string;
  try {
    prismaCli = require.resolve('prisma/build/index.js');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[wms-api] prisma CLI no disponible, salto migraciones:', (err as Error).message);
    return;
  }
  // __dirname en runtime = apps/api/dist → schema en apps/api/prisma.
  const schemaPath = join(__dirname, '..', 'prisma', 'schema.prisma');
  execFile(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
    { timeout: 120_000 },
    (err, stdout, stderr) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error('[wms-api] migraciones fallaron (la app sigue arriba):', err.message, stderr?.slice(0, 500));
      } else {
        // eslint-disable-next-line no-console
        console.log('[wms-api] migraciones aplicadas:', stdout?.split('\n').slice(-3).join(' ').trim());
      }
    },
  );
}
