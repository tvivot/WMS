import { Module } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesListener } from './notificaciones.listener';
import { GraphMailer } from './graph-mailer';

/**
 * Notificaciones por email (core, transversal). Se engancha a los eventos de
 * dominio (devolucion.estado_cambiado) vía NotificacionesListener; no acopla a
 * internos de ningún módulo. EventEmitterModule y ScheduleModule son globales
 * (AppModule), así que @OnEvent/@Cron funcionan sin importarlos acá.
 */
@Module({
  controllers: [NotificacionesController],
  providers: [NotificacionesService, NotificacionesListener, GraphMailer],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
