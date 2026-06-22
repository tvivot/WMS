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
    excepciones: [] as Fila[],
    clientes: [
      { id: 10, nroCliente: 'C-10', nombre: 'Cliente X', activo: true, depositoId: null },
      { id: 11, nroCliente: 'C-11', nombre: 'Otro Cliente', activo: true, depositoId: null },
    ] as Fila[],
    depositos: [{ id: 1, nombre: 'Depósito Principal' }] as Fila[],
    motivos: [
      { id: 1, modulo: 'devoluciones', nombre: 'Otro', requiereObservacion: true, activo: true },
      { id: 2, modulo: 'devoluciones', nombre: 'Solicitado por la editorial', requiereObservacion: false, activo: true },
      { id: 3, modulo: 'devoluciones', nombre: 'Solicitado por el cliente', requiereObservacion: false, activo: true },
      { id: 4, modulo: 'devoluciones', nombre: 'Traspaso Virtual', requiereObservacion: false, activo: true },
    ] as Fila[],
    transportistas: [
      { id: 5, nombre: 'Trans OK', activo: true },
      { id: 6, nombre: 'Trans Baja', activo: false },
    ] as Fila[],
    productos: [
      { id: 1, titulo: 'Libro A', editorial: 'Ed A', imagenUrl: '/u/a.webp' },
      { id: 2, titulo: 'Libro B', editorial: null, imagenUrl: null },
      { id: 3, titulo: 'Libro C', editorial: 'Ed C', imagenUrl: null },
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
          excepciones: include.excepciones
            ? db.excepciones.filter((e) => e.autorizacionId === a.id).map((x) => ({ ...x }))
            : undefined,
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
        db.declaraciones
          .filter((d: any) =>
            where.autorizacionId?.in
              ? where.autorizacionId.in.includes(d.autorizacionId)
              : d.autorizacionId === where.autorizacionId,
          )
          .map((x) => ({ ...x })),
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
    devExcepcionConsignacion: {
      findMany: async ({ where = {} }: any) =>
        db.excepciones
          .filter(
            (e: any) =>
              (where.autorizacionId === undefined || e.autorizacionId === where.autorizacionId) &&
              (where.estado === undefined || e.estado === where.estado) &&
              (where.isbn?.in === undefined || where.isbn.in.includes(e.isbn)),
          )
          .sort((x: any, y: any) => x.id - y.id)
          .map((x) => ({ ...x })),
      findFirst: async ({ where = {} }: any) => {
        const matchEstado = (estado: any, filtro: any) =>
          filtro === undefined || (filtro?.in ? filtro.in.includes(estado) : estado === filtro);
        const e = db.excepciones.find(
          (x: any) =>
            (where.autorizacionId === undefined || x.autorizacionId === where.autorizacionId) &&
            (where.isbn === undefined || x.isbn === where.isbn) &&
            matchEstado(x.estado, where.estado),
        );
        return e ? { ...e } : null;
      },
      findUnique: async ({ where }: any) => {
        const e = db.excepciones.find((x) => x.id === where.id);
        return e ? { ...e } : null;
      },
      create: async ({ data }: any) => {
        const fila: Fila = {
          id: nextId(),
          productoId: null,
          motivoSolicitud: null,
          resueltoPorId: null,
          resueltoEn: null,
          motivoResolucion: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        db.excepciones.push(fila);
        return { ...fila };
      },
      update: async ({ where, data }: any) => {
        const e = db.excepciones.find((x) => x.id === where.id);
        if (!e) throw new Error('excepción inexistente');
        Object.assign(e, data);
        return { ...e };
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
    motivo: {
      findFirst: async ({ where }: any) =>
        db.motivos.find(
          (m: any) =>
            m.id === where.id &&
            (where.modulo === undefined || m.modulo === where.modulo) &&
            (where.activo === undefined || m.activo === where.activo),
        ) ?? null,
      findUnique: async ({ where }: any) => {
        const m = db.motivos.find((x) => x.id === where.id);
        return m ? { id: m.id, nombre: m.nombre } : null;
      },
      findMany: async ({ where }: any) =>
        db.motivos
          .filter((m) => (where?.id?.in ? where.id.in.includes(m.id) : true))
          .map((m) => ({ id: m.id, nombre: m.nombre })),
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
      findMany: async ({ where }: any) =>
        db.transportistas.filter((t) => where.id.in.includes(t.id)).map((x) => ({ ...x })),
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
  const resolverUno = (isbn: string) =>
    CATALOGO[isbn] ? { ...CATALOGO[isbn], codigoInterno: `P-${CATALOGO[isbn].id}`, editorial: null, imagenUrl: null, isbn } : null;
  const catalogo = {
    resolverPorIsbnOpcional: async (isbn: string) => resolverUno(isbn),
    resolverPorIsbnBatch: async (isbns: string[]) => {
      const m = new Map<string, ReturnType<typeof resolverUno>>();
      for (const isbn of isbns) {
        const p = resolverUno(isbn);
        if (p) m.set(isbn, p);
      }
      return m;
    },
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
  // Fake del puerto de consignación (espejo del UbicacionResolver falso): mapa
  // en memoria clienteId|isbn → cantidad. Se siembra con consignacion.set().
  const consignacion = {
    saldos: new Map<string, number>(),
    set(clienteId: number, isbn: string, cantidad: number) {
      this.saldos.set(`${clienteId}|${isbn}`, cantidad);
    },
    async cargarSaldos() {
      return { recibidos: 0, clientes: 0, upserts: 0, clientesDesconocidos: [], errores: [] };
    },
    async saldosDe(clienteId: number, isbns: string[]) {
      const m = new Map<string, number>();
      for (const isbn of isbns) {
        const v = this.saldos.get(`${clienteId}|${isbn}`);
        if (v !== undefined) m.set(isbn, v);
      }
      return m;
    },
  };
  const svc = new AutorizacionService(
    prisma as never,
    catalogo as never,
    auditoria as never,
    eventos as never,
    new TextFreeUbicacionResolverAdapter(),
    consignacion as never,
  );
  return { svc, db, auditoria, eventos, consignacion };
}

/** Lleva una autorización nueva hasta el estado pedido (camino feliz). */
async function avanzarHasta(ctx: ReturnType<typeof crearServicio>, hasta: DevEstado) {
  const { svc } = ctx;
  const a = await svc.crear(vendedor, { clienteId: 10, motivoId: 2, cantidadUnidades: 5 });
  if (hasta === DevEstado.A_APROBAR) return a.id;
  await svc.aprobar(vendedor, a.id);
  if (hasta === DevEstado.APROBADO) return a.id;
  // Consignación del cliente: el cliente solo puede declarar lo que tiene en
  // consignación. Sembramos exactamente lo que declara el camino feliz.
  ctx.consignacion.set(10, ISBN_A, 2);
  ctx.consignacion.set(10, ISBN_B, 3);
  ctx.consignacion.set(10, ISBN_C, 5);
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

describe('AutorizacionService — creación: motivo + cantidad de unidades', () => {
  it('crea con motivo y cantidad, persistiéndolos', async () => {
    const ctx = crearServicio();
    const a = await ctx.svc.crear(vendedor, { clienteId: 10, motivoId: 2, cantidadUnidades: 7 });
    const det = await ctx.svc.detalle(a.id);
    expect(det.motivo).toEqual({ id: 2, nombre: 'Solicitado por la editorial' });
    expect(det.cantidadUnidades).toBe(7);
  });

  it('rechaza un motivo inexistente o de otro módulo', async () => {
    const ctx = crearServicio();
    await expect(
      ctx.svc.crear(vendedor, { clienteId: 10, motivoId: 999, cantidadUnidades: 1 }),
    ).rejects.toThrow(/Motivo inexistente/);
  });

  it('"Otro" exige observación: la rechaza si falta y la acepta si está', async () => {
    const ctx = crearServicio();
    await expect(
      ctx.svc.crear(vendedor, { clienteId: 10, motivoId: 1, cantidadUnidades: 1 }),
    ).rejects.toThrow(/exige cargar una observación/);
    const a = await ctx.svc.crear(vendedor, {
      clienteId: 10,
      motivoId: 1,
      cantidadUnidades: 1,
      observaciones: 'Devolución especial',
    });
    const det = await ctx.svc.detalle(a.id);
    expect(det.motivo?.id).toBe(1);
    expect(det.observaciones).toBe('Devolución especial');
  });
});

describe('AutorizacionService — borrador (guardar parcial) y despacho', () => {
  it('guarda un borrador con solo líneas (sin bultos/peso/transportista)', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    ctx.consignacion.set(10, ISBN_A, 2);
    const det = await ctx.svc.declarar(clienteX, id, {
      lineas: [{ isbn: ISBN_A, cantidad: 2 }],
    });
    expect(det.declaraciones).toHaveLength(1);
    expect(det.bultosDeclarados).toBeNull();
    expect(det.pesoTotalDeclarado).toBeNull();
    expect(det.transportistaId).toBeNull();
  });

  it('merge: guardar solo líneas NO pisa bultos/peso/transportista ya cargados', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    ctx.consignacion.set(10, ISBN_A, 5);
    // 1) Guardado completo.
    await ctx.svc.declarar(clienteX, id, {
      lineas: [{ isbn: ISBN_A, cantidad: 2 }],
      bultosDeclarados: 3,
      pesoTotalDeclarado: 12,
      transportistaId: 5,
    });
    // 2) Guardado parcial: SOLO líneas (sin bultos/peso/transportista).
    const det = await ctx.svc.declarar(clienteX, id, {
      lineas: [{ isbn: ISBN_A, cantidad: 4 }],
    });
    expect(det.declaraciones[0].cantidad).toBe(4); // las líneas sí se reemplazan
    expect(det.bultosDeclarados).toBe(3); // lo omitido se preserva
    expect(Number(det.pesoTotalDeclarado)).toBe(12);
    expect(det.transportistaId).toBe(5);
  });

  it('merge: guardar solo bultos/peso NO borra las líneas ya cargadas', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    ctx.consignacion.set(10, ISBN_A, 5);
    await ctx.svc.declarar(clienteX, id, { lineas: [{ isbn: ISBN_A, cantidad: 2 }] });
    // No mando lineas: no se deben tocar.
    const det = await ctx.svc.declarar(clienteX, id, { bultosDeclarados: 2, pesoTotalDeclarado: 5 });
    expect(det.declaraciones).toHaveLength(1);
    expect(det.declaraciones[0].cantidad).toBe(2);
    expect(det.bultosDeclarados).toBe(2);
  });

  it('no despacha un borrador incompleto (faltan bultos/peso/transportista)', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    ctx.consignacion.set(10, ISBN_A, 2);
    await ctx.svc.declarar(clienteX, id, { lineas: [{ isbn: ISBN_A, cantidad: 2 }] });
    await expect(ctx.svc.despachar(clienteX, id)).rejects.toThrow(/Faltan datos/);
  });

  it('permite guardar varias veces y despachar al completar', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.APROBADO);
    ctx.consignacion.set(10, ISBN_A, 5);
    // 1ª pasada: solo líneas
    await ctx.svc.declarar(clienteX, id, { lineas: [{ isbn: ISBN_A, cantidad: 2 }] });
    // 2ª pasada: ajusta líneas + completa bultos/peso/transportista (reemplazo)
    const det = await ctx.svc.declarar(clienteX, id, {
      lineas: [{ isbn: ISBN_A, cantidad: 3 }],
      bultosDeclarados: 1,
      pesoTotalDeclarado: 4,
      transportistaId: 5,
    });
    expect(det.declaraciones).toHaveLength(1);
    expect(det.declaraciones[0].cantidad).toBe(3);
    const desp = await ctx.svc.despachar(clienteX, id);
    expect(desp.estado).toBe(DevEstado.EN_TRANSITO);
  });
});

describe('AutorizacionService — export a Excel', () => {
  it('genera un .xlsx (firma ZIP PK) con las devoluciones del cliente', async () => {
    const ctx = crearServicio();
    await avanzarHasta(ctx, DevEstado.EN_TRANSITO); // una devolución con líneas + transportista
    const buf = await ctx.svc.exportarExcel(clienteX, {});
    expect(Buffer.isBuffer(buf)).toBe(true);
    // .xlsx es un ZIP: empieza con "PK\x03\x04".
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(buf.length).toBeGreaterThan(0);
  });

  it('un cliente solo exporta lo suyo (no ve lo de otro cliente)', async () => {
    const ctx = crearServicio();
    await avanzarHasta(ctx, DevEstado.EN_TRANSITO); // del cliente 10
    // Export desde el cliente ajeno (11): no debe fallar y no incluye datos del 10.
    const buf = await ctx.svc.exportarExcel(clienteAjeno, {});
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

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
    ctx.consignacion.set(10, ISBN_A, 5);
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
    ctx.consignacion.set(10, ISBN_A, 5);
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

  it('las ubicaciones son informativas: se ingresa y se procesa sin cargarlas', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.ENTREGADO);
    // Ingreso SIN ubicación de espera.
    const ing = await ctx.svc.ingreso(deposito, id, {});
    expect(ing.estado).toBe(DevEstado.INGRESO_DEPOSITO);
    expect(ing.ubicacionEspera).toBeNull();
    await ctx.svc.controlarBulto(deposito, id, 1, {
      peso: 6,
      controles: [
        { isbn: ISBN_A, cantidad: 2 },
        { isbn: ISBN_B, cantidad: 1 },
      ],
    });
    await ctx.svc.controlarBulto(deposito, id, 2, {
      peso: 4,
      controles: [
        { isbn: ISBN_B, cantidad: 2 },
        { isbn: ISBN_C, cantidad: 5 },
      ],
    });
    // Cierre SIN ubicaciones destino.
    const r = await ctx.svc.cerrar(deposito, id, {});
    expect(r.autorizacion.estado).toBe(DevEstado.PROCESADO);
    expect(r.autorizacion.ubicacionDestinoBueno).toBeNull();
    expect(r.autorizacion.ubicacionDestinoMalo).toBeNull();
  });

  it('una ubicación cargada se guarda (recortada); en blanco queda null', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await ctx.svc.controlarBulto(deposito, id, 1, {
      peso: 6,
      controles: [{ isbn: ISBN_A, cantidad: 2 }, { isbn: ISBN_B, cantidad: 1 }],
    });
    await ctx.svc.controlarBulto(deposito, id, 2, {
      peso: 4,
      controles: [{ isbn: ISBN_B, cantidad: 2 }, { isbn: ISBN_C, cantidad: 5 }],
    });
    // Buenos: se carga (con espacios → se recorta). Malos: en blanco → null.
    const r = await ctx.svc.cerrar(deposito, id, {
      ubicacionDestinoBueno: '  A-01  ',
      ubicacionDestinoMalo: '   ',
    });
    expect(r.autorizacion.ubicacionDestinoBueno).toBe('A-01');
    expect(r.autorizacion.ubicacionDestinoMalo).toBeNull();
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
    await ctx.svc.crear(vendedor, { clienteId: 11, motivoId: 2, cantidadUnidades: 3 });
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
    const rec = await ctx.svc.calcularReconciliacion(id, 10);
    expect(rec).toEqual([
      { isbn: ISBN_C, productoId: 3, titulo: 'Libro C', declarado: 5, recibido: 5, bueno: 4, malo: 1, saldoConsignacion: 5, excedeConsignacion: false },
      { isbn: ISBN_A, productoId: 1, titulo: 'Libro A', declarado: 2, recibido: 2, bueno: 2, malo: 0, saldoConsignacion: 2, excedeConsignacion: false },
      { isbn: ISBN_B, productoId: 2, titulo: 'Libro B', declarado: 3, recibido: 3, bueno: 3, malo: 0, saldoConsignacion: 3, excedeConsignacion: false },
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

describe('AutorizacionService — saldo en consignación', () => {
  // Controla los 2 bultos (mismo reparto que el circuito feliz): recibido por
  // ISBN → A=2, B=3, C=5 (1 de C en mal estado).
  async function controlarAmbos(ctx: ReturnType<typeof crearServicio>, id: number) {
    await ctx.svc.controlarBulto(deposito, id, 1, {
      peso: 6,
      controles: [
        { isbn: ISBN_A, cantidad: 2 },
        { isbn: ISBN_B, cantidad: 1 },
      ],
    });
    await ctx.svc.controlarBulto(deposito, id, 2, {
      peso: 4,
      controles: [
        { isbn: ISBN_B, cantidad: 2 },
        { isbn: ISBN_C, cantidad: 5, malEstado: 1 },
      ],
    });
  }

  it('la reconciliación trae el saldo y marca el exceso por ISBN', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await controlarAmbos(ctx, id);
    // avanzarHasta dejó A=2, B=3, C=5; sobreescribimos para forzar el exceso.
    ctx.consignacion.set(10, ISBN_A, 5); // recibido 2 < 5 → no excede
    ctx.consignacion.set(10, ISBN_C, 3); // recibido 5 > 3 → excede

    const rec = await ctx.svc.calcularReconciliacion(id, 10);
    const a = rec.find((l) => l.isbn === ISBN_A)!;
    const b = rec.find((l) => l.isbn === ISBN_B)!;
    const c = rec.find((l) => l.isbn === ISBN_C)!;
    expect(a).toMatchObject({ saldoConsignacion: 5, excedeConsignacion: false });
    expect(b).toMatchObject({ saldoConsignacion: 3, excedeConsignacion: false }); // recibido 3 == 3
    expect(c).toMatchObject({ saldoConsignacion: 3, excedeConsignacion: true });
  });

  it('cerrar con exceso NO bloquea pero exige observación', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await controlarAmbos(ctx, id);
    ctx.consignacion.set(10, ISBN_A, 1); // recibido 2 > 1 → excede

    await expect(
      ctx.svc.cerrar(deposito, id, { ubicacionDestinoBueno: 'A-01', ubicacionDestinoMalo: 'DAN-01' }),
    ).rejects.toThrow(BadRequestException);

    const r = await ctx.svc.cerrar(deposito, id, {
      ubicacionDestinoBueno: 'A-01',
      ubicacionDestinoMalo: 'DAN-01',
      observaciones: 'cliente devolvió más de lo que tenía en consignación',
    });
    expect(r.autorizacion.estado).toBe(DevEstado.PROCESADO);
    const procesada = ctx.eventos.emitidos.find(([n]) => n === DEVOLUCION_PROCESADA);
    expect(procesada![1].reconciliacion.find((l: any) => l.isbn === ISBN_A).excedeConsignacion).toBe(true);
  });

  it('recibido dentro del saldo no marca exceso ni bloquea el cierre', async () => {
    const ctx = crearServicio();
    const id = await avanzarHasta(ctx, DevEstado.INGRESO_DEPOSITO);
    await controlarAmbos(ctx, id);
    // Saldo sembrado por avanzarHasta == recibido (A=2, B=3, C=5): nadie excede.
    const r = await ctx.svc.cerrar(deposito, id, {
      ubicacionDestinoBueno: 'A-01',
      ubicacionDestinoMalo: 'DAN-01',
    });
    expect(r.autorizacion.estado).toBe(DevEstado.PROCESADO);
    expect(r.reconciliacion.every((l) => !l.excedeConsignacion)).toBe(true);
  });
});

describe('AutorizacionService — regla de consignación al declarar + excepciones', () => {
  // Nota: el permiso devolucion.autorizar_excepcion se valida en el controller
  // (@RequierePermiso), no en el servicio; acá se prueba la lógica.
  async function aprobada(ctx: ReturnType<typeof crearServicio>) {
    const a = await ctx.svc.crear(vendedor, { clienteId: 10, motivoId: 2, cantidadUnidades: 5 });
    await ctx.svc.aprobar(vendedor, a.id);
    return a.id;
  }
  const carga = (lineas: { isbn: string; cantidad: number }[]) => ({
    lineas,
    bultosDeclarados: 1,
    pesoTotalDeclarado: 5,
    transportistaId: 5,
  });

  it('bloquea declarar un libro que NO está en la consignación', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    ctx.consignacion.set(10, ISBN_A, 5); // solo A en consignación
    await expect(
      ctx.svc.declarar(clienteX, id, carga([
        { isbn: ISBN_A, cantidad: 2 },
        { isbn: ISBN_B, cantidad: 1 }, // fuera de consignación
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('bloquea declarar MÁS unidades de las consignadas', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    ctx.consignacion.set(10, ISBN_A, 2);
    await expect(
      ctx.svc.declarar(clienteX, id, carga([{ isbn: ISBN_A, cantidad: 3 }])),
    ).rejects.toThrow(BadRequestException);
    // Hasta el saldo, sí deja.
    const det = await ctx.svc.declarar(clienteX, id, carga([{ isbn: ISBN_A, cantidad: 2 }]));
    expect(det.declaraciones).toHaveLength(1);
  });

  it('solicitud + aprobación habilita declarar el libro fuera de lista', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    ctx.consignacion.set(10, ISBN_A, 5);

    const d1 = await ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 1, motivo: 'devolución especial' });
    expect(d1.excepciones).toHaveLength(1);
    expect(d1.excepciones[0].estado).toBe('PENDIENTE');

    // Mientras está pendiente, sigue bloqueado.
    await expect(
      ctx.svc.declarar(clienteX, id, carga([{ isbn: ISBN_A, cantidad: 5 }, { isbn: ISBN_B, cantidad: 1 }])),
    ).rejects.toThrow(BadRequestException);

    // Gerencia aprueba.
    const exc = d1.excepciones[0];
    const d2 = await ctx.svc.resolverExcepcion(admin, id, exc.id, { aprobar: true });
    expect(d2.excepciones[0].estado).toBe('APROBADA');

    // Ahora sí se puede declarar B.
    const det = await ctx.svc.declarar(clienteX, id, carga([
      { isbn: ISBN_A, cantidad: 5 },
      { isbn: ISBN_B, cantidad: 1 },
    ]));
    expect(det.declaraciones.map((l) => l.isbn).sort()).toEqual([ISBN_A, ISBN_B].sort());
  });

  it('rechazar la excepción deja el libro bloqueado', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    const d1 = await ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 1 });
    await ctx.svc.resolverExcepcion(admin, id, d1.excepciones[0].id, { aprobar: false, motivo: 'no corresponde' });
    await expect(
      ctx.svc.declarar(clienteX, id, carga([{ isbn: ISBN_B, cantidad: 1 }])),
    ).rejects.toThrow(BadRequestException);
  });

  it('el aprobador puede ajustar la cantidad autorizada', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    const d1 = await ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 5 });
    await ctx.svc.resolverExcepcion(admin, id, d1.excepciones[0].id, { aprobar: true, cantidad: 2 });
    // Permitido = 0 (saldo) + 2 (excepción) = 2.
    await expect(
      ctx.svc.declarar(clienteX, id, carga([{ isbn: ISBN_B, cantidad: 3 }])),
    ).rejects.toThrow(BadRequestException);
    const det = await ctx.svc.declarar(clienteX, id, carga([{ isbn: ISBN_B, cantidad: 2 }]));
    expect(det.declaraciones).toHaveLength(1);
  });

  it('no permite dos solicitudes pendientes para el mismo ISBN', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    await ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 1 });
    await expect(
      ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('no permite re-solicitar un ISBN que ya tiene excepción APROBADA (evita apilar)', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    const d1 = await ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 1 });
    await ctx.svc.resolverExcepcion(admin, id, d1.excepciones[0].id, { aprobar: true });
    await expect(
      ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lista las excepciones pendientes para los aprobadores', async () => {
    const ctx = crearServicio();
    const id = await aprobada(ctx);
    await ctx.svc.solicitarExcepcion(clienteX, id, { isbn: ISBN_B, cantidad: 1 });
    const pend = await ctx.svc.excepcionesPendientes();
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ autorizacionId: id, isbn: ISBN_B, titulo: 'Libro B' });
    expect(pend[0].cliente).toMatchObject({ nroCliente: 'C-10' });
  });
});
