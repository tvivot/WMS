import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // No tumbar el arranque si la DB no responde: la app sigue viva y
    // /api/health reporta db:down. Prisma reintenta la conexión en la
    // próxima query.
    try {
      await this.$connect();
    } catch (err) {
      this.logger.warn(
        `No se pudo conectar a la DB al iniciar: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
