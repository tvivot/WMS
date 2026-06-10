import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './core/auth/auth.module';
import { SeedModule } from './core/seed/seed.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    SeedModule,
    HealthModule,
    // Sirve la PWA compilada. En runtime, __dirname = dist/, así que el path
    // resuelve a dist/static (nest-cli copia src/static -> dist/static).
    // La API lleva prefijo global '/api', por lo que NO colisiona con los
    // estáticos: cualquier ruta no-'/api' devuelve la SPA (deep links OK).
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, 'static'),
      serveStaticOptions: { index: 'index.html' },
    }),
  ],
})
export class AppModule {}
