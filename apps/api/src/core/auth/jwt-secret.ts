/**
 * Resuelve el secreto para firmar/validar JWT. NUNCA hay un secreto hardcodeado
 * usable en producción: si falta `JWT_SECRET` en prod, el arranque FALLA (un
 * secreto público conocido permitiría forjar tokens de admin y bypassear el RBAC).
 * En desarrollo se permite un valor efímero solo para no frenar el laburo local.
 */
export function resolverJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET no está definido. Es obligatorio en producción: ' +
        'sin él se firmarían los tokens con un secreto público y cualquiera ' +
        'podría forjar credenciales. Cargá JWT_SECRET en las variables de entorno.',
    );
  }

  // Solo desarrollo: aviso fuerte para que no pase desapercibido.
  // eslint-disable-next-line no-console
  console.warn(
    '[seguridad] JWT_SECRET no definido — usando un secreto efímero SOLO para desarrollo. ' +
      'NO desplegar así.',
  );
  return 'dev-only-insecure-secret';
}
