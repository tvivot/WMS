import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { runMigrationsAsync } from './migrate';
import { construirDocOpenApi } from './openapi.config';
import { wooImgHost } from './integraciones/woocommerce/woocommerce.config';

async function bootstrap(): Promise<void> {
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
        // 'self' + data: + (si está configurado) el host de WooCommerce, para
        // mostrar portadas referenciadas por URL externa.
        imgSrc: ["'self'", 'data:', ...(wooImgHost() ? [wooImgHost() as string] : [])],
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

  // CORS restrictivo. Deployable único: la PWA se sirve same-origin, así que en
  // producción NO se habilita CORS salvo que se declare un origen explícito en
  // CORS_ORIGIN (lista separada por comas). En desarrollo se permite todo para
  // no frenar el laburo local. Nunca se refleja un Origin arbitrario en prod.
  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin.split(',').map((o) => o.trim()) });
  } else if (process.env.NODE_ENV !== 'production') {
    app.enableCors({ origin: true });
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Cierre limpio: en cada SIGTERM (redeploy de Hostinger) NestJS corre los
  // onModuleDestroy → PrismaService.$disconnect() cierra el pool MySQL y
  // ScheduleModule cancela los @Interval. Sin esto el proceso muere sin soltar
  // la conexión ni el timer del scheduler.
  app.enableShutdownHooks();

  // Documentación interactiva + contrato. Nunca debe impedir el arranque.
  try {
    SwaggerModule.setup('api/docs', app, construirDocOpenApi(app));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[wms-api] Swagger deshabilitado por error:', (err as Error).message);
  }

  // PRIMERO escuchar (Hostinger exige que el puerto abra rápido)…
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[wms-api] escuchando en http://0.0.0.0:${port} (API en /api, docs en /api/docs)`);

  // …y DESPUÉS migrar en segundo plano (no bloquea el arranque).
  runMigrationsAsync();
}

void bootstrap();
