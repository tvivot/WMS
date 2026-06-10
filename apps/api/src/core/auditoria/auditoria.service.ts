import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface RegistroAuditoria {
  actorId?: number | null;
  actorTipo: 'usuario' | 'cliente' | 'sistema';
  accion: string;
  entidad: string;
  entidadId: string;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  detalle?: unknown;
}

/**
 * Auditoría inmutable (transversal). Solo inserta; nunca edita/borra.
 * Registra quién, cuándo, qué acción y transición de estado.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(r: RegistroAuditoria): Promise<void> {
    await this.prisma.auditoria.create({
      data: {
        actorId: r.actorId ?? null,
        actorTipo: r.actorTipo,
        accion: r.accion,
        entidad: r.entidad,
        entidadId: r.entidadId,
        estadoAnterior: r.estadoAnterior ?? null,
        estadoNuevo: r.estadoNuevo ?? null,
        detalle: (r.detalle ?? undefined) as never,
      },
    });
  }

  async listarPorEntidad(entidad: string, entidadId: string) {
    return this.prisma.auditoria.findMany({
      where: { entidad, entidadId },
      orderBy: { id: 'desc' },
    });
  }
}
