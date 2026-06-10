import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../seguridad/password.service';
import {
  PERMISOS_DESCRIPCION,
  ROLES_DEFAULT,
} from '../auth/permisos';

/**
 * Seed idempotente que corre al arrancar la app:
 *  - permisos del catálogo RBAC
 *  - roles por defecto con su mapa de permisos
 *  - un depósito por defecto (multi-depósito)
 *  - el primer usuario Administrador (credenciales por env, sin terminal)
 * Todo con upsert: correrlo muchas veces no duplica nada.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedPermisos();
      await this.seedRoles();
      await this.seedDeposito();
      await this.seedAdmin();
    } catch (err) {
      this.logger.error(`Seed falló: ${(err as Error).message}`);
    }
  }

  private async seedPermisos(): Promise<void> {
    for (const [codigo, descripcion] of Object.entries(PERMISOS_DESCRIPCION)) {
      await this.prisma.permiso.upsert({
        where: { codigo },
        update: { descripcion },
        create: { codigo, descripcion },
      });
    }
  }

  private async seedRoles(): Promise<void> {
    for (const rolDef of ROLES_DEFAULT) {
      const existente = await this.prisma.rol.findUnique({
        where: { nombre: rolDef.nombre },
      });
      if (existente) continue; // Ya existe: NO tocar sus permisos (los maneja el ABM).

      const rol = await this.prisma.rol.create({
        data: { nombre: rolDef.nombre, descripcion: rolDef.descripcion },
      });
      // Solo al CREAR el rol se aplican los permisos por defecto.
      for (const codigo of rolDef.permisos) {
        const permiso = await this.prisma.permiso.findUnique({ where: { codigo } });
        if (!permiso) continue;
        await this.prisma.rolPermiso.create({
          data: { rolId: rol.id, permisoId: permiso.id },
        });
      }
    }
  }

  private async seedDeposito(): Promise<void> {
    const existe = await this.prisma.deposito.findFirst();
    if (!existe) {
      await this.prisma.deposito.create({ data: { nombre: 'Depósito Principal' } });
    }
  }

  private async seedAdmin(): Promise<void> {
    const username = process.env.ADMIN_USERNAME ?? 'admin';
    const ya = await this.prisma.usuario.findUnique({ where: { username } });
    if (ya) return;

    const claveEnv = process.env.ADMIN_PASSWORD;
    const clave = claveEnv ?? 'Admin1234!';
    const rolAdmin = await this.prisma.rol.findUnique({
      where: { nombre: 'Administrador' },
    });
    const admin = await this.prisma.usuario.create({
      data: {
        username,
        nombre: 'Administrador',
        claveHash: await this.password.hash(clave),
        // Forzar cambio de clave en primer ingreso si se usó la default.
        primerIngreso: !claveEnv,
      },
    });
    if (rolAdmin) {
      await this.prisma.usuarioRol.create({
        data: { usuarioId: admin.id, rolId: rolAdmin.id },
      });
    }
    if (!claveEnv) {
      this.logger.warn(
        `Admin creado con clave POR DEFECTO (usuario="${username}", clave="Admin1234!"). ` +
          'Cambiala en el primer ingreso o seteá ADMIN_PASSWORD en las env vars.',
      );
    } else {
      this.logger.log(`Admin "${username}" creado desde ADMIN_PASSWORD.`);
    }
  }
}
