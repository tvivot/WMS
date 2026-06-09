import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Prefijo global: toda la API vive bajo /api; el resto lo sirve la PWA.
  app.setGlobalPrefix('api');

  // Baseline de seguridad (la política dura del proyecto se amplía luego:
  // rate-limit, CSP afinada, etc.). contentSecurityPolicy off para no romper
  // la carga de la PWA en el esqueleto; se endurece al sumar el front real.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 3000);
  // bind 0.0.0.0 para que el proxy de Hostinger alcance el proceso.
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[wms-api] escuchando en http://0.0.0.0:${port} (API en /api)`);
}

void bootstrap();
