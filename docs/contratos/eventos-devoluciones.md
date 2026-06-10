# Contrato — Eventos emitidos por Devoluciones

> Contrato único: estos mismos eventos los consumen los futuros módulos
> internos (Inventario) y la integración WMS (módulo Integraciones). Cambiarlos
> es un cambio consciente: actualizar este archivo y los consumidores.

Código: `apps/api/src/modulos/devoluciones/eventos/eventos.ts`
Transporte actual: `EventEmitter2` in-process (`@nestjs/event-emitter`).

## `devolucion.estado_cambiado`

Se emite en **cada transición** de la máquina de estados.

```ts
{
  autorizacionId: number;
  estadoAnterior: string;   // DevEstado
  estadoNuevo: string;      // DevEstado
  actorId: number;
  actorTipo: 'usuario' | 'cliente';
  ts: string;               // ISO 8601
}
```

## `devolucion.procesada`

Se emite al **cerrar** (estado Procesado) y al aplicar una **corrección
post-Procesado** (re-emisión con `correccion: true`; el consumidor debe
tratarla como REEMPLAZO del resultado anterior, no como suma).

```ts
{
  autorizacionId: number;
  clienteId: number;
  depositoId: number;
  reconciliacion: Array<{
    isbn: string;
    productoId: number | null;
    titulo: string | null;
    declarado: number;
    recibido: number;
    bueno: number;   // recibido - malo → destino vendible
    malo: number;    // → dañados/cuarentena
  }>;
  ubicacionDestinoBueno: string;
  ubicacionDestinoMalo: string;
  correccion?: boolean;  // true solo en re-emisiones por corrección
  ts: string;            // ISO 8601
}
```

## Reglas para consumidores

- **Devoluciones NO mueve stock**: el alta real de stock la hará Inventario
  consumiendo `devolucion.procesada`.
- Idempotencia: usar `autorizacionId` (+ `correccion`) como clave; una
  re-emisión por corrección reemplaza el resultado anterior de esa autorización.
- Las referencias (`clienteId`, `productoId`, ubicaciones por código) son IDs
  sin FK cruzada: resolver contra core / Ubicaciones por sus puertos.
