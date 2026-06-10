import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { runMigrations } from './migrate';
import { construirDocOpenApi } from './openapi.config';

async function bootstrap(): Promise<void> {
  // Aplica migraciones pendientes antes de levantar (sin terminal en Hostinger).
  runMigrations();

  const app = await NestFactory.create(AppModule);

  // Prefijo global: toda la API vive bajo /api; el resto lo sirve la PWA.
  app.setGlobalPrefix('api');

  // Seguridad: helmet con CSP compatible (PWA + Google Fonts + cámara/blob).
  // Se excluye /api/docs (Swagger UI usa inline scripts).
  const helmetMw = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
  });
  app.use((req: { path: string }, res: unknown, next: () => void) =>
    req.path.startsWith('/api/docs') ? next() : helmetMw(req as never, res as never, next),
  );

  app.enableCors({ origin: process.env.CORS_ORIGIN ?? true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Documentación interactiva + contrato.
  SwaggerModule.setup('api/docs', app, construirDocOpenApi(app));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[wms-api] escuchando en http://0.0.0.0:${port} (API en /api, docs en /api/docs)`);
}

void bootstrap();
