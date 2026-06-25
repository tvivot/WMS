import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificacionesService } from './notificaciones.service';

/**
 * Contrato de evento (docs/contratos/eventos.md). Se suscribe por NOMBRE, sin
 * importar internos de Devoluciones (límite de módulo). El payload se mira solo
 * por los campos del contrato; campos extra se ignoran.
 */
const DEVOLUCION_ESTADO_CAMBIADO = 'devolucion.estado_cambiado';

interface DevolucionEstadoCambiadoEvent {
  autorizacionId: number;
  clienteId: number;
  estadoAnterior: string;
  estadoNuevo: string;
  ts: string;
}

@Injectable()
export class NotificacionesListener {
  private readonly logger = new Logger(NotificacionesListener.name);

  constructor(private readonly svc: NotificacionesService) {}

  /**
   * Reacciona a cada cambio de estado de una devolución. Asíncrono y desacoplado:
   * el emisor no espera la respuesta. El servicio ya traga sus errores; el
   * try/catch acá es red de seguridad para que nada escape como unhandled
   * rejection (el emit es síncrono y no captura el rechazo del listener async).
   */
  @OnEvent(DEVOLUCION_ESTADO_CAMBIADO, { async: true })
  async onEstadoCambiado(ev: DevolucionEstadoCambiadoEvent): Promise<void> {
    try {
      await this.svc.notificarCambioEstado({
        modulo: 'devoluciones',
        estado: ev.estadoNuevo,
        estadoAnterior: ev.estadoAnterior,
        entidadId: ev.autorizacionId,
        clienteId: ev.clienteId,
        fechaIso: ev.ts,
      });
    } catch (err) {
      this.logger.error(`onEstadoCambiado falló: ${(err as Error).message}`);
    }
  }

  /** Reintenta los envíos fallidos/pendientes cada 5 minutos (outbox). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reintentar(): Promise<void> {
    try {
      await this.svc.reintentarPendientes();
    } catch (err) {
      this.logger.error(`reintentar falló: ${(err as Error).message}`);
    }
  }
}
