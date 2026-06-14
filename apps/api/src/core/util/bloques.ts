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
