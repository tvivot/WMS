import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Tipo local (evita depender de la resolución del workspace @wms/shared en el
// build de Hostinger). El contrato compartido vive en packages/shared para la PWA.
interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  ts: string;
  // DIAGNÓSTICO TEMPORAL: motivo del fallo de conexión. Quitar tras resolver.
  detail?: string;
  code?: string;
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/health — verifica proceso vivo + conexión a la DB (SELECT 1). */
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up', ts: new Date().toISOString() };
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return {
        status: 'error',
        db: 'down',
        ts: new Date().toISOString(),
        // Recortado para no volcar datos sensibles; suele bastar para diagnosticar.
        detail: (e.message ?? String(err)).split('\n')[0].slice(0, 300),
        code: e.code,
      };
    }
  }
}
