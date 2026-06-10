import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Publico } from '../core/auth/decoradores';

// Tipo local (evita depender de la resolución del workspace @wms/shared en el
// build de Hostinger). El contrato compartido vive en packages/shared para la PWA.
interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  ts: string;
}

@Publico()
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
