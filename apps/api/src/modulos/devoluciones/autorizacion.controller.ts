import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DevEstado } from '@prisma/client';
import { Actor, RequierePermiso } from '../../core/auth/decoradores';
import { PERMISOS } from '../../core/auth/permisos';
import type { JwtPayload } from '../../core/auth/jwt-payload';
import { AutorizacionService } from './autorizacion.service';
import {
  CerrarDto,
  ControlarBultoDto,
  CorregirControlDto,
  CrearAutorizacionDto,
  DeclararDto,
  IngresoDto,
  RecibirDto,
} from './dto';

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

  @RequierePermiso(PERMISOS.SOLICITUD_CREAR)
  @Patch(':id/despachar')
  despachar(@Actor() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.svc.despachar(actor, id);
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

  @RequierePermiso(PERMISOS.DEPOSITO_INGRESAR)
  @Patch(':id/ingreso')
  ingreso(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: IngresoDto,
  ) {
    return this.svc.ingreso(actor, id, dto);
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

  @RequierePermiso(PERMISOS.DEPOSITO_CONTROLAR)
  @Patch(':id/cierre')
  cerrar(
    @Actor() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CerrarDto,
  ) {
    return this.svc.cerrar(actor, id, dto);
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
