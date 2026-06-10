import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './core/auth/auth.module';
import { SeedModule } from './core/seed/seed.module';
import { AuditoriaModule } from './core/auditoria/auditoria.module';
import { CatalogoModule } from './core/catalogo/catalogo.module';
import { ClientesModule } from './core/clientes/clientes.module';
import { UsuariosModule } from './core/usuarios/usuarios.module';
import { RolesModule } from './core/roles/roles.module';
import { TransportistasModule } from './core/transportistas/transportistas.module';
import { AdminModule } from './core/admin/admin.module';
import { DevolucionesModule } from './modulos/devoluciones/devoluciones.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    // Rate limiting global (anti fuerza bruta / abuso): 120 req/min por IP.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditoriaModule,
    AuthModule,
    SeedModule,
    CatalogoModule,
    ClientesModule,
    UsuariosModule,
    RolesModule,
    TransportistasModule,
    AdminModule,
    DevolucionesModule,
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
  providers: [
    // Guard de rate limiting a nivel global.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
