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

## `devolucion.procesada`

- **Emite:** Devoluciones, al cerrar (estado `PROCESADO`) y en correcciones.
- **Suscriptores previstos:** Inventario (alta de stock), cuando exista.
- Payload: ver `DevolucionProcesadaEvent` en el archivo de eventos.
