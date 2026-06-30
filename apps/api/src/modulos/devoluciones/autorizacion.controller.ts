import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DevEstado } from '@prisma/client';
import { Actor, RequierePermiso } from '../../core/auth/decoradores';
import { PERMISOS } from '../../core/auth/permisos';
import type { JwtPayload } from '../../core/auth/jwt-payload';
import { AutorizacionService, type ArchivoImportado } from './autorizacion.service';
import {
  AsignarLoteDto,
  ConfirmarDto,
  ControlarBultoDto,
  CorregirControlDto,
  CrearAutorizacionDto,
  DeclararDto,
  ImportarDeclaracionDto,
  TerminarPesajeDto,
  RecibirDto,
  ResolverExcepcionDto,
  SolicitarExcepcionDto,
} from './dto';

/** Tope de tamaño del archivo de importación de devoluciones (5 MB). */
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

@Controller('devoluciones/autorizaciones')
export class AutorizacionController {
  constructor(private readonly svc: AutorizacionService) {}

  @RequierePermiso(PERMISOS.SOLICITUD_CREAR)
  @Post()
  crear(@Actor() actor: JwtPayload, @Body() dto: CrearAutorizacionDto) {
    return this.svc.crear(actor, dto);
  }

  @Get()
  listar(
    @Actor() actor: JwtPayload,
    @Query('estado') estado?: string,
    @Query('clienteId') clienteId?: string,
  ) {
    const est =
      estado && estado in DevEstado ? (estado as DevEstado) : undefined;
    return this.svc.listar(actor, {
      estado: est,
      clienteId: clienteId ? Number(clienteId) : undefined,
    });
  }

  /**
   * Export a Excel (.xlsx). Ruta literal declarada ANTES de :id para que el
   * ParseIntPipe de :id no la capture. Sin @RequierePermiso: como en listar, la
   * propiedad la garantiza el servicio (un cliente solo exporta lo suyo).
   */
  @Get('export.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="devoluciones.xlsx"')
  async exportar(
    @Actor() actor: JwtPayload,
    @Query('estado') estado?: string,
    @Query('clienteId') clienteId?: string,
  ): Promise<StreamableFile> {
    const est = estado && estado in DevEstado ? (estado as DevEstado) : undefined;
    const buf = await this.svc.exportarExcel(actor, {
      estado: est,
      clienteId: clienteId ? Number(clienteId) : undefined,
    });
    return new StreamableFile(buf);
  }

  /** Cola de excepciones de consignación pendientes (Gerencia). Antes de :id. */
  @RequierePermiso(PERMISOS.DEVOLUCION_AUTORIZAR_EXCEPCION)
  @Get('excepciones/pendientes')
  excepcionesPendientes() {
    return this.svc.excepcionesPendientes();
  }

  // Propiedad verificada en el servicio: un cliente solo ve lo suyo.
  @Get(':id')
  detalle(@Actor() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.svc.detalleAutorizado(actor, id);
  }

  @Get(':id/reconciliacion')
  reconciliacion(@Actor() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.svc.reconciliacionAutorizada(actor, id);
  }

  @RequierePermiso(PERMISOS.SOLICITUD_APROBAR)
  @Patch(':id/aprobar')
  aprobar(@Actor() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.svc.aprobar(actor, id);
  }

  @RequierePermiso(PERMISOS.SOLICITUD_CREAR)
  @Patch(':id/declaracion')
  declarar(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeclararDto,
  ) {
    return this.svc.declarar(actor, id, dto);
  }

  /**
   * Previsualiza una importación de líneas desde Excel/CSV (cliente que procesó la
   * devolución en otro sistema). Multipart, campo `archivo`. No persiste: devuelve
   * columnas + qué se importaría para que el cliente lo revise y lo acepte; la carga
   * real sigue pasando por /declaracion (mismo gate y validación de consignación).
   */
  @RequierePermiso(PERMISOS.SOLICITUD_CREAR)
  @Post(':id/declaracion/importar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: IMPORT_MAX_BYTES } }))
  importar(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: ArchivoImportado | undefined,
    @Body() dto: ImportarDeclaracionDto,
  ) {
    if (!archivo) throw new BadRequestException('Falta el archivo a importar (campo "archivo")');
    const nombre = archivo.originalname ?? '';
    if (!/\.(xlsx|csv)$/i.test(nombre)) {
      throw new BadRequestException('Formato no soportado: subí un Excel (.xlsx) o CSV (.csv)');
    }
    return this.svc.previsualizarImportacion(actor, id, archivo, dto);
  }

  @RequierePermiso(PERMISOS.SOLICITUD_CREAR)
  @Patch(':id/despachar')
  despachar(@Actor() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.svc.despachar(actor, id);
  }

  /** El cliente/creador solicita autorizar un libro fuera de consignación. */
  @RequierePermiso(PERMISOS.SOLICITUD_CREAR)
  @Post(':id/excepciones')
  solicitarExcepcion(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SolicitarExcepcionDto,
  ) {
    return this.svc.solicitarExcepcion(actor, id, dto);
  }

  /** Aprobar/rechazar una excepción: solo Gerencia (permiso específico). */
  @RequierePermiso(PERMISOS.DEVOLUCION_AUTORIZAR_EXCEPCION)
  @Patch(':id/excepciones/:excId/resolver')
  resolverExcepcion(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('excId', ParseIntPipe) excId: number,
    @Body() dto: ResolverExcepcionDto,
  ) {
    return this.svc.resolverExcepcion(actor, id, excId, dto);
  }

  @RequierePermiso(PERMISOS.DEPOSITO_RECIBIR)
  @Patch(':id/recibir')
  recibir(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecibirDto,
  ) {
    return this.svc.recibir(actor, id, dto);
  }

  /** Entregado → En proceso de devolución: arranca el pesaje. */
  @RequierePermiso(PERMISOS.DEPOSITO_INGRESAR)
  @Patch(':id/iniciar')
  iniciarProceso(@Actor() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.svc.iniciarProceso(actor, id);
  }

  @RequierePermiso(PERMISOS.DEPOSITO_CONTROLAR)
  @Post(':id/bultos/:numero/control')
  controlar(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('numero', ParseIntPipe) numero: number,
    @Body() dto: ControlarBultoDto,
  ) {
    return this.svc.controlarBulto(actor, id, numero, dto);
  }

  /** En proceso de devolución → Procesando: termina el pesaje. */
  @RequierePermiso(PERMISOS.DEPOSITO_CONTROLAR)
  @Patch(':id/terminar-pesaje')
  terminarPesaje(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TerminarPesajeDto,
  ) {
    return this.svc.terminarPesaje(actor, id, dto);
  }

  /** Ingresa/corrige el nº de lote del ERP (Procesando/Validando/Con diferencias). */
  @RequierePermiso(PERMISOS.DEPOSITO_CONTROLAR, PERMISOS.DEVOLUCION_VALIDAR)
  @Patch(':id/lote')
  ingresarLote(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AsignarLoteDto,
  ) {
    return this.svc.ingresarLote(actor, id, dto);
  }

  /** Con diferencias → Procesado: el responsable revisa y confirma (permiso devolucion.validar). */
  @RequierePermiso(PERMISOS.DEVOLUCION_VALIDAR)
  @Patch(':id/confirmar')
  confirmar(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmarDto,
  ) {
    return this.svc.confirmarConDiferencias(actor, id, dto);
  }

  /** Corrección post-Procesado: solo quien tenga devolucion.corregir (Admin por defecto). */
  @RequierePermiso(PERMISOS.DEVOLUCION_CORREGIR)
  @Patch(':id/bultos/:numero/correccion')
  corregir(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('numero', ParseIntPipe) numero: number,
    @Body() dto: CorregirControlDto,
  ) {
    return this.svc.corregirControl(actor, id, numero, dto);
  }
}
