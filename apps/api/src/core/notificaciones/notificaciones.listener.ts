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
const DEVOLUCION_LOTE_EVALUADO = 'devolucion.lote_evaluado';

interface DevolucionEstadoCambiadoEvent {
  autorizacionId: number;
  clienteId: number;
  estadoAnterior: string;
  estadoNuevo: string;
  ts: string;
}

interface LoteEvaluadoLinea {
  isbn: string;
  titulo: string | null;
  declarado: number;
  cantidadFierro: number | null;
  diferencia: number | null;
}
interface DevolucionLoteEvaluadoEvent {
  autorizacionId: number;
  clienteId: number;
  loteCodigo: string;
  reconciliacion: LoteEvaluadoLinea[];
  hayDiferencias: boolean;
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

  /**
   * Chequeo periódico de lotes: avisa a los responsables (regla por estado
   * "LOTE_EVALUADO") con el detalle de la comparación declarado vs lote del ERP.
   */
  @OnEvent(DEVOLUCION_LOTE_EVALUADO, { async: true })
  async onLoteEvaluado(ev: DevolucionLoteEvaluadoEvent): Promise<void> {
    try {
      await this.svc.notificarCambioEstado({
        modulo: 'devoluciones',
        estado: 'LOTE_EVALUADO',
        entidadId: ev.autorizacionId,
        clienteId: ev.clienteId,
        fechaIso: ev.ts,
        detalle: this.detalleReconciliacion(ev),
      });
    } catch (err) {
      this.logger.error(`onLoteEvaluado falló: ${(err as Error).message}`);
    }
  }

  /** Arma el texto del detalle de la reconciliación para el cuerpo del mail. */
  private detalleReconciliacion(ev: DevolucionLoteEvaluadoEvent): string {
    const cab = `Lote del ERP: ${ev.loteCodigo}.`;
    if (!ev.hayDiferencias) {
      return `${cab}\nLo declarado coincide con el lote del ERP (sin diferencias).`;
    }
    const esDiferencia = (l: LoteEvaluadoLinea) =>
      l.cantidadFierro === null ? l.declarado > 0 : l.diferencia !== null && l.diferencia !== 0;
    const filas = ev.reconciliacion
      .filter(esDiferencia)
      .map((l) => {
        const t = l.titulo ?? l.isbn;
        if (l.cantidadFierro === null) {
          return `- ${t} (${l.isbn}): declarado ${l.declarado}, NO figura en el lote del ERP`;
        }
        const dif = l.diferencia as number;
        const signo = dif > 0 ? `+${dif} (declaró de más)` : `${dif} (faltante)`;
        return `- ${t} (${l.isbn}): declarado ${l.declarado}, ERP ${l.cantidadFierro} → ${signo}`;
      })
      .join('\n');
    return `${cab}\nDiferencias detectadas:\n${filas}`;
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
