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
 * tipo), SIN tocar Devoluciones. El seam se ejercita por los destinos del cierre
 * (buenos → picking/pallet, malos → dañados/cuarentena), validados vía el puerto.
 */
class FakeUbicacionesAdapter implements UbicacionResolverPort {
  private readonly mapa: Record<string, TipoUbicacion[]> = {
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
  let prisma: any;
  let svc: AutorizacionService;

  beforeEach(() => {
    const base = {
      id: 1,
      estado: DevEstado.CON_DIFERENCIAS,
      clienteId: 1,
      depositoId: 1,
      observaciones: null,
      loteCodigo: null,
      motivoId: null,
      transportistaId: null,
      creadoPorId: 1,
      creadoPorTipo: 'usuario',
    };
    prisma = {
      devAutorizacion: {
        findUnique: jest.fn().mockImplementation(({ include }: any) =>
          Promise.resolve(
            include ? { ...base, declaraciones: [], bultos: [], excepciones: [] } : base,
          ),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockImplementation(() =>
          Promise.resolve({ ...base, estado: DevEstado.PROCESADO }),
        ),
      },
      devDeclaracion: { findMany: jest.fn().mockResolvedValue([]) },
      devLote: { findUnique: jest.fn().mockResolvedValue(null) },
      cliente: { findUnique: jest.fn().mockResolvedValue({ id: 1, nroCliente: 'C-1', nombre: 'X' }) },
      transportista: { findUnique: jest.fn() },
      motivo: { findUnique: jest.fn() },
      usuario: { findUnique: jest.fn().mockResolvedValue({ nombre: 'Dep', username: 'dep' }) },
      producto: { findMany: jest.fn().mockResolvedValue([]) },
    };
    svc = new AutorizacionService(
      prisma as never,
      {} as never, // catalogo (no usado acá)
      { registrar: jest.fn() } as never, // auditoria
      { emit: jest.fn() } as never, // eventos
      new FakeUbicacionesAdapter(), // ← puerto FALSO de Ubicaciones
      { cargarSaldos: jest.fn(), saldosDe: jest.fn() } as never, // consignación
    );
  });

  it('acepta un destino válido para "picking" según el puerto', async () => {
    const r = await svc.confirmarConDiferencias(actor(), 1, {
      observaciones: 'revisado',
      ubicacionDestinoBueno: 'A-01',
    });
    expect(r.autorizacion.estado).toBe(DevEstado.PROCESADO);
    expect(prisma.devAutorizacion.updateMany).toHaveBeenCalled();
  });

  it('rechaza un destino NO válido para "picking" (delegó en el puerto)', async () => {
    // 'DAN-01' es de tipo dañados, no picking → el puerto la rechaza.
    await expect(
      svc.confirmarConDiferencias(actor(), 1, {
        observaciones: 'revisado',
        ubicacionDestinoBueno: 'DAN-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.devAutorizacion.updateMany).not.toHaveBeenCalled();
  });
});
