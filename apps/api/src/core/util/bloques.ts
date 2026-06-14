/**
 * Parte un arreglo en bloques de tamaño n (para batch/chunked queries: limita
 * el tamaño de cada IN(...)/createMany y el nº de operaciones por transacción).
 * Util transversal del core — única fuente de verdad para el chunking.
 */
export function enBloques<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Escapa los comodines de LIKE (`\` `%` `_`) para que en Prisma
 * contains/startsWith/endsWith se tomen como literales. Sin esto, un término con
 * `%` genera `LIKE '%%'` y devuelve toda la tabla (Prisma NO escapa el valor).
 */
export function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}
