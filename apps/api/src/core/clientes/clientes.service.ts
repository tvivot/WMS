import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../seguridad/password.service';
import { generarClave } from '../seguridad/clave.util';
import { CrearClienteDto, EditarClienteDto } from './dto';

const PUBLICO = {
  id: true, nroCliente: true, nombre: true, activo: true, primerIngreso: true,
  paisId: true, depositoId: true, createdAt: true,
} as const;

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  async listar(q?: string) {
    const where = q
      ? { OR: [{ nombre: { contains: q } }, { nroCliente: { contains: q } }] }
      : {};
    return this.prisma.cliente.findMany({ where, select: PUBLICO, orderBy: { nombre: 'asc' } });
  }

  /** Crea el cliente y devuelve la clave generada UNA sola vez (para entregarla). */
  async crear(dto: CrearClienteDto) {
    const existe = await this.prisma.cliente.findUnique({ where: { nroCliente: dto.nroCliente } });
    if (existe) throw new BadRequestException('Ya existe un cliente con ese número');
    const clave = generarClave();
    const cliente = await this.prisma.cliente.create({
      data: {
        nroCliente: dto.nroCliente,
        nombre: dto.nombre,
        claveHash: await this.password.hash(clave),
        paisId: dto.paisId ?? null,
        depositoId: dto.depositoId ?? null,
        primerIngreso: true,
      },
      select: PUBLICO,
    });
    return { ...cliente, claveGenerada: clave };
  }

  async editar(id: number, dto: EditarClienteDto) {
    await this.obtener(id);
    return this.prisma.cliente.update({ where: { id }, data: dto, select: PUBLICO });
  }

  async obtener(id: number) {
    const c = await this.prisma.cliente.findUnique({ where: { id }, select: PUBLICO });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    return c;
  }

  /** Resetea la clave y devuelve la nueva (para reentregar). */
  async resetClave(id: number) {
    await this.obtener(id);
    const clave = generarClave();
    await this.prisma.cliente.update({
      where: { id },
      data: { claveHash: await this.password.hash(clave), primerIngreso: true, intentosFallidos: 0, bloqueadoHasta: null },
    });
    return { id, claveGenerada: clave };
  }
}
