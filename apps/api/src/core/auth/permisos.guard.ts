import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISOS_KEY, PUBLICO_KEY } from './decoradores';
import type { JwtPayload } from './jwt-payload';

/**
 * Guard global de autorización (RBAC granular): si el endpoint declara
 * @RequierePermiso(...), valida que el actor tenga al menos uno de esos permisos.
 * El front nunca es la única barrera: cada endpoint valida acá.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const esPublico = this.reflector.getAllAndOverride<boolean>(PUBLICO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (esPublico) return true;

    const requeridos = this.reflector.getAllAndOverride<string[]>(PERMISOS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as
      | JwtPayload
      | undefined;
    const tiene = !!user && requeridos.some((p) => user.permisos.includes(p));
    if (!tiene) {
      throw new ForbiddenException(
        `Requiere permiso: ${requeridos.join(' o ')}`,
      );
    }
    return true;
  }
}
