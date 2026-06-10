# Contrato — `UbicacionResolverPort` (puerto consumido por Devoluciones)

> Cambiar este contrato es un cambio consciente: actualizar este archivo, el
> puerto y los tests del seam en el mismo PR.

## Definición

Código: `apps/api/src/modulos/devoluciones/puertos/ubicacion-resolver.port.ts`

```ts
type TipoUbicacion =
  | 'picking' | 'pallet' | 'devoluciones' | 'staging'
  | 'recepcion' | 'cuarentena' | 'dañados';

interface UbicacionResolverPort {
  existe(codigo: string): Promise<boolean>;
  esValidaPara(codigo: string, tipo: TipoUbicacion): Promise<boolean>;
}
```

Inyección: token `UBICACION_RESOLVER` (provider en `devoluciones.module.ts`).

## Quién lo usa y para qué

Devoluciones valida **dos** ubicaciones, nunca strings sueltos:

| Momento | Campo | Tipo exigido |
|---|---|---|
| Ingreso a depósito | `ubicacion_espera` | `devoluciones` / `staging` |
| Cierre (Procesado) | `ubicacion_destino_bueno` | `picking` / `pallet` |
| Cierre (Procesado) | `ubicacion_destino_malo` | `dañados` / `cuarentena` |

## Implementaciones

- **Actual:** `TextFreeUbicacionResolverAdapter` — acepta cualquier texto no
  vacío (módulo Ubicaciones aún no existe).
- **Futura (módulo Ubicaciones):** adapter que delega en
  `UbicacionesPort.esValidaPara(codigo, tipo)`. El cambio es **solo el
  provider** en `devoluciones.module.ts`; el resto de Devoluciones no se toca.
- **Test del seam:** `puertos/ubicacion-resolver.seam.spec.ts` prueba que una
  implementación falsa de "ubicaciones" se enchufa sin tocar Devoluciones.
