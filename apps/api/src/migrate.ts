import { execFile } from 'node:child_process';
import { join } from 'node:path';

export interface ResultadoMigracion {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Ejecuta `prisma migrate deploy` y devuelve el resultado completo (stdout y
 * stderr) para poder diagnosticar fallos en hostings sin terminal (Hostinger).
 * Idempotente: sin migraciones pendientes no hace nada.
 */
export function ejecutarMigraciones(): Promise<ResultadoMigracion> {
  return new Promise((resolve) => {
    let prismaCli: string;
    try {
      prismaCli = require.resolve('prisma/build/index.js');
    } catch (err) {
      resolve({
        ok: false,
        stdout: '',
        stderr: '',
        error: `prisma CLI no disponible: ${(err as Error).message}`,
      });
      return;
    }
    // __dirname en runtime = apps/api/dist → schema en apps/api/prisma.
    const schemaPath = join(__dirname, '..', 'prisma', 'schema.prisma');
    execFile(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
      { timeout: 120_000, env: process.env },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: (stdout ?? '').slice(-2000),
          stderr: (stderr ?? '').slice(-2000),
          error: err ? err.message : undefined,
        });
      },
    );
  });
}

/**
 * Variante fire-and-forget para el arranque: la app YA está escuchando
 * (Hostinger exige bind rápido del puerto); esto corre en segundo plano y
 * solo loguea. Para ver el resultado con detalle: POST /api/admin/migraciones.
 */
export function runMigrationsAsync(): void {
  void ejecutarMigraciones().then((r) => {
    if (r.ok) {
      // eslint-disable-next-line no-console
      console.log(
        '[wms-api] migraciones aplicadas:',
        r.stdout.split('\n').slice(-3).join(' ').trim(),
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        '[wms-api] migraciones fallaron (la app sigue arriba):',
        r.error,
        r.stderr.slice(0, 500),
      );
    }
  });
}
