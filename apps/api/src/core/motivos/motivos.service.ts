import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CrearMotivoDto, EditarMotivoDto } from './dto';

@Injectable()
export class MotivosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Motivos activos de un módulo, para poblar el selector (p.ej. al crear una
   * devolución). Devuelve `requiereObservacion` para que el front exija la
   * observación cuando corresponde (caso "Otro").
   */
  listarPorModulo(modulo: string) {
    return this.prisma.motivo.findMany({
      where: { modulo, activo: true },
      orderBy: { id: 'asc' },
      select: { id: true, nombre: true, requiereObservacion: true },
    });
  }

  /** Listado completo para el ABM (incluye inactivos). Opcionalmente por módulo. */
  listar(modulo?: string) {
    return this.prisma.motivo.findMany({
      where: modulo ? { modulo } : undefined,
      orderBy: [{ modulo: 'asc' }, { id: 'asc' }],
    });
  }

  crear(dto: CrearMotivoDto) {
    return this.prisma.motivo.create({
      data: {
        nombre: dto.nombre,
        modulo: dto.modulo?.trim() || 'devoluciones',
        requiereObservacion: dto.requiereObservacion ?? false,
      },
    });
  }

  async editar(id: number, dto: EditarMotivoDto) {
    const existe = await this.prisma.motivo.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Motivo no encontrado');
    return this.prisma.motivo.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.requiereObservacion !== undefined
          ? { requiereObservacion: dto.requiereObservacion }
          : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
    });
  }
}
