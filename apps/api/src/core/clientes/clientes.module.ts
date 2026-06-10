import { Module } from '@nestjs/common';
import { PasswordService } from '../seguridad/password.service';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, PasswordService],
})
export class ClientesModule {}
