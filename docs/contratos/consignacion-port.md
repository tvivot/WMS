# Contrato — Puerto de consignación (inbound)

> Puerto inbound del **saldo en consignación** por cliente + ISBN. El dato es
> dueño de **Devoluciones** (tabla `dev_consignacion_saldo`) y entra SOLO por
> este puerto: **Integraciones** lo invoca con el snapshot del ERP. Ningún
> módulo escribe la tabla directo. Cambiar el contrato = actualizar este archivo.

Código: `apps/api/src/modulos/devoluciones/puertos/consignacion.port.ts`
Adapter actual: `PrismaConsignacionAdapter` (registrado en `devoluciones.module.ts`).
Token de inyección: `CONSIGNACION_PORT`.

## Qué es la consignación

Libros que el cliente (librería) tiene "en depósito" sin comprar: paga lo que
vende y devuelve el resto. El **saldo** es cuánto tiene hoy de cada título. El
ERP es dueño del dato (distingue firme vs consignación) y manda solo lo que está
en consignación. Devoluciones lo usa para **reconciliar**: marca cuando una
devolución trae más de lo que el cliente tenía en consignación.

## Interfaz

```ts
interface ConsignacionPort {
  // Carga el snapshot del ERP. Full-replace POR CLIENTE; idempotente.
  cargarSaldos(snapshotTs: string, items: ConsignacionSaldoItem[]): Promise<ConsignacionCargaResultado>;
  // Lookup batch para la reconciliación: ISBN → cantidad (clave ausente = sin dato).
  saldosDe(clienteId: number, isbns: string[]): Promise<Map<string, number>>;
}

type ConsignacionSaldoItem = { nroCliente: string; isbn: string; cantidad: number };
type ConsignacionCargaResultado = {
  recibidos: number; clientes: number; upserts: number;
  clientesDesconocidos: string[];          // nroCliente no hallados en core_cliente (no abortan)
  errores: { isbn: string; error: string }[];
};
```

## Semántica del snapshot

- **Full-replace por cliente:** cada carga reemplaza TODOS los saldos de cada
  cliente presente en el lote (`deleteMany` + `createMany` en transacción). El
  ERP manda el saldo final por título, no deltas.
- **Idempotente:** reenviar el mismo snapshot deja la tabla idéntica.
- **Orden:** `snapshotTs` marca el instante del snapshot; una carga con
  `snapshotTs` más viejo que el último del cliente se descarta (no pisa datos
  más nuevos que llegaron fuera de orden).
- `nroCliente` se resuelve a `clienteId` contra `core_cliente`; los desconocidos
  se reportan sin abortar. ISBN se normaliza (ISBN-10 → ISBN-13); inválidos a
  `errores`. Referencias al núcleo por ID, **sin FK cruzada**.

## Entrada del integrador (ERP)

`POST /api/integraciones/consignacion/import` — permiso `consignacion.importar`.
Pensado para **actualización diaria**. Hardening: máximo 5000 items por request
(el ERP pagina si supera); validación de tipo/tamaño antes de procesar.

> **Paginación:** por la semántica full-replace por cliente, un mismo cliente
> NO debe partirse entre dos requests del mismo snapshot — la segunda página
> reemplazaría (no acumularía) los saldos que cargó la primera. El ERP debe
> paginar por cliente completo. Cargas concurrentes del mismo cliente: una sola
> escritura por snapshot (el import diario es de un solo emisor).

```json
{
  "snapshotTs": "2026-06-17T02:00:00.000Z",
  "items": [
    { "nroCliente": "C-10", "isbn": "9780306406157", "cantidad": 5 }
  ]
}
```

Respuesta: `{ recibidos, clientes, upserts, clientesDesconocidos, errores }`.

## Futuro

Cuando exista un módulo "Consignaciones" con el ciclo completo (salidas,
liquidaciones), pasa a ser dueño de la tabla y expone su propio adapter: se
cambia **una línea** en `devoluciones.module.ts` (igual que `UBICACION_RESOLVER`).
El pull automático del ERP (scheduler) se sumará con el conector de Integraciones
(`int_conector`/`int_flujo`), reusando `cargarSaldos`.
