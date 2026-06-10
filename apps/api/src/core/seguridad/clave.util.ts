import { randomInt } from 'node:crypto';

// Alfabeto sin caracteres ambiguos (0/O, 1/l/I) para claves legibles.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Genera una clave aleatoria legible para entregar al cliente/usuario. */
export function generarClave(largo = 10): string {
  let out = '';
  for (let i = 0; i < largo; i++) {
    out += ALFABETO[randomInt(ALFABETO.length)];
  }
  return out;
}
