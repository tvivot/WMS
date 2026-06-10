/** Contenido del JWT y de req.user tras autenticar. */
export interface JwtPayload {
  sub: number;
  tipo: 'usuario' | 'cliente';
  nombre: string;
  permisos: string[];
  primerIngreso: boolean;
}
