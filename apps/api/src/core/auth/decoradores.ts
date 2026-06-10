import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { JwtPayload } from './jwt-payload';

/** Marca un endpoint como público (sin requerir JWT). */
export const PUBLICO_KEY = 'es_publico';
export const Publico = () => SetMetadata(PUBLICO_KEY, true);

/** Exige uno o más permisos para acceder al endpoint (RBAC granular). */
export const PERMISOS_KEY = 'permisos_requeridos';
export const RequierePermiso = (...codigos: string[]) =>
  SetMetadata(PERMISOS_KEY, codigos);

/** Inyecta el actor autenticado (req.user) en el handler. */
export const Actor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as JwtPayload;
  },
);
