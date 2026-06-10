import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DevEstado } from '@prisma/client';
import type { JwtPayload } from '../../core/auth/jwt-payload';
import { AutorizacionService } from './autorizacion.service';
import { DEVOLUCION_ESTADO_CAMBIADO, DEVOLUCION_PROCESADA } from './eventos/eventos';
import { TextFreeUbicacionResolverAdapter } from './puertos/ubicacion-resolver.adapter';

/**
 * Tests del módulo Devoluciones sobre un Prisma fake en memoria:
 *  - máquina de estados (no se saltean estados, transiciones inválidas rechazadas)
 *  - reglas de dominio (observaciones por bultos/peso, ISBN catalogado, propiedad)
 *  - reconciliación multi-bulto con ISBN mezclados
 *  - circuito end-to-end del criterio de validación + eventos + auditoría
 *  - corrección post-Procesado
 */

// ---- ISBNs reales (checksum válido) ----
const ISBN_A = '9780306406157';
const ISBN_B = '9783161484100';
const ISBN_C = '9780131103627';
const ISBN_NO_CATALOGADO = '9780470059029'; // válido pero fuera del catálogo de prueba

// ---- actores ----
const vendedor: JwtPayload = { sub: 1, tipo: 'usuario', nombre: 'Vendedor', permisos: [], primerIngreso: false };
const deposito: JwtPayload = { sub: 2, tipo: 'usuario', nombre: 'Depósito', permisos: [], primerIngreso: false };
const admin: JwtPayload = { sub: 3, tipo: 'usuario', nombre: 'Admin', permisos: [], primerIngreso: false };
const clienteX: JwtPayload = { sub: 10, tipo: 'cliente', nombre: 'Cliente X', permisos: [], primerIngreso: false };
const clienteAjeno: JwtPayload = { sub: 11, tipo: 'cliente', nombre: 'Otro', permisos: [], primerIngreso: false };

// ---- fake prisma en memoria (solo lo que usa el servicio) ----
type Fila = Record<string, unknown> & { id: number };

function crearFakePrisma() {
  let secuencia = 1;
  const nextId = () => secuencia++;
  const db = {
    autorizaciones: [] as Fila[],
    declaraciones: [] as Fila[],
    bultos: [] as Fila[],
    controles: [] as Fila[],
    clientes: [
      { id: 10, nroCliente: 'C-10', nombre: 'Cliente X', activo: true, depositoId: null },
      { id: 11, nroCliente: 'C-11', nombre: 'Otro Cliente', activo: true, depositoId: null },
    ] as Fila[],
    depositos: [{ id: 1, nombre: 'Depósito Principal' }] as Fila[],
    transportistas: [
      { id: 5, nombre: 'Trans OK', activo: true },
      { id: 6, nombre: 'Trans Baja', activo: false },
    ] as Fila[],
    productos: [
      { id: 1, titulo: 'Libro A' },
      { id: 2, titulo: 'Libro B' },
      { id: 3, titulo: 'Libro C' },
    ] as Fila[],
  };

  const prisma = {
    devAutorizacion: {
      findUnique: async ({ where, include }: any) => {
        const a = db.autorizaciones.find((x) => x.id === where.id);
        if (!a) return null;
        if (!include) return { ...a };
        return {
          ...a,
          declaraciones: db.declaraciones.filter((d) => d.autorizacionId === a.id).map((x) => ({ ...x })),
          bultos: db.bultos
            .filter((b) => b.autorizacionId === a.id)
            .sort((x: any, y: any) => x.numero - y.numero)
            .map((b) => ({ ...b, controles: db.controles.filter((c) => c.bultoId === b.id).map((x) => ({ ...x })) })),
        };
      },
      create: async ({ data }: any) => {
        const fila: Fila = {
          id: nextId(),
          transportistaId: null,
          bultosDeclarados: null,
          pesoTotalDeclarado: null,
          bultosRecibidos: null,
          ubicacionEspera: null,
          ubicacionDestinoBueno: null,
          ubicacionDestinoMalo: null,
          observaciones: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        db.autorizaciones.push(fila);
        return { ...fila };
      },
      update: async ({ where, data }: any) => {
        const a = db.autorizaciones.find((x) => x.id === where.id);
        if (!a) throw new Error('autorización inexistente');
        Object.assign(a, data);
        return { ...a };
      },
      findMany: async ({ where = {} }: any) =>
        db.autorizaciones
          .filter(
            (a: any) =>
              (where.estado === undefined || a.estado === where.estado) &&
              (where.clienteId === undefined || a.clienteId === where.clienteId),
          )
          .sort((x: any, y: any) => y.id - x.id)
          .map((x) => ({ ...x })),
    },
    devDeclaracion: {
      deleteMany: async ({ where }: any) => {
        db.declaraciones = db.declaraciones.filter((d) => d.autorizacionId !== where.autorizacionId);
      },
      createMany: async ({ data }: any) => {
        for (const d of data) db.declaraciones.push({ id: nextId(), ...d });
      },
      count: async ({ where }: any) =>
        db.declaraciones.filter((d) => d.autorizacionId === where.autorizacionId).length,
      findMany: async ({ where }: any) =>
        db.declaraciones.filter((d) => d.autorizacionId === where.autorizacionId).map((x) => ({ ...x })),
    },
    devBulto: {
      deleteMany: async ({ where }: any) => {
        const ids = db.bultos.filter((b) => b.autorizacionId === where.autorizacionId).map((b) => b.id);
        db.bultos = db.bultos.filter((b) => b.autorizacionId !== where.autorizacionId);
        // onDelete: Cascade del schema
        db.controles = db.controles.filter((c: any) => !ids.includes(c.bultoId));
      },
      createMany: async ({ data }: any) => {
        for (const b of data) db.bultos.push({ id: nextId(), peso: null, ...b });
      },
      findMany: async ({ where, include }: any) =>
        db.bultos
          .filter((b) => b.autorizacionId === where.autorizacionId)
          .sort((x: any, y: any) => x.numero - y.numero)
          .map((b) =>
            include?.controles
              ? { ...b, controles: db.controles.filter((c) => c.bultoId === b.id).map((x) => ({ ...x })) }
              : { ...b },
          ),
      findUnique: async ({ where }: any) => {
        const k = where.autorizacionId_numero;
        const b = db.bultos.find((x: any) => x.autorizacionId === k.autorizacionId && x.numero === k.numero);
        return b ? { ...b } : null;
      },
      update: async ({ where, data }: any) => {
        const b = db.bultos.find((x) => x.id === where.id);
        if (!b) throw new Error('bulto inexistente');
        Object.assign(b, data);
        return { ...b };
      },
    },
    devControl: {
      deleteMany: async ({ where }: any) => {
        db.controles = db.controles.filter((c) => c.bultoId !== where.bultoId);
      },
      createMany: async ({ data }: any) => {
        for (const c of data) db.controles.push({ id: nextId(), ...c });
      },
    },
    cliente: {
      findUnique: async ({ where }: any) => {
        const c = db.clientes.find((x) => x.id === where.id);
        return c ? { ...c } : null;
      },
      findMany: async ({ where }: any) =>
        db.clientes.filter((c) => where.id.in.includes(c.id)).map((x) => ({ ...x })),
    },
    deposito: {
      findFirst: async () => (db.depositos[0] ? { ...db.depositos[0] } : null),
    },
    usuario: {
      findUnique: async ({ where }: any) => {
        const u = [vendedor, deposito, admin].find((x) => x.sub === where.id);
        return u ? { nombre: u.nombre, username: u.nombre.toLowerCase() } : null;
      },
    },
    transportista: {
      findUnique: async ({ where }: any) => {
        const t = db.transportistas.find((x) => x.id === where.id);
        return t ? { ...t } : null;
      },
    },
    producto: {
      findMany: async ({ where }: any) =>
        db.productos.filter((p) => where.id.in.includes(p.id)).map((x) => ({ ...x })),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { prisma, db };
}

// ---- stubs de core ----
const CATALOGO: Record<string, { id: number; titulo: string }> = {
  [ISBN_A]: { id: 1, titulo: 'Libro A' },
  [ISBN_B]: { id: 2, titulo: 'Libro B' },
  [ISBN_C]: { id: 3, titulo: 'Libro C' },
};

function crearServicio() {
  const { prisma, db } = crearFakePrisma();
  const catalogo = {
    resolverPorIsbnOpcional: async (isbn: string) =>
      CATALOGO[isbn] ? { ...CATALOGO[isbn], codigoInterno: `P-${CATALOGO[isbn].id}`, editorial: null, isbn } : null,
  };
  const auditoria = {
    registros: [] as Record<string, unknown>[],
    registrar: async function (r: Record<string, unknown>) {
      this.registros.push(r);
    },
  };
  const eventos = {
    emitidos: [] as Array<[string, any]>,
    emit: function (nombre: string, payload: unknown) {
      this.emitidos.push([nombre, payload]);
    },
  };
  const svc = new AutorizacionService(
    prisma as never,
    catalogo as never,
    auditoria as never,
    eventos as never,
    new TextFreeUbicacionResolverAdapter(),
  );
  return { svc, db, auditoria, eventos };
}

/** Lleva una autorización nueva hasta el estado pedido (camino feliz). */
async function avanzarHasta(ctx: ReturnType<typeof crearServicio>, hasta: DevEstado) {
  const { svc } = ctx;
  const a = await svc.crear(vendedor, { clienteId: 10 });
  if (hasta === DevEstado.A_APROBAR) return a.id;
  await svc.aprobar(vendedor, a.id);
  if (hasta === DevEstado.APROBADO) return a.id;
  await svc.declarar(clienteX, a.id, {
    lineas: [
      { isbn: ISBN_A, cantidad: 2 },
      { isbn: ISBN_B, cantidad: 3 },
      { isbn: ISBN_C, cantidad: 5 },
    ],
    bultosDeclarados: 2,
    pesoTotalDeclarado: 10,
    transportistaId: 5,
  });
  await svc.despachar(clienteX, a.id);
  if (hasta === DevEstado.EN_TRANSITO) return a.id;
  await svc.recibir(deposito, a.id, { bultosRecibidos: 2 });
  if (hasta === DevEstado.ENTREGADO) return a.id;
  await svc.ingreso(deposito, a.id, { ubicacionEspera: 'DEV-01' });
  if (hasta === DevEstado.INGRESO_DEPOSITO) return a.id;
  // ISBN B mezclado en los dos bultos; 1 libro C en mal estado.
  await svc.controlarBulto(deposito, a.id, 1, {
    peso: 6,
    controles: [
      { isbn: ISBN_A, cantidad: 2 },
      { isbn: ISBN_B, cantidad: 1 },
    ],
  });
  await svc.controlarBulto(deposito, a.id, 2, {
    peso: 4,
    controles: [
      { isbn: ISBN_B, cantidad: 2 },
      { isbn: ISBN_C, cantidad: 5, malEstado: 1 },
    ],
  });
  await svc.cerrar(deposito, a.id, {
    ubicacionDestinoBueno: 'A-01',
    ubicacionDestinoMalo: 'DAN-01',
  });
  return a.id;
}

describe('AutorizacionService — máquina de estados', () => {
  it('no permite aprobar dos veces (transición inválida)', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    await expect(ctx.svc.aprobar(vendedor, id)).rejects.toThrow(BadRequestException);
  });

  it('no permite saltear estados (recibir sin despachar)', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    await expect(ctx.svc.recibir(deposito, id, { bultosRecibidos: 2 })).rejects.toThrow(
      /Transición inválida/,
    );
  });

  it('no permite declarar antes de la aprobación', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.A_APROBAR);
    await expect(
      ctx.svc.declarar(clienteX, id, {
        lineas: [{ isbn: ISBN_A, cantidad: 1 }],
        bultosDeclarados: 1,
        pesoTotalDeclarado: 1,
      }),
    ).rejects.toThrow(/Transición inválida/);
  });

  it('no permite despachar sin transportista', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    await ctx.svc.declarar(clienteX, id, {
      lineas: [{ isbn: ISBN_A, cantidad: 1 }],
      bultosDeclarados: 1,
      pesoTotalDeclarado: 2,
      // sin transportistaId
    });
    await expect(ctx.svc.despachar(clienteX, id)).rejects.toThrow(/transportista/);
  });

  it('rechaza transportista inexistente o inactivo', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    const base = { lineas: [{ isbn: ISBN_A, cantidad: 1 }], bultosDeclarados: 1, pesoTotalDeclarado: 2 };
    await expect(
      ctx.svc.declarar(clienteX, id, { ...base, transportistaId: 999 }),
    ).rejects.toThrow(/Transportista/);
    await expect(
      ctx.svc.declarar(clienteX, id, { ...base, transportistaId: 6 }),
    ).rejects.toThrow(/Transportista/);
  });

  it('rechaza ISBN no catalogado al declarar (sin líneas fantasma)', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    await expect(
      ctx.svc.declarar(clienteX, id, {
        lineas: [{ isbn: ISBN_NO_CATALOGADO, cantidad: 1 }],
        bultosDeclarados: 1,
        pesoTotalDeclarado: 1,
        transportistaId: 5,
      }),
    ).rejects.toThrow(/no catalogados/);
  });

  it('bultos recibidos ≠ declarados exige observación (y con observación pasa)', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.EN_TRANSITO);
    await expect(ctx.svc.recibir(deposito, id, { bultosRecibidos: 3 })).rejects.toThrow(
      /observación obligatoria/,
    );
    const a = await ctx.svc.recibir(deposito, id, {
      bultosRecibidos: 3,
      observaciones: 'llegó un bulto de más',
    });
    expect(a.estado).toBe(DevEstado.ENTREGADO);
    expect(a.bultosRecibidos).toBe(3);
  });

  it('no permite cerrar con bultos sin controlar', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await ctx.svc.controlarBulto(deposito, id, 1, {
      peso: 6,
      controles: [{ isbn: ISBN_A, cantidad: 2 }],
    });
    await expect(
      ctx.svc.cerrar(deposito, id, { ubicacionDestinoBueno: 'A-01', ubicacionDestinoMalo: 'DAN-01' }),
    ).rejects.toThrow(/sin controlar/);
  });

  it('diferencia de peso exige observación PROPIA del cierre (una previa no alcanza)', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.EN_TRANSITO);
    // Recepción con observación previa (bultos difieren).
    await ctx.svc.recibir(deposito, id, { bultosRecibidos: 1, observaciones: 'faltó un bulto' });
    await ctx.svc.ingreso(deposito, id, { ubicacionEspera: 'DEV-01' });
    await ctx.svc.controlarBulto(deposito, id, 1, {
      peso: 7, // declarado: 10
      controles: [{ isbn: ISBN_A, cantidad: 2 }],
    });
    await expect(
      ctx.svc.cerrar(deposito, id, { ubicacionDestinoBueno: 'A-01', ubicacionDestinoMalo: 'DAN-01' }),
    ).rejects.toThrow(/observación obligatoria/);
    const r = await ctx.svc.cerrar(deposito, id, {
      ubicacionDestinoBueno: 'A-01',
      ubicacionDestinoMalo: 'DAN-01',
      observaciones: 'peso menor: faltó un bulto',
    });
    expect(r.autorizacion.estado).toBe(DevEstado.PROCESADO);
  });

  it('rechaza ISBN no catalogado en el control', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await expect(
      ctx.svc.controlarBulto(deposito, id, 1, {
        controles: [{ isbn: ISBN_NO_CATALOGADO, cantidad: 1 }],
      }),
    ).rejects.toThrow(/no catalogados/);
  });

  it('mal estado no puede superar la cantidad', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await expect(
      ctx.svc.controlarBulto(deposito, id, 1, {
        controles: [{ isbn: ISBN_A, cantidad: 1, malEstado: 2 }],
      }),
    ).rejects.toThrow(/mal estado/);
  });
});

describe('AutorizacionService — propiedad del cliente', () => {
  it('un cliente NO puede ver el detalle ni la reconciliación de otro', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    await expect(ctx.svc.detalleAutorizado(clienteAjeno, id)).rejects.toThrow(ForbiddenException);
    await expect(ctx.svc.reconciliacionAutorizada(clienteAjeno, id)).rejects.toThrow(
      ForbiddenException,
    );
    // El dueño y los usuarios internos sí.
    await expect(ctx.svc.detalleAutorizado(clienteX, id)).resolves.toBeTruthy();
    await expect(ctx.svc.detalleAutorizado(deposito, id)).resolves.toBeTruthy();
  });

  it('un cliente NO puede declarar ni despachar una devolución ajena', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    await expect(
      ctx.svc.declarar(clienteAjeno, id, {
        lineas: [{ isbn: ISBN_A, cantidad: 1 }],
        bultosDeclarados: 1,
        pesoTotalDeclarado: 1,
        transportistaId: 5,
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(ctx.svc.despachar(clienteAjeno, id)).rejects.toThrow(ForbiddenException);
  });

  it('en el listado, un cliente solo ve lo suyo', async () => {
    const ctx = crearServicio();
    await avanzarHasta(ctx, DevEstado.APROBADO); // cliente 10
    await ctx.svc.crear(vendedor, { clienteId: 11 });
    const deCliente = await ctx.svc.listar(clienteX, {});
    expect(deCliente).toHaveLength(1);
    expect(deCliente.every((a) => a.clienteId === 10)).toBe(true);
    const deInterno = await ctx.svc.listar(vendedor, {});
    expect(deInterno).toHaveLength(2);
    // El listado trae el nombre del cliente para la grilla.
    expect(deInterno[0].cliente?.nombre).toBeDefined();
  });
});

describe('AutorizacionService — circuito completo (criterio de validación)', () => {
  it('Vendedor crea → aprueba → cliente declara 3 ISBN/2 bultos/10kg → despacha → recibe 2 (6+4=10) → ingresa DEV-01 → controla (1 mal estado) → Procesado', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.PROCESADO);

    const detalle = await ctx.svc.detalle(id);
    expect(detalle.estado).toBe(DevEstado.PROCESADO);
    expect(detalle.ubicacionEspera).toBe('DEV-01');
    expect(detalle.ubicacionDestinoBueno).toBe('A-01');
    expect(detalle.ubicacionDestinoMalo).toBe('DAN-01');
    expect(detalle.transportista?.nombre).toBe('Trans OK');
    expect(detalle.cliente?.nombre).toBe('Cliente X');
    // Títulos resueltos desde el catálogo en el detalle.
    expect(detalle.declaraciones.map((d) => d.titulo).sort()).toEqual([
      'Libro A',
      'Libro B',
      'Libro C',
    ]);

    // Reconciliación por ISBN sobre TODOS los bultos (B estaba mezclado en 2).
    // Orden: por ISBN ascendente (C < A < B numéricamente).
    const rec = await ctx.svc.calcularReconciliacion(id);
    expect(rec).toEqual([
      { isbn: ISBN_C, productoId: 3, titulo: 'Libro C', declarado: 5, recibido: 5, bueno: 4, malo: 1 },
      { isbn: ISBN_A, productoId: 1, titulo: 'Libro A', declarado: 2, recibido: 2, bueno: 2, malo: 0 },
      { isbn: ISBN_B, productoId: 2, titulo: 'Libro B', declarado: 3, recibido: 3, bueno: 3, malo: 0 },
    ]);

    // Eventos: 5 transiciones + devolucion.procesada con la reconciliación.
    const cambios = ctx.eventos.emitidos.filter(([n]) => n === DEVOLUCION_ESTADO_CAMBIADO);
    expect(cambios.map(([, e]) => e.estadoNuevo)).toEqual([
      DevEstado.APROBADO,
      DevEstado.EN_TRANSITO,
      DevEstado.ENTREGADO,
      DevEstado.INGRESO_DEPOSITO,
      DevEstado.PROCESADO,
    ]);
    const procesada = ctx.eventos.emitidos.filter(([n]) => n === DEVOLUCION_PROCESADA);
    expect(procesada).toHaveLength(1);
    expect(procesada[0][1].reconciliacion).toHaveLength(3);
    expect(procesada[0][1].ubicacionDestinoBueno).toBe('A-01');

    // Auditoría: creación + 5 cambios de estado + 2 controles de bulto.
    const acciones = ctx.auditoria.registros.map((r) => r.accion);
    expect(acciones.filter((a) => a === 'cambio_estado')).toHaveLength(5);
    expect(acciones.filter((a) => a === 'controlar_bulto')).toHaveLength(2);
    expect(acciones).toContain('crear');
  });
});

describe('AutorizacionService — corrección post-Procesado', () => {
  it('solo opera sobre devoluciones Procesadas', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await expect(
      ctx.svc.corregirControl(admin, id, 1, { controles: [{ isbn: ISBN_A, cantidad: 1 }] }),
    ).rejects.toThrow(/Transición inválida/);
  });

  it('reemplaza el control, queda en auditoría y re-emite devolucion.procesada con correccion=true', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.PROCESADO);

    const r = await ctx.svc.corregirControl(admin, id, 2, {
      peso: 4,
      observaciones: 'error de tipeo: eran 2 en mal estado',
      controles: [
        { isbn: ISBN_B, cantidad: 2 },
        { isbn: ISBN_C, cantidad: 5, malEstado: 2 },
      ],
    });

    const lineaC = r.reconciliacion.find((l) => l.isbn === ISBN_C);
    expect(lineaC).toMatchObject({ recibido: 5, bueno: 3, malo: 2 });
    // Sigue Procesado: no se reabre.
    expect(r.autorizacion.estado).toBe(DevEstado.PROCESADO);
    expect(r.autorizacion.observaciones).toContain('Corrección bulto 2');

    const correcciones = ctx.auditoria.registros.filter((x) => x.accion === 'correccion_control');
    expect(correcciones).toHaveLength(1);

    const procesadas = ctx.eventos.emitidos.filter(([n]) => n === DEVOLUCION_PROCESADA);
    expect(procesadas).toHaveLength(2);
    expect(procesadas[1][1].correccion).toBe(true);
  });
});
