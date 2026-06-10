/**
 * Puerto (seam) hacia el futuro módulo de Ubicaciones. Devoluciones NUNCA
 * guarda una ubicación como string suelto: siempre pasa por esta interfaz.
 *
 * Implementación actual: TextFreeUbicacionResolverAdapter (acepta texto libre).
 * Cuando exista Ubicaciones: un adapter que delegue en UbicacionesPort, sin
 * tocar el resto de Devoluciones (cambio en UN solo archivo).
 */
export type TipoUbicacion =
  | 'devoluciones'
  | 'staging'
  | 'picking'
  | 'pallet'
  | 'dañados'
  | 'cuarentena'
  | 'recepcion';

export interface UbicacionResolverPort {
  existe(codigo: string): Promise<boolean>;
  esValidaPara(codigo: string, tipo: TipoUbicacion): Promise<boolean>;
}

/** Token de inyección del puerto. */
export const UBICACION_RESOLVER = Symbol('UBICACION_RESOLVER');
