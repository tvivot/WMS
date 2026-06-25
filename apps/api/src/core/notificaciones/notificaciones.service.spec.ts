import { NotificacionesService } from './notificaciones.service';

type Fila = Record<string, any>;

/**
 * Prisma de prueba acotado a lo que usa notificarCambioEstado/reintentar:
 * reglas (con grupos/usuarios embebidos), clientes, usuarios y el log (outbox).
 */
function fakePrisma() {
  const db = {
    reglas: [
      {
        id: 1,
        modulo: 'devoluciones',
        estado: 'APROBADO',
        incluirCliente: true,
        asunto: 'Devolución #{{nro}} {{estado}}',
        cuerpo: 'Hola {{cliente}}',
        activo: true,
        grupos: [{ grupoId: 10, grupo: { id: 10, activo: true, emails: 'dep@x.com, dep@x.com' } }],
        usuarios: [{ usuarioId: 100 }],
      },
      {
        id: 2,
        modulo: 'devoluciones',
        estado: 'ENTREGADO',
        incluirCliente: false,
        asunto: 'x',
        cuerpo: 'y',
        activo: false, // desactivada
        grupos: [{ grupoId: 10, grupo: { id: 10, activo: true, emails: 'dep@x.com' } }],
        usuarios: [],
      },
      {
        id: 3,
        modulo: 'devoluciones',
        estado: 'PROCESADO',
        incluirCliente: false,
        asunto: 'x',
        cuerpo: 'y',
        activo: true,
        grupos: [], // activa pero sin destinos
        usuarios: [],
      },
    ] as Fila[],
    clientes: [{ id: 5, nombre: 'Librería X', email: 'cliente@x.com' }] as Fila[],
    usuarios: [
      { id: 100, activo: true, email: 'op@x.com' },
      { id: 101, activo: true, email: null },
    ] as Fila[],
    logs: [] as Fila[],
  };
  let seq = 1;
  const prisma = {
    notificacionRegla: {
      findUnique: async ({ where }: any) => {
        const { modulo, estado } = where.modulo_estado;
        const r = db.reglas.find((x) => x.modulo === modulo && x.estado === estado);
        return r ? JSON.parse(JSON.stringify(r)) : null;
      },
    },
    cliente: {
      findUnique: async ({ where }: any) => {
        const c = db.clientes.find((x) => x.id === where.id);
        return c ? { nombre: c.nombre, email: c.email } : null;
      },
    },
    usuario: {
      findMany: async ({ where }: any) => {
        const ids: number[] = where.id.in;
        return db.usuarios
          .filter((u) => ids.includes(u.id) && u.activo && u.email)
          .map((u) => ({ email: u.email }));
      },
    },
    notificacionLog: {
      create: async ({ data }: any) => {
        const fila = { id: seq++, estadoEnvio: 'PENDIENTE', intentos: 0, error: null, ...data };
        db.logs.push(fila);
        return { ...fila };
      },
      update: async ({ where, data }: any) => {
        const l = db.logs.find((x) => x.id === where.id);
        if (!l) throw new Error('log inexistente');
        if (data.intentos?.increment) l.intentos += data.intentos.increment;
        for (const k of ['estadoEnvio', 'error', 'sentAt']) if (k in data) l[k] = data[k];
        return { ...l };
      },
      findMany: async ({ where, take }: any) => {
        return db.logs
          .filter(
            (l) =>
              where.estadoEnvio.in.includes(l.estadoEnvio) && l.intentos < where.intentos.lt,
          )
          .slice(0, take)
          .map((l) => ({ ...l }));
      },
    },
  };
  return { prisma, db };
}

function fakeMailer(opts: { configurado?: boolean; falla?: boolean } = {}) {
  return {
    estaConfigurado: () => opts.configurado ?? true,
    enviar: jest.fn(async (_msg: any) => {
      if (opts.falla) throw new Error('graph 500');
    }),
  };
}

describe('NotificacionesService.notificarCambioEstado', () => {
  it('envía con destinos de grupo + usuario + cliente, deduplicados, y registra ENVIADO', async () => {
    const { prisma, db } = fakePrisma();
    const mailer = fakeMailer();
    const svc = new NotificacionesService(prisma as any, mailer as any);

    await svc.notificarCambioEstado({
      modulo: 'devoluciones',
      estado: 'APROBADO',
      estadoAnterior: 'A_APROBAR',
      entidadId: 42,
      clienteId: 5,
    });

    expect(mailer.enviar).toHaveBeenCalledTimes(1);
    const msg = mailer.enviar.mock.calls[0][0];
    expect(msg.to.sort()).toEqual(['cliente@x.com', 'dep@x.com', 'op@x.com']); // dedup del grupo
    expect(msg.asunto).toBe('Devolución #42 Aprobado');
    expect(msg.cuerpo).toBe('Hola Librería X');
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({ estadoEnvio: 'ENVIADO', entidadId: 42, intentos: 1 });
  });

  it('no hace nada si la regla está inactiva', async () => {
    const { prisma, db } = fakePrisma();
    const mailer = fakeMailer();
    const svc = new NotificacionesService(prisma as any, mailer as any);
    await svc.notificarCambioEstado({ modulo: 'devoluciones', estado: 'ENTREGADO', entidadId: 1, clienteId: 5 });
    expect(mailer.enviar).not.toHaveBeenCalled();
    expect(db.logs).toHaveLength(0);
  });

  it('regla activa sin destinos resolubles no genera log ni envío', async () => {
    const { prisma, db } = fakePrisma();
    const mailer = fakeMailer();
    const svc = new NotificacionesService(prisma as any, mailer as any);
    await svc.notificarCambioEstado({ modulo: 'devoluciones', estado: 'PROCESADO', entidadId: 9, clienteId: 5 });
    expect(mailer.enviar).not.toHaveBeenCalled();
    expect(db.logs).toHaveLength(0);
  });

  it('si el envío falla, registra ERROR (sin lanzar al listener)', async () => {
    const { prisma, db } = fakePrisma();
    const mailer = fakeMailer({ falla: true });
    const svc = new NotificacionesService(prisma as any, mailer as any);
    await svc.notificarCambioEstado({ modulo: 'devoluciones', estado: 'APROBADO', entidadId: 7, clienteId: 5 });
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({ estadoEnvio: 'ERROR', intentos: 1 });
    expect(db.logs[0].error).toContain('graph 500');
  });
});

describe('NotificacionesService.reintentarPendientes', () => {
  it('no reintenta si Office365 no está configurado', async () => {
    const { prisma } = fakePrisma();
    const mailer = fakeMailer({ configurado: false });
    const svc = new NotificacionesService(prisma as any, mailer as any);
    const r = await svc.reintentarPendientes();
    expect(r.reintentados).toBe(0);
    expect(mailer.enviar).not.toHaveBeenCalled();
  });

  it('reprocesa los logs en ERROR y los marca ENVIADO', async () => {
    const { prisma, db } = fakePrisma();
    db.logs.push({
      id: 50,
      estadoEnvio: 'ERROR',
      intentos: 1,
      destinatarios: 'a@x.com, b@x.com',
      asunto: 's',
      cuerpo: 'c',
      error: 'previo',
    });
    const mailer = fakeMailer();
    const svc = new NotificacionesService(prisma as any, mailer as any);
    const r = await svc.reintentarPendientes();
    expect(r.reintentados).toBe(1);
    expect(db.logs[0]).toMatchObject({ estadoEnvio: 'ENVIADO', intentos: 2 });
  });
});
