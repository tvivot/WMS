import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Construye el documento OpenAPI (compartido por main.ts y el generador). */
export function construirDocOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('WMS Grupal — API')
    .setDescription('API del WMS Grupal. Módulo 1: Devoluciones de libros.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
