import 'reflect-metadata';
import { PERMISOS_KEY } from '../../core/auth/decoradores';
import { PERMISOS } from '../../core/auth/permisos';
import { AutorizacionController } from './autorizacion.controller';

/**
 * Cada transición de la máquina de estados exige su permiso (RBAC granular).
 * Este test fija el contrato: cambiar un permiso de endpoint es un cambio
 * consciente que rompe el test, no un accidente.
 */
describe('AutorizacionController — permisos por endpoint', () => {
  const permisoDe = (metodo: string): string[] | undefined =>
    Reflect.getMetadata(
      PERMISOS_KEY,
      AutorizacionController.prototype[metodo as keyof AutorizacionController],
    );

  it.each([
    ['crear', [PERMISOS.SOLICITUD_CREAR]],
    ['aprobar', [PERMISOS.SOLICITUD_APROBAR]],
    ['declarar', [PERMISOS.SOLICITUD_CREAR]],
    ['despachar', [PERMISOS.SOLICITUD_CREAR]],
    ['recibir', [PERMISOS.DEPOSITO_RECIBIR]],
    ['iniciarProceso', [PERMISOS.DEPOSITO_INGRESAR]],
    ['controlar', [PERMISOS.DEPOSITO_CONTROLAR]],
    ['terminarPesaje', [PERMISOS.DEPOSITO_CONTROLAR]],
    ['ingresarLote', [PERMISOS.DEPOSITO_CONTROLAR, PERMISOS.DEVOLUCION_VALIDAR]],
    ['confirmar', [PERMISOS.DEVOLUCION_VALIDAR]],
    ['corregir', [PERMISOS.DEVOLUCION_CORREGIR]],
  ])('%s exige %p', (metodo, esperado) => {
    expect(permisoDe(metodo)).toEqual(esperado);
  });

  it('las consultas no exigen permiso extra (solo JWT; propiedad en el servicio)', () => {
    expect(permisoDe('listar')).toBeUndefined();
    expect(permisoDe('detalle')).toBeUndefined();
    expect(permisoDe('reconciliacion')).toBeUndefined();
  });
});
