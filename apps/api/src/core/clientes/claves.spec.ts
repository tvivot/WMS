import { PasswordService } from '../seguridad/password.service';
import { ClientesService } from './clientes.service';
import { UsuariosService } from '../usuarios/usuarios.service';

/**
 * Claves manuales vs generadas (clientes y usuarios):
 * - clave elegida por el admin → se hashea esa y queda definitiva (primerIngreso=false)
 * - sin clave → se genera una aleatoria y se exige cambio en el primer ingreso
 */
describe('Claves manuales en alta y reset', () => {
  const password = new PasswordService();

  function prismaFake() {
    const updates: any[] = [];
    const creates: any[] = [];
    return {
      updates,
      creates,
      cliente: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => { creates.push(data); return { id: 1, ...data }; }),
        update: jest.fn(async ({ data }: any) => { updates.push(data); return { id: 1, ...data }; }),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => { creates.push(data); return { id: 1, createdAt: new Date(), ...data, roles: [] }; }),
        update: jest.fn(async ({ data }: any) => { updates.push(data); return { id: 1, ...data }; }),
      },
    } as any;
  }

  it('cliente: alta con clave manual la usa y no fuerza cambio', async () => {
    const prisma = prismaFake();
    const svc = new ClientesService(prisma, password);
    const r = await svc.crear({ nroCliente: 'C1', nombre: 'Cli', clave: 'MiClaveElegida' } as any);
    expect(r.claveGenerada).toBe('MiClaveElegida');
    expect(prisma.creates[0].primerIngreso).toBe(false);
    expect(await password.verificar('MiClaveElegida', prisma.creates[0].claveHash)).toBe(true);
  });

  it('cliente: alta sin clave genera una y fuerza cambio en primer ingreso', async () => {
    const prisma = prismaFake();
    const svc = new ClientesService(prisma, password);
    const r = await svc.crear({ nroCliente: 'C2', nombre: 'Cli' } as any);
    expect(r.claveGenerada).toHaveLength(10);
    expect(prisma.creates[0].primerIngreso).toBe(true);
    expect(await password.verificar(r.claveGenerada, prisma.creates[0].claveHash)).toBe(true);
  });

  it('cliente: reset con clave manual la asigna como definitiva y desbloquea', async () => {
    const prisma = prismaFake();
    prisma.cliente.findUnique.mockResolvedValue({ id: 1, nroCliente: 'C1' });
    const svc = new ClientesService(prisma, password);
    const r = await svc.resetClave(1, 'OtraClave99');
    expect(r.claveGenerada).toBe('OtraClave99');
    expect(prisma.updates[0].primerIngreso).toBe(false);
    expect(prisma.updates[0].intentosFallidos).toBe(0);
    expect(prisma.updates[0].bloqueadoHasta).toBeNull();
  });

  it('cliente: reset sin clave genera una y fuerza cambio', async () => {
    const prisma = prismaFake();
    prisma.cliente.findUnique.mockResolvedValue({ id: 1, nroCliente: 'C1' });
    const svc = new ClientesService(prisma, password);
    const r = await svc.resetClave(1);
    expect(r.claveGenerada).toHaveLength(10);
    expect(prisma.updates[0].primerIngreso).toBe(true);
  });

  it('usuario: alta con clave manual y reset generado', async () => {
    const prisma = prismaFake();
    const svc = new UsuariosService(prisma, password);
    const r = await svc.crear({ username: 'u1', nombre: 'User', clave: 'ClaveDeUsuario' } as any);
    expect(r.claveGenerada).toBe('ClaveDeUsuario');
    expect(prisma.creates[0].primerIngreso).toBe(false);

    prisma.usuario.findUnique.mockResolvedValue({ id: 1, username: 'u1', roles: [], createdAt: new Date() });
    const reset = await svc.resetClave(1);
    expect(reset.claveGenerada).toHaveLength(10);
    expect(prisma.updates[0].primerIngreso).toBe(true);
  });
});
