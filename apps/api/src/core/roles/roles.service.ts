import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CrearRolDto, EditarRolDto } from './dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Include compartido para traer permisos + conteo de usuarios en una query. */
  private static readonly INCLUDE = {
    permisos: { include: { permiso: true } },
    _count: { select: { usuarios: true } },
  } as const;

  /** Mapea un rol YA cargado (con INCLUDE) a la forma pública. */
  private mapearDesde(rol: {
    id: number; nombre: string; descripcion: string | null; activo: boolean;
    _count: { usuarios: number };
    permisos: { permiso: { codigo: string } }[];
  }) {
    return {
      id: rol.id,
      nombre: rol.nombre,
      descripcion: rol.descripcion,
      activo: rol.activo,
      usuarios: rol._count.usuarios,
      permisos: rol.permisos.map((p) => p.permiso.codigo),
    };
  }

  private async mapear(rolId: number) {
    const rol = await this.prisma.rol.findUnique({
      where: { id: rolId },
      include: RolesService.INCLUDE,
    });
    if (!rol) throw new NotFoundException('Rol no encontrado');
    return this.mapearDesde(rol);
  }

  async listar() {
    // Una sola query con includes en vez de un findUnique por rol (N+1).
    const roles = await this.prisma.rol.findMany({
      orderBy: { nombre: 'asc' },
      include: RolesService.INCLUDE,
    });
    return roles.map((r) => this.mapearDesde(r));
  }

  /** Catálogo completo de permisos (para construir el ABM). */
  async catalogoPermisos() {
    return this.prisma.permiso.findMany({ orderBy: { codigo: 'asc' } });
  }

  /** Reemplaza el set de permisos del rol por los códigos dados. */
  private async aplicarPermisos(rolId: number, codigos: string[]) {
    const permisos = await this.prisma.permiso.findMany({
      where: { codigo: { in: codigos } },
    });
    await this.prisma.rolPermiso.deleteMany({ where: { rolId } });
    if (permisos.length) {
      await this.prisma.rolPermiso.createMany({
        data: permisos.map((p) => ({ rolId, permisoId: p.id })),
      });
    }
  }

  async crear(dto: CrearRolDto) {
    const existe = await this.prisma.rol.findUnique({ where: { nombre: dto.nombre } });
    if (existe) throw new BadRequestException('Ya existe un rol con ese nombre');
    const rol = await this.prisma.rol.create({
      data: { nombre: dto.nombre, descripcion: dto.descripcion ?? null },
    });
    if (dto.permisos) await this.aplicarPermisos(rol.id, dto.permisos);
    return this.mapear(rol.id);
  }

  async editar(id: number, dto: EditarRolDto) {
    const rol = await this.prisma.rol.findUnique({ where: { id } });
    if (!rol) throw new NotFoundException('Rol no encontrado');
    if (dto.descripcion !== undefined) {
      await this.prisma.rol.update({ where: { id }, data: { descripcion: dto.descripcion } });
    }
    if (dto.permisos) await this.aplicarPermisos(id, dto.permisos);
    return this.mapear(id);
  }
}
