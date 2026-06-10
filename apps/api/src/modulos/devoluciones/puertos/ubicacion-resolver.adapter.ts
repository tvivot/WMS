import { Injectable } from '@nestjs/common';
import type { TipoUbicacion, UbicacionResolverPort } from './ubicacion-resolver.port';

/**
 * Implementación actual del puerto: acepta cualquier texto no vacío como
 * ubicación válida (todavía no existe el módulo Ubicaciones). Cuando exista,
 * se reemplaza por un adapter que delegue en UbicacionesPort.esValidaPara().
 */
@Injectable()
export class TextFreeUbicacionResolverAdapter implements UbicacionResolverPort {
  async existe(codigo: string): Promise<boolean> {
    return typeof codigo === 'string' && codigo.trim().length > 0;
  }

  async esValidaPara(codigo: string, _tipo: TipoUbicacion): Promise<boolean> {
    return this.existe(codigo);
  }
}
