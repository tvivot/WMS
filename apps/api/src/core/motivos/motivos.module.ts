import { Module } from '@nestjs/common';
import { MotivosController } from './motivos.controller';
import { MotivosService } from './motivos.service';

@Module({
  controllers: [MotivosController],
  providers: [MotivosService],
  exports: [MotivosService],
})
export class MotivosModule {}
