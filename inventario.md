# MÓDULO 3 — Inventario (`inv_*`)

> Spec de UN módulo. Se construye **solo**. Va en `docs/modulos/inventario.md`. Depende del `CLAUDE.md` raíz.

## Objetivo
Ser la **única fuente de verdad del stock del WMS** (qué ISBN, cuánto, en qué ubicación, en qué estado), sincronizar **catálogo y stock con el sistema de gestión (ERP)**, **comparar stock ERP vs WMS**, y **exportar las devoluciones** procesadas al ERP. Cierra el circuito de Devoluciones: consume `devolucion.procesada` y da de alta el stock.

## Alcance
**Entra:** stock por (ISBN, ubicación, estado); movimientos de stock; **lógica de conciliación** ERP vs WMS; alta de stock (por devolución y por **recepción de proveedores**); y los **puertos** para que Integraciones le inyecte datos externos.
**No entra:** hablar con el ERP / transporte / agenda (eso es **Integraciones**); armado de pedidos/ruta (Picking); mapa del depósito (Ubicaciones); control de devoluciones (Devoluciones).

## Aislamiento (duro)
- Tablas `inv_`. **Sin FKs cruzadas.**
- Consume `core` (catálogo, auditoría), **UbicacionesPort** (validar ubicaciones/tipos) y eventos de Devoluciones. Toda charla con el ERP pasa por `integracion-wms`.
- Otros módulos tocan el stock SOLO por `InventarioPort` (abajo). **Inventario es el único que escribe stock.**

## Reglas de dominio
- **Stock = (producto, depósito, ubicación, estado)** con cantidad. Estado: `vendible` | `dañado` | `cuarentena`. Todo cambio genera un `inv_movimiento` (entrada/salida/ajuste) auditado.
- **Unidades:** el stock se guarda en **unidad base**; se carga/muestra/descuenta por unidad, caja o pallet usando las equivalencias del producto (`core_producto`). **Multi-depósito:** el stock siempre vive en un depósito (vía la ubicación). Ver *Decisiones de modelo* en `CLAUDE.md`.
- **Alta por devolución:** al recibir `devolucion.procesada`, suma stock — buenos como `vendible` en la ubicación destino vendible, malos como `dañado`/`cuarentena` en su destino. (El destino lo trae el evento; las ubicaciones ya vienen validadas por Devoluciones.)
- **Salida por picking:** Picking confirma y llama `InventarioPort.descontar(...)`; Inventario baja el stock. Picking no escribe stock.
- **Import catálogo y stock (los trae Integraciones):** Integraciones obtiene los datos del ERP y llama a los puertos — `CatalogoPort.upsert(...)` (catálogo) e `InventarioPort.cargarSnapshotERP(...)` (stock, snapshot guardado en `inv_stock_erp`). Inventario **no** sabe si vino por API o archivo, ni agenda nada (el job nocturno lo dispara Integraciones).
- **Comparación ERP vs WMS:** lógica **de Inventario**. Compara, **por ISBN**, el total del último snapshot ERP contra la suma del stock WMS vendible; produce `inv_conciliacion` con la diferencia. Drill-down a ubicaciones. *(Asumido: por ISBN total; confirmar si también por ISBN+ubicación.)*
- **Export de devoluciones:** NO lo hace Inventario. Lo hace **Integraciones** suscripto a `devolucion.procesada`. Inventario solo da de alta el stock con ese mismo evento.

## Puerto público
`InventarioPort` (en `docs/contratos/`):
- `stockPorISBN(isbn)` · `stockPorUbicacion(codigo)` · `hayStockPara(isbn, cantidad, tipoUbicacion): boolean`
- `descontar(isbn, ubicacion, cantidad, estado)` ← lo llama Picking
- `ingresar(isbn, ubicacion, cantidad, estado, origen)` ← alta de stock; lo llama **Recepción** (putaway) y se usa internamente al procesar devoluciones
- `cargarSnapshotERP(items)` ← lo llama Integraciones (stock nocturno del ERP)

## Eventos
- **Consume:** `devolucion.procesada`.
- **Emite:** `stock.ajustado`, `inventario.conciliado` (otros pueden suscribirse; nadie obligado).

## Modelo de datos (`inv_*`)
- `inv_stock`(producto, deposito, ubicacion_codigo, estado, cantidad)  // cantidad en **unidad base**; depósito vía ubicación (multi-depósito)
- `inv_movimiento`(tipo, producto, deposito, ubicacion, cantidad, estado, origen[devolucion|recepcion|picking|ajuste|import], ref, fecha; lote/serie reservado)
- `inv_stock_erp`(isbn, cantidad, fecha_snapshot)
- `inv_conciliacion`(isbn, stock_erp, stock_wms, diferencia, fecha)
- (la config de transporte/agenda NO vive acá: es de `int_*` en Integraciones)

## API REST (`/api/v1/inventario`)
- `GET /stock?isbn=` · `GET /stock?ubicacion=` · `GET /conciliacion?fecha=`
- `POST /conciliacion/correr` (recalcular)
- `docs/openapi.yaml`
- *(los disparos de import/export y su configuración están en `/api/v1/integraciones`)*

## Frontend
- Grilla de **stock por ubicación** (TanStack Table v8).
- **Reporte de conciliación** ERP vs WMS, vistoso (diferencias resaltadas, KPIs, drill-down a ubicaciones).
- Config de **jobs** (intervalo, modo api/archivo, activar) + botones de import/export manual.

## Método de trabajo (orden)
1. `inv_stock` + `inv_movimiento` + migración. 2. `InventarioPort` (incl. `cargarSnapshotERP`, `descontar`) + tests. 3. Consumir `devolucion.procesada` (alta de stock). 4. Guardar snapshot ERP (`inv_stock_erp`) vía `cargarSnapshotERP`. 5. Conciliación + reporte. 6. API + frontend. 7. Tests. *(El import/export y su agenda los provee Integraciones llamando estos puertos / consumiendo los eventos.)*

## Criterio de validación
Procesar una devolución → el stock sube en la ubicación destino (vendible/dañado). Cargar un snapshot ERP por `cargarSnapshotERP` → la conciliación muestra las diferencias por ISBN, con drill-down a ubicaciones. Picking llama `descontar` y el stock baja. *(El sync nocturno y el export se validan en Integraciones.)*

## Qué NO hacer
- NO armar pedidos/ruta (eso es Picking).
- NO que otro módulo escriba stock: solo Inventario, vía `InventarioPort`.
- NO validar ubicaciones a mano: usar `UbicacionesPort`.
- NO hablar con el ERP ni manejar transporte/agenda: eso es **Integraciones** (acá solo puertos + eventos).
- NO FKs ni imports cruzados con otros módulos.
