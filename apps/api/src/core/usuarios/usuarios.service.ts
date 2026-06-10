import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../seguridad/password.service';
import { generarClave } from '../seguridad/clave.util';
import { CrearUsuarioDto, EditarUsuarioDto } from './dto';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  private mapear(u: {
    id: number; username: string; nombre: string; email: string | null;
    activo: boolean; primerIngreso: boolean; createdAt: Date;
    roles: { rol: { id: number; nombre: string } }[];
  }) {
    return {
      id: u.id, username: u.username, nombre: u.nombre, email: u.email,
      activo: u.activo, primerIngreso: u.primerIngreso, createdAt: u.createdAt,
      roles: u.roles.map((r) => ({ id: r.rol.id, nombre: r.rol.nombre })),
    };
  }

  async listar(q?: string) {
    const where = q
      ? { OR: [{ nombre: { contains: q } }, { username: { contains: q } }] }
      : {};
    const us = await this.prisma.usuario.findMany({
      where,
      include: { roles: { include: { rol: true } } },
      orderBy: { nombre: 'asc' },
    });
    return us.map((u) => this.mapear(u));
  }

  async crear(dto: CrearUsuarioDto) {
    const existe = await this.prisma.usuario.findUnique({ where: { username: dto.username } });
    if (existe) throw new BadRequestException('Ya existe ese usuario');
    const clave = generarClave();
    const u = await this.prisma.usuario.create({
      data: {
        username: dto.username,
        nombre: dto.nombre,
        email: dto.email ?? null,
        claveHash: await this.password.hash(clave),
        primerIngreso: true,
        roles: dto.rolIds?.length
          ? { create: dto.rolIds.map((rolId) => ({ rolId })) }
          : undefined,
      },
      include: { roles: { include: { rol: true } } },
    });
    return { ...this.mapear(u), claveGenerada: clave };
  }

  async editar(id: number, dto: EditarUsuarioDto) {
    await this.obtener(id);
    if (dto.rolIds) {
      await this.prisma.usuarioRol.deleteMany({ where: { usuarioId: id } });
      if (dto.rolIds.length) {
        await this.prisma.usuarioRol.createMany({
          data: dto.rolIds.map((rolId) => ({ usuarioId: id, rolId })),
        });
      }
    }
    const u = await this.prisma.usuario.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
      include: { roles: { include: { rol: true } } },
    });
    return this.mapear(u);
  }

  async obtener(id: number) {
    const u = await this.prisma.usuario.findUnique({
      where: { id },
      include: { roles: { include: { rol: true } } },
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    return this.mapear(u);
  }

  async resetClave(id: number) {
    await this.obtener(id);
    const clave = generarClave();
    await this.prisma.usuario.update({
      where: { id },
      data: { claveHash: await this.password.hash(clave), primerIngreso: true, intentosFallidos: 0, bloqueadoHasta: null },
    });
    return { id, claveGenerada: clave };
  }

  async listarRoles() {
    return this.prisma.rol.findMany({
      include: { permisos: { include: { permiso: true } } },
      orderBy: { nombre: 'asc' },
    });
  }
}
