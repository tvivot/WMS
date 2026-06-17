import { Body, Controller, Inject, Post } from '@nestjs/common';
import { RequierePermiso } from '../../core/auth/decoradores';
import { PERMISOS } from '../../core/auth/permisos';
import {
  CONSIGNACION_PORT,
  type ConsignacionPort,
} from '../../modulos/devoluciones/puertos/consignacion.port';
import { ConsignacionImportDto } from './consignacion.dto';

/**
 * Import del saldo en consignación desde el ERP (integrador). Único punto de
 * entrada del dato externo; delega en el puerto inbound de Devoluciones
 * (dueño del dato). Pensado para actualización diaria. Idempotente.
 */
@RequierePermiso(PERMISOS.CONSIGNACION_IMPORTAR)
@Controller('integraciones/consignacion')
export class ConsignacionController {
  constructor(
    @Inject(CONSIGNACION_PORT) private readonly consignacion: ConsignacionPort,
  ) {}

  /** Carga/actualiza el saldo en consignación y devuelve el resumen. */
  @Post('import')
  importar(@Body() dto: ConsignacionImportDto) {
    return this.consignacion.cargarSaldos(dto.snapshotTs, dto.items);
  }
}
