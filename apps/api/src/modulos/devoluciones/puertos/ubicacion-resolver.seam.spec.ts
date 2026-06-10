import { BadRequestException } from '@nestjs/common';
import { DevEstado } from '@prisma/client';
import { AutorizacionService } from '../autorizacion.service';
import type { JwtPayload } from '../../../core/auth/jwt-payload';
import type {
  TipoUbicacion,
  UbicacionResolverPort,
} from './ubicacion-resolver.port';

/**
 * Test del SEAM (criterio del CLAUDE.md): se reemplaza el UbicacionResolverPort
 * por una implementación FALSA que simula el módulo Ubicaciones (valida por
 * tipo), SIN tocar Devoluciones. Prueba que Devoluciones delega en el puerto.
 */
class FakeUbicacionesAdapter implements UbicacionResolverPort {
  // Simula un mapa real de Ubicaciones por tipo.
  private readonly mapa: Record<string, TipoUbicacion[]> = {
    'DEV-01': ['devoluciones', 'staging'],
    'A-01': ['picking'],
    'DAN-01': ['dañados'],
  };
  async existe(codigo: string): Promise<boolean> {
    return codigo in this.mapa;
  }
  async esValidaPara(codigo: string, tipo: TipoUbicacion): Promise<boolean> {
    return this.mapa[codigo]?.includes(tipo) ?? false;
  }
}

function actor(): JwtPayload {
  return { sub: 1, tipo: 'usuario', nombre: 'Dep', permisos: [], primerIngreso: false };
}

describe('Seam UbicacionResolverPort en Devoluciones', () => {
  let prisma: { devAutorizacion: { findUnique: jest.Mock; update: jest.Mock } };
  let svc: AutorizacionService;

  beforeEach(() => {
    prisma = {
      devAutorizacion: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          estado: DevEstado.ENTREGADO,
          clienteId: 1,
        }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 1, estado: DevEstado.INGRESO_DEPOSITO, ...data }),
        ),
      },
    };
    svc = new AutorizacionService(
      prisma as never,
      {} as never, // catalogo (no usado en ingreso)
      { registrar: jest.fn() } as never, // auditoria
      { emit: jest.fn() } as never, // eventos
      new FakeUbicacionesAdapter(), // ← puerto FALSO de Ubicaciones
    );
  });

  it('acepta una ubicación válida para "devoluciones" según el puerto', async () => {
    const r = await svc.ingreso(actor(), 1, { ubicacionEspera: 'DEV-01' });
    expect(r.estado).toBe(DevEstado.INGRESO_DEPOSITO);
    expect(prisma.devAutorizacion.update).toHaveBeenCalled();
  });

  it('rechaza una ubicación NO válida para "devoluciones" (delegó en el puerto)', async () => {
    // 'A-01' es de tipo picking, no devoluciones → el puerto la rechaza.
    await expect(
      svc.ingreso(actor(), 1, { ubicacionEspera: 'A-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.devAutorizacion.update).not.toHaveBeenCalled();
  });
});
