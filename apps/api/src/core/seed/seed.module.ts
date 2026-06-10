import { Module } from '@nestjs/common';
import { PasswordService } from '../seguridad/password.service';
import { SeedService } from './seed.service';

@Module({
  providers: [SeedService, PasswordService],
})
export class SeedModule {}
