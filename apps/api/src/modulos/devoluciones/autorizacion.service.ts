import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DevEstado, DevEstadoControl } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaService } from '../../core/auditoria/auditoria.service';
import { CatalogoService } from '../../core/catalogo/catalogo.service';
import { normalizarIsbn } from '../../core/catalogo/isbn.util';
import type { JwtPayload } from '../../core/auth/jwt-payload';
import {
  CerrarDto,
  ControlarBultoDto,
  CorregirControlDto,
  CrearAutorizacionDto,
  DeclararDto,
  IngresoDto,
  LineaControlDto,
  RecibirDto,
} from './dto';
import {
  DEVOLUCION_ESTADO_CAMBIADO,
  DEVOLUCION_PROCESADA,
  type DevolucionEstadoCambiadoEvent,
  type DevolucionProcesadaEvent,
  type ReconciliacionLinea,
} from './eventos/eventos';
import {
  UBICACION_RESOLVER,
  type TipoUbicacion,
  type UbicacionResolverPort,
} from './puertos/ubicacion-resolver.port';
import {
  CONSIGNACION_PORT,
  type ConsignacionPort,
} from './puertos/consignacion.port';

const PESO_TOLERANCIA = 0.001;

@Injectable()
export class AutorizacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
    private readonly auditoria: AuditoriaService,
    private readonly eventos: EventEmitter2,
    @Inject(UBICACION_RESOLVER)
    private readonly ubicaciones: UbicacionResolverPort,
    @Inject(CONSIGNACION_PORT)
    private readonly consignacion: ConsignacionPort,
  ) {}

  // ---- helpers ----

  private async obtenerOr404(id: number) {
    const a = await this.prisma.devAutorizacion.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Autorización no encontrada');
    return a;
  }

  private verificarPropiedad(actor: JwtPayload, clienteId: number): void {
    if (actor.tipo === 'cliente' && actor.sub !== clienteId) {
      throw new ForbiddenException('No es tu autorización');
    }
  }

  /** Acumula observaciones de cada etapa sin pisar las anteriores. */
  private acumularObservacion(
    previa: string | null,
    etapa: string,
    nueva?: string,
  ): string | null {
    if (!nueva) return previa;
    const etiquetada = `${etapa}: ${nueva}`;
    return previa ? `${previa} | ${etiquetada}` : etiquetada;
  }

  private exigirEstado(actual: DevEstado, esperado: DevEstado): void {
    if (actual !== esperado) {
      throw new BadRequestException(
        `Transición inválida: estado actual ${actual}, se esperaba ${esperado}`,
      );
    }
  }

  private async transicionar(
    id: number,
    actor: JwtPayload,
    estadoAnterior: DevEstado,
    estadoNuevo: DevEstado,
    extra: Record<string, unknown> = {},
  ) {
    const actualizada = await this.prisma.devAutorizacion.update({
      where: { id },
      data: { estado: estadoNuevo, ...extra },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'cambio_estado',
      entidad: 'dev_autorizacion',
      entidadId: String(id),
      estadoAnterior,
      estadoNuevo,
    });
    const ev: DevolucionEstadoCambiadoEvent = {
      autorizacionId: id,
      estadoAnterior,
      estadoNuevo,
      actorId: actor.sub,
      actorTipo: actor.tipo,
      ts: new Date().toISOString(),
    };
    this.eventos.emit(DEVOLUCION_ESTADO_CAMBIADO, ev);
    return actualizada;
  }

  // ---- transiciones ----

  /** A Aprobar: la crea Cliente / Vendedor / Gerencial (permiso solicitud.crear). */
  async crear(actor: JwtPayload, dto: CrearAutorizacionDto) {
    let clienteId: number;
    let depositoId: number;

    if (actor.tipo === 'cliente') {
      clienteId = actor.sub;
      const cli = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cli || !cli.activo) {
        throw new BadRequestException('Cliente inactivo: no puede operar en el WMS');
      }
      depositoId = dto.depositoId ?? cli.depositoId ?? (await this.depositoPorDefecto());
    } else {
      if (!dto.clienteId) {
        throw new BadRequestException('clienteId es requerido para usuarios internos');
      }
      clienteId = dto.clienteId;
      const cli = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cli) throw new BadRequestException('Cliente inexistente');
      if (!cli.activo) {
        throw new BadRequestException('Cliente inactivo: no se pueden crear devoluciones');
      }
      depositoId = dto.depositoId ?? cli.depositoId ?? (await this.depositoPorDefecto());
    }

    const creada = await this.prisma.devAutorizacion.create({
      data: {
        estado: DevEstado.A_APROBAR,
        clienteId,
        depositoId,
        creadoPorId: actor.sub,
        creadoPorTipo: actor.tipo,
        observaciones: dto.observaciones ?? null,
      },
    });
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'crear',
      entidad: 'dev_autorizacion',
      entidadId: String(creada.id),
      estadoNuevo: DevEstado.A_APROBAR,
    });
    return creada;
  }

  private async depositoPorDefecto(): Promise<number> {
    const d = await this.prisma.deposito.findFirst({ orderBy: { id: 'asc' } });
    if (!d) throw new BadRequestException('No hay depósitos configurados');
    return d.id;
  }

  /** Aprobado: permiso solicitud.aprobar. */
  async aprobar(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.A_APROBAR);
    return this.transicionar(id, actor, a.estado, DevEstado.APROBADO);
  }

  /** Carga del cliente: líneas + bultos + peso + transportista (estado APROBADO). */
  async declarar(actor: JwtPayload, id: number, dto: DeclararDto) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);

    // Resolver ISBN→producto; rechazar no catalogados (no líneas fantasma).
    const resueltas: { isbn: string; productoId: number | null; cantidad: number }[] = [];
    const noCatalogados: string[] = [];
    // Resolución en bloque (1 query) en vez de un findUnique por línea (N+1).
    const productos = await this.catalogo.resolverPorIsbnBatch(
      dto.lineas.map((l) => l.isbn),
    );
    for (const linea of dto.lineas) {
      const norm = normalizarIsbn(linea.isbn);
      if (!norm) {
        noCatalogados.push(linea.isbn);
        continue;
      }
      const prod = productos.get(norm);
      if (!prod) {
        noCatalogados.push(linea.isbn);
        continue;
      }
      // Mismo ISBN repetido en el payload (p.ej. ISBN-10 y 13 del mismo título): sumar.
      const ya = resueltas.find((r) => r.isbn === norm);
      if (ya) ya.cantidad += linea.cantidad;
      else resueltas.push({ isbn: norm, productoId: prod.id, cantidad: linea.cantidad });
    }
    if (noCatalogados.length > 0) {
      throw new BadRequestException(
        `ISBN no catalogados (se avisó, no se cargan): ${noCatalogados.join(', ')}`,
      );
    }

    // El transportista declarado debe existir y estar activo.
    if (dto.transportistaId !== undefined && dto.transportistaId !== null) {
      const t = await this.prisma.transportista.findUnique({
        where: { id: dto.transportistaId },
      });
      if (!t || !t.activo) {
        throw new BadRequestException('Transportista inexistente o inactivo');
      }
    }

    await this.prisma.$transaction([
      this.prisma.devDeclaracion.deleteMany({ where: { autorizacionId: id } }),
      this.prisma.devDeclaracion.createMany({
        data: resueltas.map((r) => ({
          autorizacionId: id,
          isbn: r.isbn,
          productoId: r.productoId,
          cantidad: r.cantidad,
        })),
      }),
      this.prisma.devAutorizacion.update({
        where: { id },
        data: {
          bultosDeclarados: dto.bultosDeclarados,
          pesoTotalDeclarado: dto.pesoTotalDeclarado,
          transportistaId: dto.transportistaId ?? null,
        },
      }),
    ]);
    return this.detalle(id);
  }

  /** Despacho: APROBADO → En tránsito. */
  async despachar(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    this.exigirEstado(a.estado, DevEstado.APROBADO);
    const lineas = await this.prisma.devDeclaracion.count({ where: { autorizacionId: id } });
    if (
      lineas === 0 ||
      !a.bultosDeclarados ||
      a.pesoTotalDeclarado === null ||
      a.transportistaId === null
    ) {
      throw new BadRequestException(
        'Faltan datos para despachar: líneas, bultos, peso total y transportista',
      );
    }
    return this.transicionar(id, actor, a.estado, DevEstado.EN_TRANSITO);
  }

  /** Recepción: En tránsito → Entregado (permiso deposito.recibir). */
  async recibir(actor: JwtPayload, id: number, dto: RecibirDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.EN_TRANSITO);
    if (
      a.bultosDeclarados !== null &&
      dto.bultosRecibidos !== a.bultosDeclarados &&
      !dto.observaciones
    ) {
      throw new BadRequestException(
        'Los bultos recibidos difieren de los declarados: observación obligatoria',
      );
    }
    // Crear los bultos a controlar (1..bultosRecibidos).
    await this.prisma.$transaction([
      this.prisma.devBulto.deleteMany({ where: { autorizacionId: id } }),
      this.prisma.devBulto.createMany({
        data: Array.from({ length: dto.bultosRecibidos }, (_, i) => ({
          autorizacionId: id,
          numero: i + 1,
          estadoControl: DevEstadoControl.NO_CONTROLADO,
        })),
      }),
    ]);
    return this.transicionar(id, actor, a.estado, DevEstado.ENTREGADO, {
      bultosRecibidos: dto.bultosRecibidos,
      observaciones: this.acumularObservacion(a.observaciones, 'Recepción', dto.observaciones),
    });
  }

  /**
   * Las ubicaciones son INFORMATIVAS: opcionales al ingresar/cerrar, no bloquean.
   * Si se carga una, se valida por el puerto (así el futuro módulo Ubicaciones
   * sigue mandando y el seam no se rompe); si viene vacía, se guarda null.
   */
  private async ubicacionOpcional(
    codigo: string | undefined,
    tipo: TipoUbicacion,
    etiqueta: string,
  ): Promise<string | null> {
    const limpio = codigo?.trim();
    if (!limpio) return null;
    if (!(await this.ubicaciones.esValidaPara(limpio, tipo))) {
      throw new BadRequestException(`${etiqueta} inválida`);
    }
    return limpio;
  }

  /** Ingreso a depósito: registra ubicación de espera (informativa, vía puerto). */
  async ingreso(actor: JwtPayload, id: number, dto: IngresoDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.ENTREGADO);
    const ubicacionEspera = await this.ubicacionOpcional(
      dto.ubicacionEspera,
      'devoluciones',
      'Ubicación de espera',
    );
    return this.transicionar(id, actor, a.estado, DevEstado.INGRESO_DEPOSITO, {
      ubicacionEspera,
    });
  }

  /**
   * Resuelve y valida las líneas de control de un bulto: ISBN normalizado y
   * catalogado (misma regla que la declaración: avisar, no cargar fantasmas),
   * mal estado ≤ cantidad.
   */
  private async resolverControles(
    bultoId: number,
    controles: LineaControlDto[],
  ): Promise<
    { bultoId: number; isbn: string; productoId: number; cantidad: number; malEstado: number }[]
  > {
    const filas: { bultoId: number; isbn: string; productoId: number; cantidad: number; malEstado: number }[] = [];
    const noCatalogados: string[] = [];
    // Resolución en bloque (1 query) en vez de un findUnique por control (N+1).
    const productos = await this.catalogo.resolverPorIsbnBatch(
      controles.map((c) => c.isbn),
    );
    for (const c of controles) {
      const norm = normalizarIsbn(c.isbn);
      if (!norm) throw new BadRequestException(`ISBN inválido: ${c.isbn}`);
      const malo = c.malEstado ?? 0;
      if (malo > c.cantidad) {
        throw new BadRequestException('mal estado no puede superar la cantidad');
      }
      const prod = productos.get(norm);
      if (!prod) {
        noCatalogados.push(norm);
        continue;
      }
      const ya = filas.find((f) => f.isbn === norm);
      if (ya) {
        ya.cantidad += c.cantidad;
        ya.malEstado += malo;
      } else {
        filas.push({
          bultoId,
          isbn: norm,
          productoId: prod.id,
          cantidad: c.cantidad,
          malEstado: malo,
        });
      }
    }
    if (noCatalogados.length > 0) {
      throw new BadRequestException(
        `ISBN no catalogados (cargalos al catálogo antes de controlar): ${noCatalogados.join(', ')}`,
      );
    }
    return filas;
  }

  /** Control de un bulto: cantidades + mal estado por ISBN (estado INGRESO_DEPOSITO). */
  async controlarBulto(
    actor: JwtPayload,
    id: number,
    numero: number,
    dto: ControlarBultoDto,
  ) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.INGRESO_DEPOSITO);
    const bulto = await this.prisma.devBulto.findUnique({
      where: { autorizacionId_numero: { autorizacionId: id, numero } },
    });
    if (!bulto) throw new NotFoundException('Bulto inexistente');

    const filas = await this.resolverControles(bulto.id, dto.controles);

    await this.prisma.$transaction([
      this.prisma.devControl.deleteMany({ where: { bultoId: bulto.id } }),
      this.prisma.devControl.createMany({ data: filas }),
      this.prisma.devBulto.update({
        where: { id: bulto.id },
        data: {
          peso: dto.peso ?? bulto.peso,
          estadoControl: DevEstadoControl.CONTROLADO,
        },
      }),
    ]);
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'controlar_bulto',
      entidad: 'dev_bulto',
      entidadId: `${id}/${numero}`,
      detalle: { lineas: filas.length },
    });
    return this.detalle(id);
  }

  /** Cierre: reconciliación + destinos + Procesado + evento devolucion.procesada. */
  async cerrar(actor: JwtPayload, id: number, dto: CerrarDto) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.INGRESO_DEPOSITO);

    const bultos = await this.prisma.devBulto.findMany({ where: { autorizacionId: id } });
    if (bultos.length === 0) {
      throw new BadRequestException('No hay bultos para cerrar');
    }
    const sinControlar = bultos.filter(
      (b) => b.estadoControl !== DevEstadoControl.CONTROLADO,
    );
    if (sinControlar.length > 0) {
      throw new BadRequestException(
        `Hay ${sinControlar.length} bulto(s) sin controlar; no se puede procesar`,
      );
    }

    // Ubicaciones destino INFORMATIVAS (opcionales): buenos a picking/pallet,
    // malos a dañados/cuarentena. No bloquean el cierre; si se cargan, se validan.
    const ubicacionDestinoBueno = await this.ubicacionOpcional(
      dto.ubicacionDestinoBueno,
      'picking',
      'Ubicación destino (buenos)',
    );
    const ubicacionDestinoMalo = await this.ubicacionOpcional(
      dto.ubicacionDestinoMalo,
      'dañados',
      'Ubicación destino (malos)',
    );

    // Control de peso: suma de bultos vs peso total declarado (no bloquea, exige observación).
    const sumaPesos = bultos.reduce((acc, b) => acc + (b.peso ? Number(b.peso) : 0), 0);
    const declarado = a.pesoTotalDeclarado ? Number(a.pesoTotalDeclarado) : null;
    // La observación debe ser PROPIA del cierre: una observación previa
    // (p.ej. de la recepción) no justifica la diferencia de peso.
    if (
      declarado !== null &&
      Math.abs(sumaPesos - declarado) > PESO_TOLERANCIA &&
      !dto.observaciones
    ) {
      throw new BadRequestException(
        `Suma de pesos (${sumaPesos}) ≠ peso declarado (${declarado}): observación obligatoria`,
      );
    }

    const reconciliacion = await this.calcularReconciliacion(id, a.clienteId);

    // Exceso de consignación (recibido > saldo del ERP): no bloquea, exige
    // observación propia del cierre (mismo criterio que la diferencia de peso).
    if (reconciliacion.some((l) => l.excedeConsignacion) && !dto.observaciones) {
      const excedidos = reconciliacion
        .filter((l) => l.excedeConsignacion)
        .map((l) => l.isbn)
        .join(', ');
      throw new BadRequestException(
        `Hay devoluciones que exceden el saldo en consignación (${excedidos}): observación obligatoria`,
      );
    }

    const actualizada = await this.transicionar(
      id,
      actor,
      a.estado,
      DevEstado.PROCESADO,
      {
        ubicacionDestinoBueno,
        ubicacionDestinoMalo,
        observaciones: this.acumularObservacion(a.observaciones, 'Cierre', dto.observaciones),
      },
    );

    const ev: DevolucionProcesadaEvent = {
      autorizacionId: id,
      clienteId: a.clienteId,
      depositoId: a.depositoId,
      reconciliacion,
      ubicacionDestinoBueno: ubicacionDestinoBueno ?? undefined,
      ubicacionDestinoMalo: ubicacionDestinoMalo ?? undefined,
      ts: new Date().toISOString(),
    };
    // NO mueve stock: solo registra destino y emite el evento (lo consume Inventario).
    this.eventos.emit(DEVOLUCION_PROCESADA, ev);

    return { autorizacion: actualizada, reconciliacion };
  }

  /**
   * Corrección post-Procesado (permiso devolucion.corregir; por defecto solo
   * Administrador). Una devolución Procesada NO se reabre: la corrección
   * reemplaza el control de un bulto, queda en auditoría y re-emite
   * devolucion.procesada con correccion=true para los consumidores.
   */
  async corregirControl(
    actor: JwtPayload,
    id: number,
    numero: number,
    dto: CorregirControlDto,
  ) {
    const a = await this.obtenerOr404(id);
    this.exigirEstado(a.estado, DevEstado.PROCESADO);
    const bulto = await this.prisma.devBulto.findUnique({
      where: { autorizacionId_numero: { autorizacionId: id, numero } },
    });
    if (!bulto) throw new NotFoundException('Bulto inexistente');

    const filas = await this.resolverControles(bulto.id, dto.controles);

    await this.prisma.$transaction([
      this.prisma.devControl.deleteMany({ where: { bultoId: bulto.id } }),
      this.prisma.devControl.createMany({ data: filas }),
      this.prisma.devBulto.update({
        where: { id: bulto.id },
        data: { peso: dto.peso ?? bulto.peso },
      }),
      this.prisma.devAutorizacion.update({
        where: { id },
        data: {
          observaciones: this.acumularObservacion(
            a.observaciones,
            `Corrección bulto ${numero}`,
            dto.observaciones ?? 'control corregido',
          ),
        },
      }),
    ]);
    await this.auditoria.registrar({
      actorId: actor.sub,
      actorTipo: actor.tipo,
      accion: 'correccion_control',
      entidad: 'dev_bulto',
      entidadId: `${id}/${numero}`,
      detalle: { lineas: filas.length, observaciones: dto.observaciones ?? null },
    });

    const reconciliacion = await this.calcularReconciliacion(id, a.clienteId);
    const ev: DevolucionProcesadaEvent = {
      autorizacionId: id,
      clienteId: a.clienteId,
      depositoId: a.depositoId,
      reconciliacion,
      ubicacionDestinoBueno: a.ubicacionDestinoBueno ?? undefined,
      ubicacionDestinoMalo: a.ubicacionDestinoMalo ?? undefined,
      correccion: true,
      ts: new Date().toISOString(),
    };
    this.eventos.emit(DEVOLUCION_PROCESADA, ev);

    return { autorizacion: await this.detalle(id), reconciliacion };
  }

  // ---- consultas ----

  /** Detalle con control de propiedad: un cliente solo ve lo suyo. */
  async detalleAutorizado(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    return this.detalle(id);
  }

  /** Reconciliación con control de propiedad: un cliente solo ve lo suyo. */
  async reconciliacionAutorizada(actor: JwtPayload, id: number) {
    const a = await this.obtenerOr404(id);
    this.verificarPropiedad(actor, a.clienteId);
    return this.calcularReconciliacion(id, a.clienteId);
  }

  /**
   * Reconciliación declarado vs recibido por ISBN (agrega sobre todos los
   * bultos) + saldo en consignación del cliente. `excedeConsignacion` marca
   * (no bloquea) cuando se recibió más de lo que el cliente tenía en
   * consignación; saldo null = sin dato del ERP (nunca marca exceso).
   */
  async calcularReconciliacion(
    id: number,
    clienteId: number,
  ): Promise<ReconciliacionLinea[]> {
    const [declaraciones, bultos] = await Promise.all([
      this.prisma.devDeclaracion.findMany({ where: { autorizacionId: id } }),
      this.prisma.devBulto.findMany({
        where: { autorizacionId: id },
        include: { controles: true },
      }),
    ]);

    const mapa = new Map<string, ReconciliacionLinea>();
    const get = (isbn: string, productoId: number | null): ReconciliacionLinea => {
      let l = mapa.get(isbn);
      if (!l) {
        l = {
          isbn,
          productoId,
          titulo: null,
          declarado: 0,
          recibido: 0,
          bueno: 0,
          malo: 0,
          saldoConsignacion: null,
          excedeConsignacion: false,
        };
        mapa.set(isbn, l);
      }
      if (l.productoId === null && productoId !== null) l.productoId = productoId;
      return l;
    };

    for (const d of declaraciones) {
      get(d.isbn, d.productoId).declarado += d.cantidad;
    }
    for (const b of bultos) {
      for (const c of b.controles) {
        const l = get(c.isbn, c.productoId);
        l.recibido += c.cantidad;
        l.malo += c.malEstado;
        l.bueno += c.cantidad - c.malEstado;
      }
    }
    const lineas = [...mapa.values()].sort((a, b) => a.isbn.localeCompare(b.isbn));

    // Saldo en consignación por ISBN (lookup batch, sin N+1). Ausencia de dato
    // → null y nunca marca exceso.
    const saldos = await this.consignacion.saldosDe(
      clienteId,
      lineas.map((l) => l.isbn),
    );
    for (const l of lineas) {
      const saldo = saldos.get(l.isbn);
      l.saldoConsignacion = saldo ?? null;
      l.excedeConsignacion = saldo !== undefined && l.recibido > saldo;
    }

    // Título desde el catálogo (referencia por ID, sin FK).
    const info = await this.infoPorProducto(
      lineas.map((l) => l.productoId).filter((x): x is number => x !== null),
    );
    for (const l of lineas) {
      l.titulo = l.productoId !== null ? (info.get(l.productoId)?.titulo ?? null) : null;
    }
    return lineas;
  }

  /**
   * Info de catálogo por productoId (referencia por ID, sin FK cruzada): título,
   * editorial e imagen. La imagen + editorial alimentan la miniatura y el popup
   * de producto en el front al reabrir una devolución ya cargada.
   */
  private async infoPorProducto(
    ids: number[],
  ): Promise<Map<number, { titulo: string; editorial: string | null; imagenUrl: string | null }>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return new Map();
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: unicos } },
      select: { id: true, titulo: true, editorial: true, imagenUrl: true },
    });
    return new Map(
      productos.map((p) => [p.id, { titulo: p.titulo, editorial: p.editorial, imagenUrl: p.imagenUrl }]),
    );
  }

  async listar(actor: JwtPayload, params: { estado?: DevEstado; clienteId?: number }) {
    const where: { estado?: DevEstado; clienteId?: number } = {};
    if (params.estado) where.estado = params.estado;
    // Cliente: solo ve lo suyo.
    if (actor.tipo === 'cliente') where.clienteId = actor.sub;
    else if (params.clienteId) where.clienteId = params.clienteId;
    const items = await this.prisma.devAutorizacion.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 1000, // guardarraíl: la grilla muestra las más recientes (índices estado/clienteId)
    });
    // Nombre del cliente para la grilla (referencia por ID, sin FK).
    const ids = [...new Set(items.map((i) => i.clienteId))];
    const clientes = ids.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: ids } },
          select: { id: true, nroCliente: true, nombre: true },
        })
      : [];
    const mapa = new Map(clientes.map((c) => [c.id, c]));
    return items.map((i) => ({ ...i, cliente: mapa.get(i.clienteId) ?? null }));
  }

  async detalle(id: number) {
    const a = await this.prisma.devAutorizacion.findUnique({
      where: { id },
      include: {
        declaraciones: true,
        bultos: { include: { controles: true }, orderBy: { numero: 'asc' } },
      },
    });
    if (!a) throw new NotFoundException('Autorización no encontrada');

    // Datos del núcleo resueltos por ID (sin FK): títulos, cliente, transportista.
    const info = await this.infoPorProducto([
      ...a.declaraciones.map((d) => d.productoId).filter((x): x is number => x !== null),
      ...a.bultos.flatMap((b) =>
        b.controles.map((c) => c.productoId).filter((x): x is number => x !== null),
      ),
    ]);
    const [cliente, transportista, creadoPor] = await Promise.all([
      this.prisma.cliente.findUnique({
        where: { id: a.clienteId },
        select: { id: true, nroCliente: true, nombre: true },
      }),
      a.transportistaId
        ? this.prisma.transportista.findUnique({
            where: { id: a.transportistaId },
            select: { id: true, nombre: true },
          })
        : Promise.resolve(null),
      a.creadoPorTipo === 'cliente'
        ? this.prisma.cliente
            .findUnique({
              where: { id: a.creadoPorId },
              select: { nroCliente: true, nombre: true },
            })
            .then((c) =>
              c ? { tipo: 'cliente' as const, nombre: `${c.nroCliente} · ${c.nombre}` } : null,
            )
        : this.prisma.usuario
            .findUnique({
              where: { id: a.creadoPorId },
              select: { nombre: true, username: true },
            })
            .then((u) => (u ? { tipo: 'usuario' as const, nombre: u.nombre } : null)),
    ]);

    const conTitulo = <T extends { productoId: number | null }>(x: T) => {
      const p = x.productoId !== null ? info.get(x.productoId) : undefined;
      return {
        ...x,
        titulo: p?.titulo ?? null,
        editorial: p?.editorial ?? null,
        imagenUrl: p?.imagenUrl ?? null,
      };
    };
    return {
      ...a,
      cliente,
      transportista,
      creadoPor,
      declaraciones: a.declaraciones.map(conTitulo),
      bultos: a.bultos.map((b) => ({ ...b, controles: b.controles.map(conTitulo) })),
    };
  }
}
