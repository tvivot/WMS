import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../../../core/auth/decoradores';
import { PERMISOS } from '../../../core/auth/permisos';
import { StockService } from './stock.service';

@RequierePermiso(PERMISOS.DEVOLUCION_STOCK_VER)
@Controller('devoluciones/stock')
export class StockController {
  constructor(private readonly svc: StockService) {}

  /** Stock declarado por título (devoluciones en depósito, sin procesar). */
  @Get()
  stock() {
    return this.svc.stock();
  }

  /** Drill-down: en qué devoluciones está un título y el contenido de cada una. */
  @Get('detalle')
  detalle(@Query('productoId') productoId?: string, @Query('isbn') isbn?: string) {
    // productoId: solo un entero positivo cuenta (Number('')===0 no es un id válido).
    const pid = productoId !== undefined ? Number(productoId) : NaN;
    // isbn: entrada de API → trim + cap defensivo (hardening), aunque Prisma parametriza.
    const isbnLimpio = isbn?.trim().slice(0, 32) || null;
    return this.svc.detalle(Number.isInteger(pid) && pid > 0 ? pid : null, isbnLimpio);
  }
}
