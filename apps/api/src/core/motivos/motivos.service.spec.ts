import { NotFoundException } from '@nestjs/common';
import { MotivosService } from './motivos.service';

type Fila = Record<string, any>;

function fakePrisma() {
  let seq = 100;
  const db: { motivos: Fila[] } = {
    motivos: [
      { id: 1, modulo: 'devoluciones', nombre: 'Otro', requiereObservacion: true, activo: true },
      { id: 2, modulo: 'devoluciones', nombre: 'Editorial', requiereObservacion: false, activo: true },
      { id: 9, modulo: 'devoluciones', nombre: 'Viejo', requiereObservacion: false, activo: false },
    ],
  };
  const prisma = {
    motivo: {
      findMany: async ({ where, orderBy }: any) => {
        let r = db.motivos.filter(
          (m) =>
            (where?.modulo === undefined || m.modulo === where.modulo) &&
            (where?.activo === undefined || m.activo === where.activo),
        );
        if (Array.isArray(orderBy) || orderBy?.id) r = [...r].sort((a, b) => a.id - b.id);
        return r.map((x) => ({ ...x }));
      },
      findUnique: async ({ where }: any) => {
        const m = db.motivos.find((x) => x.id === where.id);
        return m ? { ...m } : null;
      },
      create: async ({ data }: any) => {
        const fila = { id: seq++, activo: true, ...data };
        db.motivos.push(fila);
        return { ...fila };
      },
      update: async ({ where, data }: any) => {
        const m = db.motivos.find((x) => x.id === where.id);
        if (!m) throw new Error('motivo inexistente');
        Object.assign(m, data);
        return { ...m };
      },
    },
  };
  return { prisma, db };
}

function crear() {
  const { prisma, db } = fakePrisma();
  return { svc: new MotivosService(prisma as any), db };
}

describe('MotivosService', () => {
  it('listarPorModulo devuelve solo activos del módulo', async () => {
    const { svc } = crear();
    const r = await svc.listarPorModulo('devoluciones');
    expect(r.map((m) => m.id)).toEqual([1, 2]); // el inactivo (9) no aparece
    expect(r[0]).toMatchObject({ id: 1, nombre: 'Otro', requiereObservacion: true });
  });

  it('listar (admin) incluye inactivos', async () => {
    const { svc } = crear();
    const r = await svc.listar('devoluciones');
    expect(r.map((m: any) => m.id)).toContain(9);
  });

  it('crear usa modulo "devoluciones" por defecto y requiereObservacion=false', async () => {
    const { svc } = crear();
    const m = await svc.crear({ nombre: 'Nuevo motivo' });
    expect(m.modulo).toBe('devoluciones');
    expect(m.requiereObservacion).toBe(false);
  });

  it('editar cambia nombre/activo; 404 si no existe', async () => {
    const { svc } = crear();
    const m = await svc.editar(2, { activo: false, nombre: 'Renombrado' });
    expect(m.activo).toBe(false);
    expect(m.nombre).toBe('Renombrado');
    await expect(svc.editar(999, { activo: false })).rejects.toThrow(NotFoundException);
  });
});
