import { Body, Controller, Inject, Post } from '@nestjs/common';
import { RequierePermiso } from '../../core/auth/decoradores';
import { PERMISOS } from '../../core/auth/permisos';
import {
  DEVOLUCIONES_LOTE_PORT,
  type DevolucionesLotePort,
} from '../../modulos/devoluciones/puertos/lote.port';
import { LotesImportarDto } from './lote.dto';

/**
 * Import de lotes de devolución desde el ERP (Fierro). Único punto de entrada del
 * dato externo; delega en el puerto inbound de Devoluciones (dueño del dato).
 * Idempotente (upsert por codigo). Ruta: /api/integraciones/devoluciones/lotes/import.
 */
@RequierePermiso(PERMISOS.DEVOLUCION_IMPORTAR)
@Controller('integraciones/devoluciones/lotes')
export class LoteController {
  constructor(
    @Inject(DEVOLUCIONES_LOTE_PORT) private readonly lotes: DevolucionesLotePort,
  ) {}

  /** Carga/actualiza lotes y devuelve {recibidos, creados, actualizados, errores}. */
  @Post('import')
  importar(@Body() dto: LotesImportarDto) {
    return this.lotes.importarLotes(dto.lotes);
  }
}
