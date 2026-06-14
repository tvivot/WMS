/**
 * Resuelve el secreto para firmar/validar JWT. NUNCA hay un secreto hardcodeado
 * usable en producción: si falta `JWT_SECRET` en prod, el arranque FALLA (un
 * secreto público conocido permitiría forjar tokens de admin y bypassear el RBAC).
 * En desarrollo se permite un valor efímero solo para no frenar el laburo local.
 */
export function resolverJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  // Fail-closed: el secreto efímero SOLO se habilita con NODE_ENV explícito en
  // 'development' o 'test'. Cualquier otro caso —incluido NODE_ENV vacío, que es
  // lo habitual en el Node gestionado de Hostinger— se trata como producción y
  // el arranque FALLA. Antes se chequeaba `=== 'production'`, así que un
  // NODE_ENV sin setear caía en el secreto público y permitía forjar tokens.
  const entorno = process.env.NODE_ENV;
  if (entorno !== 'development' && entorno !== 'test') {
    throw new Error(
      'JWT_SECRET no está definido. Es obligatorio fuera de desarrollo: ' +
        'sin él se firmarían los tokens con un secreto público y cualquiera ' +
        'podría forjar credenciales. Cargá JWT_SECRET en las variables de entorno.',
    );
  }

  // Solo desarrollo/test: aviso fuerte para que no pase desapercibido.
  // eslint-disable-next-line no-console
  console.warn(
    `[seguridad] JWT_SECRET no definido — secreto efímero SOLO para ${entorno}. ` +
      'NO desplegar así.',
  );
  return 'dev-only-insecure-secret';
}
