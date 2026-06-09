import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@wms/shared';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/health — verifica proceso vivo + conexión a la DB (SELECT 1). */
  @Get()
  async check(): Promise<HealthResponse> {
    let db: HealthResponse['db'] = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      status: db === 'up' ? 'ok' : 'error',
      db,
      ts: new Date().toISOString(),
    };
  }
}
