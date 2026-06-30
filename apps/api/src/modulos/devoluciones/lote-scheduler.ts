import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AutorizacionService } from './autorizacion.service';

/**
 * Chequeo periódico de lotes (cada 15 min): compara lo declarado por el cliente
 * contra el lote del ERP en las devoluciones declaradas y sin procesar, y avisa
 * a los responsables (vía evento → Notificaciones) cuando la comparación cambia.
 * Es trabajo de dominio de Devoluciones (no habla con sistemas externos), por eso
 * vive acá y no en Integraciones.
 */
@Injectable()
export class LoteScheduler {
  private readonly logger = new Logger(LoteScheduler.name);

  constructor(private readonly svc: AutorizacionService) {}

  @Cron('*/15 * * * *')
  async evaluar(): Promise<void> {
    try {
      const r = await this.svc.evaluarLotesPendientes();
      if (r.procesadas > 0 || r.conDiferencias > 0) {
        this.logger.log(
          `Validación de lotes: ${r.procesadas} procesadas, ${r.conDiferencias} con diferencias (de ${r.revisadas} en validación)`,
        );
      }
    } catch (err) {
      this.logger.error(`Validación de lotes falló: ${(err as Error).message}`);
    }
  }
}
