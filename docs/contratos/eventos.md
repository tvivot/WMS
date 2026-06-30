# Contratos de eventos de dominio

Los módulos se comunican por **eventos** (un módulo emite, otros se suscriben)
sin importar internos entre sí. Estos nombres y payloads son **contrato estable**:
cambiarlos es una decisión consciente y se documenta acá.

## `devolucion.estado_cambiado`

- **Emite:** módulo Devoluciones, en cada transición de estado de una autorización.
- **Origen:** `apps/api/src/modulos/devoluciones/eventos/eventos.ts` (constante
  `DEVOLUCION_ESTADO_CAMBIADO`).
- **Suscriptores:** Notificaciones (core) → envía emails según las reglas por estado.

Payload:

| Campo            | Tipo                     | Notas                                            |
|------------------|--------------------------|--------------------------------------------------|
| `autorizacionId` | number                   | ID/nro de la devolución.                          |
| `clienteId`      | number                   | Cliente dueño. Lo usa Notificaciones (mail cliente). |
| `estadoAnterior` | string                   | Estado origen.                                    |
| `estadoNuevo`    | string                   | Estado destino (clave de la regla de notificación). |
| `actorId`        | number                   | Quién ejecutó la transición.                      |
| `actorTipo`      | `'usuario' \| 'cliente'` | Tipo de actor.                                    |
| `ts`             | string (ISO)             | Momento del cambio.                               |

> **2026-06-25:** se agregó `clienteId` para que Notificaciones pueda resolver el
> correo del cliente sin leer tablas `dev_*` (respeta el límite de módulo).

Los suscriptores se enganchan por **nombre** de evento (la constante string), no
importan el archivo de Devoluciones, y leen solo los campos del contrato.

## `devolucion.lote_evaluado`

- **Emite:** Devoluciones, desde el chequeo periódico de lotes (cron cada 15 min,
  `LoteScheduler` → `evaluarLotesPendientes()`), por cada devolución declarada y sin
  procesar con lote del ERP asignado **cuando la comparación cambió** desde el
  último aviso (dedup por `lote_validacion_firma`).
- **Suscriptores:** Notificaciones (core) → avisa a los responsables (regla por
  estado lógico `LOTE_EVALUADO`).

Payload (`DevolucionLoteEvaluadoEvent`): `autorizacionId`, `clienteId`,
`loteCodigo`, `reconciliacion` (líneas `ReconciliacionLinea`), `hayDiferencias`
(bool), `ts`.

## `devolucion.procesada`

- **Emite:** Devoluciones, al cerrar (estado `PROCESADO`) y en correcciones.
- **Suscriptores previstos:** Inventario (alta de stock), cuando exista.
- Payload: ver `DevolucionProcesadaEvent` en el archivo de eventos.

Cada línea de `reconciliacion` (`ReconciliacionLinea`) compara, por ISBN, lo
**declarado** por el cliente en el WMS contra la cantidad del **lote del ERP
(Fierro)**:

| Campo            | Tipo            | Notas                                                    |
|------------------|-----------------|----------------------------------------------------------|
| `isbn`           | string          | ISBN normalizado.                                        |
| `productoId`     | number \| null  | Producto del catálogo (null si no resolvió).             |
| `titulo`         | string \| null  | Del catálogo; si no, el del lote de Fierro.              |
| `declarado`      | number          | Suma declarada por el cliente en el WMS.                 |
| `cantidadFierro` | number \| null  | Cantidad del lote del ERP. null = ISBN ausente del lote. |
| `diferencia`     | number \| null  | `declarado - cantidadFierro` (null si sin dato Fierro). Positivo = sobrante, negativo = faltante. |

> **2026-06-25:** cambio de contrato. Antes la línea traía `recibido/bueno/malo`
> (del control de libros por ISBN) y `saldoConsignacion/excedeConsignacion`. El
> control de libros pasó a otro proceso: ahora la reconciliación es **declarado
> vs lote del ERP**. El alta de stock real la decide Inventario al consumir el
> evento (tiene declarado y cantidadFierro; el conteo físico llega por su flujo).
