import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../seguridad/password.service';
import { PERMISOS_CLIENTE } from './permisos';
import type { JwtPayload } from './jwt-payload';

const MAX_INTENTOS = 5;
const LOCKOUT_MIN = 15;

export interface LoginResultado {
  token: string;
  tipo: 'usuario' | 'cliente';
  nombre: string;
  permisos: string[];
  primerIngreso: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  private bloqueado(bloqueadoHasta: Date | null): boolean {
    return !!bloqueadoHasta && bloqueadoHasta.getTime() > Date.now();
  }

  private firmar(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }

  async loginUsuario(username: string, clave: string): Promise<LoginResultado> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { username },
      include: { roles: { include: { rol: { include: { permisos: { include: { permiso: true } } } } } } },
    });
    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Usuario o clave inválidos');
    }
    if (this.bloqueado(usuario.bloqueadoHasta)) {
      throw new ForbiddenException(
        'Usuario bloqueado temporalmente por intentos fallidos',
      );
    }
    const ok = await this.password.verificar(clave, usuario.claveHash);
    if (!ok) {
      await this.registrarFallo('usuario', usuario.id, usuario.intentosFallidos);
      throw new UnauthorizedException('Usuario o clave inválidos');
    }
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { intentosFallidos: 0, bloqueadoHasta: null },
    });

    const permisos = [
      ...new Set(
        usuario.roles.flatMap((ur) =>
          ur.rol.permisos.map((rp) => rp.permiso.codigo),
        ),
      ),
    ];
    const payload: JwtPayload = {
      sub: usuario.id,
      tipo: 'usuario',
      nombre: usuario.nombre,
      permisos,
      primerIngreso: usuario.primerIngreso,
    };
    return {
      token: this.firmar(payload),
      tipo: 'usuario',
      nombre: usuario.nombre,
      permisos,
      primerIngreso: usuario.primerIngreso,
    };
  }

  async loginCliente(nroCliente: string, clave: string): Promise<LoginResultado> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { nroCliente },
    });
    if (!cliente || !cliente.activo) {
      throw new UnauthorizedException('Cliente o clave inválidos');
    }
    if (this.bloqueado(cliente.bloqueadoHasta)) {
      throw new ForbiddenException(
        'Cliente bloqueado temporalmente por intentos fallidos',
      );
    }
    const ok = await this.password.verificar(clave, cliente.claveHash);
    if (!ok) {
      await this.registrarFallo('cliente', cliente.id, cliente.intentosFallidos);
      throw new UnauthorizedException('Cliente o clave inválidos');
    }
    await this.prisma.cliente.update({
      where: { id: cliente.id },
      data: { intentosFallidos: 0, bloqueadoHasta: null },
    });

    const payload: JwtPayload = {
      sub: cliente.id,
      tipo: 'cliente',
      nombre: cliente.nombre,
      permisos: PERMISOS_CLIENTE,
      primerIngreso: cliente.primerIngreso,
    };
    return {
      token: this.firmar(payload),
      tipo: 'cliente',
      nombre: cliente.nombre,
      permisos: PERMISOS_CLIENTE,
      primerIngreso: cliente.primerIngreso,
    };
  }

  private async registrarFallo(
    tipo: 'usuario' | 'cliente',
    id: number,
    intentosActuales: number,
  ): Promise<void> {
    const intentos = intentosActuales + 1;
    const data: { intentosFallidos: number; bloqueadoHasta?: Date } = {
      intentosFallidos: intentos,
    };
    if (intentos >= MAX_INTENTOS) {
      data.bloqueadoHasta = new Date(Date.now() + LOCKOUT_MIN * 60_000);
    }
    if (tipo === 'usuario') {
      await this.prisma.usuario.update({ where: { id }, data });
    } else {
      await this.prisma.cliente.update({ where: { id }, data });
    }
  }

  async cambiarClave(
    actor: JwtPayload,
    claveActual: string,
    claveNueva: string,
  ): Promise<{ ok: true }> {
    if (actor.tipo === 'usuario') {
      const u = await this.prisma.usuario.findUnique({ where: { id: actor.sub } });
      if (!u || !(await this.password.verificar(claveActual, u.claveHash))) {
        throw new UnauthorizedException('Clave actual incorrecta');
      }
      await this.prisma.usuario.update({
        where: { id: actor.sub },
        data: {
          claveHash: await this.password.hash(claveNueva),
          primerIngreso: false,
        },
      });
    } else {
      const c = await this.prisma.cliente.findUnique({ where: { id: actor.sub } });
      if (!c || !(await this.password.verificar(claveActual, c.claveHash))) {
        throw new UnauthorizedException('Clave actual incorrecta');
      }
      await this.prisma.cliente.update({
        where: { id: actor.sub },
        data: {
          claveHash: await this.password.hash(claveNueva),
          primerIngreso: false,
        },
      });
    }
    return { ok: true };
  }
}
