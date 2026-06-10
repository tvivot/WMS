# MÓDULO 5 — Picking (`pick_*`)

> Spec de UN módulo. Se construye **solo**. Va en `docs/modulos/picking.md`. Depende del `CLAUDE.md` raíz.

## Objetivo
Importar **pedidos** del sistema de gestión (ERP), decidir de dónde levantar cada línea (**picking** vs **bulto entero en reserva**), armar la **ruta secuenciada por ubicación**, guiar la recorrida y generar el **remito** (con la dirección) que va pegado en la caja.

## Alcance
**Entra:** recepción de pedidos (Integraciones se los inyecta vía `PickingPort.crearPedidos`), decisión picking/reserva por línea, ruta secuenciada por ubicación (heurística serpentina), **agrupación opcional de pedidos (batch)**, ejecución del picking (escaneo + confirmación), descuento de stock (vía `InventarioPort`), generación del remito/etiqueta con dirección.
**No entra:** **ruteo del reparto/entrega** (la dirección es solo para el remito; el TMS sería otro módulo a futuro); traer los pedidos del ERP / transporte / agenda (eso es **Integraciones**); gestión de stock (Inventario); mapa del depósito (Ubicaciones).

## Aislamiento (duro)
- Tablas `pick_`. **Sin FKs cruzadas.**
- Consume `core` (clientes, catálogo, auditoría), **UbicacionesPort** (coordenadas, tipos, secuencia) e **InventarioPort** (stock + descontar). Los pedidos se los inyecta **Integraciones** vía `PickingPort.crearPedidos` (Picking no conoce el ERP ni el transporte).

## Reglas de dominio
- **Recepción de pedidos:** **Integraciones** los trae del ERP (por API o archivo, según lo configure el cliente) y llama `PickingPort.crearPedidos(pedidos)`. Cada pedido trae: **cliente, ISBN, cantidad, dirección de destino**. (Contrato de campos por conector, en Integraciones.) Picking no agenda ni conoce el transporte.
- **Dirección de destino:** se usa **solo para el remito** (etiqueta de la caja). NO interviene en la ruta dentro del depósito ni dispara ruteo de reparto.
- **Decisión por línea (picking vs reserva):** si la cantidad pedida alcanza un **bulto/pallet entero** (según la equivalencia caja/pallet del producto) → levantar de **reserva** (ubicación tipo `pallet` en depósito); si no → de **picking**. Si picking no tiene stock suficiente → tomar de reserva y marcar **reposición** pendiente. (Consulta `InventarioPort.hayStockPara`.) Todo en el contexto del **depósito** del pedido (multi-depósito).
- **Ruta:** secuenciar las ubicaciones a visitar con heurística **serpentina (S-shape)** según las coordenadas/secuencia de Ubicaciones. **Alcanza con secuencia por ubicación** — NO resolver TSP exacto. Una ruta por pedido o por batch.
- **Batch (opcional):** agrupar varios pedidos en una sola recorrida. Al pickear se **separa por pedido** (cantidades por pedido) para no mezclar la mercadería.
- **Ejecución:** el pickeador recorre la ruta; en cada ubicación escanea el ISBN y confirma cantidad. Al confirmar, Picking llama `InventarioPort.descontar(...)`.
- **Remito:** al cerrar el pedido, generar remito/etiqueta (PDF) con cliente + dirección, para pegar en la caja.

## Estados del pedido
`Importado → En ruta → Pickeado → Cerrado (con remito)`. Cancelable. Todo cambio auditado.

## Puertos / eventos
- **Expone:** `PickingPort.crearPedidos(pedidos)` ← lo llama Integraciones para inyectar pedidos del ERP.
- **Consume:** `UbicacionesPort` (coords/tipos/secuencia), `InventarioPort` (stock/descontar).
- **Emite:** `pedido.pickeado`, `pedido.cerrado` → **Integraciones** los exporta al ERP por el conector/transporte elegido.

## Modelo de datos (`pick_*`)
- `pick_pedido`(nro, cliente_id, deposito, direccion, estado, batch_id?)
- `pick_linea`(pedido_id, producto, cantidad, origen[picking|reserva], ubicacion_codigo, cantidad_pickeada, estado)
- `pick_batch`(id, estado)
- `pick_ruta`(pedido_o_batch_id, secuencia: lista ordenada de ubicaciones)
- (la config de import de pedidos —conector/transporte/agenda— NO vive acá: es de `int_*` en Integraciones)

## API REST (`/api/v1/picking`)
- `GET /pedidos` (los pedidos entran por `PickingPort.crearPedidos`, no por endpoint de import)
- `POST /batch` (agrupar) · `GET /ruta/:id`
- `POST /lineas/:id/confirmar` (escaneo/cantidad → descuenta stock)
- `GET /pedidos/:id/remito` (PDF)
- `docs/openapi.yaml` *(la config de import vive en `/api/v1/integraciones`)*

## Frontend
- Lista de pedidos importados + armado/agrupado de **batch**.
- **Vista de ruta sobre el mapa de Ubicaciones** (reusa el editor visual, resaltando la secuencia a recorrer).
- **Picking guiado** (móvil): ubicación actual, ISBN esperado, cantidad, escaneo y confirmación.
- Generar/descargar **remito**.

## Método de trabajo (orden)
1. `pick_*` + migración. 2. `PickingPort.crearPedidos` (recibe pedidos de Integraciones). 3. Decisión picking/reserva (consulta `InventarioPort`). 4. Ruta serpentina (consulta `UbicacionesPort` coords). 5. Batch opcional. 6. Picking guiado + escaneo + `descontar`. 7. Remito PDF. 8. Eventos + API + frontend (incl. ruta sobre el mapa). 9. Tests. *(Traer/exportar pedidos del ERP lo hace Integraciones.)*

## Criterio de validación
Importar un pedido con 3 ISBN → el sistema decide por línea picking vs reserva → arma la ruta serpentina por ubicaciones → el pickeador confirma escaneando → el stock baja en Inventario → se genera el remito con la dirección. Batch: agrupar 2 pedidos en una recorrida y verificar que la mercadería queda separada por pedido.

## Qué NO hacer
- NO rutear el reparto/entrega: la dirección es solo para el remito.
- NO escribir stock directo: usar `InventarioPort.descontar`.
- NO resolver TSP exacto: la secuencia por ubicación (serpentina) alcanza.
- NO traer pedidos del ERP ni manejar transporte/agenda: eso es **Integraciones** (acá solo `crearPedidos` + eventos).
- NO FKs ni imports cruzados con otros módulos.
