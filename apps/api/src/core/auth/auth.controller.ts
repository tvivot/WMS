import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Actor, Publico } from './decoradores';
import { CambiarClaveDto, LoginClienteDto, LoginUsuarioDto } from './dto';
import type { JwtPayload } from './jwt-payload';

// Límite estricto en login: 10 intentos/min por IP (suma al lockout por cuenta).
const THROTTLE_LOGIN = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Login de usuarios internos (username + clave). */
  @Publico()
  @Throttle(THROTTLE_LOGIN)
  @Post('login/usuario')
  loginUsuario(@Body() dto: LoginUsuarioDto) {
    return this.auth.loginUsuario(dto.username, dto.clave);
  }

  /** Login de clientes (nro_cliente + clave generada). */
  @Publico()
  @Throttle(THROTTLE_LOGIN)
  @Post('login/cliente')
  loginCliente(@Body() dto: LoginClienteDto) {
    return this.auth.loginCliente(dto.nroCliente, dto.clave);
  }

  /** Datos del actor autenticado (incluye permisos para el front). */
  @Get('me')
  me(@Actor() actor: JwtPayload) {
    return {
      sub: actor.sub,
      tipo: actor.tipo,
      nombre: actor.nombre,
      permisos: actor.permisos,
      primerIngreso: actor.primerIngreso,
    };
  }

  /** Cambio de clave (obligatorio en primer ingreso). */
  @Post('cambiar-clave')
  cambiarClave(@Actor() actor: JwtPayload, @Body() dto: CambiarClaveDto) {
    return this.auth.cambiarClave(actor, dto.claveActual, dto.claveNueva);
  }
}
