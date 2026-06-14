import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** Nombre de la última migración (carpeta) para usar como clave del lock. */
function ultimaMigracion(): string {
  try {
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const carpetas = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    return carpetas[carpetas.length - 1] ?? 'none';
  } catch {
    return 'none';
  }
}

/**
 * Variante fire-and-forget para el arranque: la app YA está escuchando
 * (Hostinger exige bind rápido del puerto); esto corre en segundo plano y
 * solo loguea. Para ver el resultado con detalle: POST /api/admin/migraciones.
 *
 * CRÍTICO (Hostinger/Passenger): cada worker corre main.ts y antes spawneaba un
 * `prisma migrate deploy` propio (CLI + engine, con pools de threads del tamaño
 * de los cores del SERVIDOR FÍSICO). Al escalar workers eso disparaba una
 * tormenta de procesos contra el límite nproc. Lock atómico por SET de
 * migraciones (mkdir falla si ya existe): solo el PRIMER worker que ve un set
 * nuevo dispara la migración; el resto la saltea. Si un redeploy trae una
 * migración nueva, cambia el nombre del lock y vuelve a correr una sola vez.
 */
export function runMigrationsAsync(): void {
  const lock = join(tmpdir(), `wms-migrate-${ultimaMigracion()}.lock`);
  try {
    mkdirSync(lock); // atómico entre procesos: lanza EEXIST si ya existe
  } catch {
    return; // otro worker ya está/estuvo a cargo de migrar este set
  }
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
      // Liberar el lock: si falló (timeout, lock de DB ajeno, etc.) el próximo
      // arranque debe poder reintentar este mismo set. Sin esto, una migración
      // fallida quedaría silenciada hasta que llegue una migración nueva.
      try {
        rmdirSync(lock);
      } catch {
        /* el lock ya no está: nada que liberar */
      }
    }
  });
}
