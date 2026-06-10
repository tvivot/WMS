import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CrearTransportistaDto, EditarTransportistaDto } from './dto';

@Injectable()
export class TransportistasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Listado para selección (declaración del cliente): solo activos. */
  listarActivos() {
    return this.prisma.transportista.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true },
    });
  }

  /** Listado completo para el ABM. */
  listar() {
    return this.prisma.transportista.findMany({ orderBy: { nombre: 'asc' } });
  }

  crear(dto: CrearTransportistaDto) {
    return this.prisma.transportista.create({
      data: { nombre: dto.nombre, contacto: dto.contacto ?? null },
    });
  }

  async editar(id: number, dto: EditarTransportistaDto) {
    const existe = await this.prisma.transportista.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Transportista no encontrado');
    return this.prisma.transportista.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.contacto !== undefined ? { contacto: dto.contacto } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
    });
  }
}
