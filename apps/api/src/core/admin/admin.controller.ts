import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, Post } from '@nestjs/common';
import { RequierePermiso } from '../auth/decoradores';
import { PERMISOS } from '../auth/permisos';
import { PrismaService } from '../../prisma/prisma.service';
import { ejecutarMigraciones } from '../../migrate';

/**
 * Operaciones de administración para hosting SIN terminal (Hostinger):
 * ver el estado de las migraciones y aplicarlas a demanda viendo el resultado.
 * Solo Admin (rol.administrar).
 */
@RequierePermiso(PERMISOS.ROL_ADMINISTRAR)
@Controller('admin/migraciones')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  /** Migraciones aplicadas en la DB vs disponibles en el deploy (pendientes). */
  @Get()
  async estado() {
    let aplicadas: { migration_name: string; finished_at: Date | null }[] = [];
    try {
      aplicadas = await this.prisma.$queryRaw<
        { migration_name: string; finished_at: Date | null }[]
      >`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`;
    } catch {
      // tabla _prisma_migrations inexistente = nunca se migró
    }
    // __dirname runtime = dist/core/admin → migraciones en apps/api/prisma/migrations
    const dirMigraciones = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
    let disponibles: string[] = [];
    try {
      disponibles = readdirSync(dirMigraciones, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      // sin carpeta de migraciones en el deploy
    }
    const okAplicadas = aplicadas
      .filter((a) => a.finished_at !== null)
      .map((a) => a.migration_name);
    const fallidas = aplicadas
      .filter((a) => a.finished_at === null)
      .map((a) => a.migration_name);
    const pendientes = disponibles.filter((d) => !okAplicadas.includes(d));
    return { aplicadas: okAplicadas, fallidas, pendientes, disponibles };
  }

  /** Ejecuta `prisma migrate deploy` y devuelve stdout/stderr (diagnóstico). */
  @Post()
  aplicar() {
    return ejecutarMigraciones();
  }
}
