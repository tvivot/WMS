import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/**
 * Hashing de contraseñas con scrypt (KDF nativo de Node, sin dependencias
 * nativas que compilar — robusto en el shared hosting de Hostinger).
 * Formato almacenado: `scrypt$<salt-hex>$<hash-hex>`.
 * Está detrás de este servicio para poder cambiar el algoritmo (argon2/bcrypt)
 * sin tocar el resto del código.
 */
@Injectable()
export class PasswordService {
  async hash(plano: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(plano, salt, KEYLEN)) as Buffer;
    return `scrypt$${salt}$${derived.toString('hex')}`;
  }

  async verificar(plano: string, almacenado: string): Promise<boolean> {
    const [algo, salt, hashHex] = almacenado.split('$');
    if (algo !== 'scrypt' || !salt || !hashHex) return false;
    const derived = (await scryptAsync(plano, salt, KEYLEN)) as Buffer;
    const hashBuf = Buffer.from(hashHex, 'hex');
    return hashBuf.length === derived.length && timingSafeEqual(hashBuf, derived);
  }
}
