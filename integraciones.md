# MÓDULO PLATAFORMA — Integraciones (`int_*`)

> Spec de UN módulo. Se construye **solo**. Va en `docs/modulos/integraciones.md`. Depende del `CLAUDE.md` raíz.
> Es un **módulo de plataforma transversal** (como `core`): el ÚNICO que habla con sistemas externos. Se construye **antes del primer sync externo** (antes de Inventario).

## Objetivo
Punto único donde se **construyen, configuran y operan las integraciones** con sistemas externos (ERP, WMS, otros). **Multi-conector**: se van sumando integraciones distintas y **el cliente elige cuál usar** en cada flujo, sin tocar los módulos de dominio. Maneja el transporte (API/archivo), la agenda (cron), el mapeo de campos y la observabilidad (logs/reintentos). Traduce entre los **contratos de dominio del WMS** y cada sistema externo.

## Conceptos
- **Conector:** una integración concreta con un sistema externo (ej. "ERP del cliente", "WMS X", "CSV genérico"). Define autenticación/endpoints o formato de archivo + mapeo de campos. **Agregar un conector nuevo no toca ningún módulo de dominio.**
- **Flujo:** una corriente de datos con dirección. **Inbound** (externo→WMS): catálogo, stock, pedidos, **órdenes de compra/remitos**. **Outbound** (WMS→externo): export de devoluciones, confirmaciones de picking, recepciones cerradas, conciliaciones.
- **Elección del cliente:** para cada flujo, el cliente elige el **conector activo**, el **transporte** (API o archivo) y la **frecuencia**. Puede haber varios conectores instalados y convivir.

## Alcance
**Entra:** abstracción de conectores y flujos; **transporte dual API/archivo (CSV/Excel)**; **tareas programadas (cron, `@nestjs/schedule`)** con intervalo configurable (stock ERP nocturno); mapeo de campos externo↔dominio; ejecución inbound (llama puertos de dominio) y outbound (consume eventos de dominio); logs de corridas, reintentos y panel de administración.
**No entra:** lógica de dominio (stock, picking, devoluciones, ubicaciones). Integraciones solo **mueve y traduce datos**; las reglas viven en cada módulo.

## Aislamiento (duro)
- Tablas `int_`. **Es el único módulo que conoce sistemas externos** (auth, endpoints, formatos).
- Los módulos de dominio **NO saben** qué ERP es, ni si es API o archivo: solo exponen **puertos** y emiten **eventos**. Integraciones depende de esos contratos; el dominio no depende de Integraciones.
- **Sin FKs cruzadas.**

## Cómo funciona
- **Inbound:** el scheduler dispara el flujo → el conector obtiene los datos (API o archivo) → Integraciones los **mapea a DTO de dominio** → llama al **puerto del módulo destino**:
  - catálogo → `CatalogoPort.upsert(items)`
  - stock ERP → `InventarioPort.cargarSnapshotERP(items)`
  - OC/remito → `RecepcionPort.crearRecepcion(documento)`
  - pedidos → `PickingPort.crearPedidos(pedidos)`
- **Outbound:** Integraciones se **suscribe a eventos de dominio** → mapea al formato del conector → envía por API o archivo:
  - `devolucion.procesada` → export de devoluciones al ERP
  - `recepcion.cerrada` → confirmación de recepción al ERP
  - `pedido.cerrado` → confirmación al ERP
  - `inventario.conciliado` → reporte al ERP (si se quiere)
- **Contratos** (puertos + eventos) viven en `docs/contratos/` y son estables.

## Modelo de datos (`int_*`)
- `int_conector`(nombre, sistema, transporte[api|archivo], config[auth/endpoints/ruta/credenciales-ref], activo)
- `int_flujo`(flujo[catalogo|stock|pedidos|ordenes_compra|export_devoluciones|confirmacion_picking|recepcion_cerrada|...], direccion[in|out], conector_id, intervalo_cron, activo)
- `int_mapeo`(flujo_id, campo_externo, campo_dominio, transformacion)
- `int_corrida`(flujo_id, conector, inicio, fin, estado[ok|error], registros, detalle_error)

## API REST (`/api/v1/integraciones`)
- CRUD de **conectores** (alta, configurar, **probar conexión**, activar)
- CRUD de **flujos** (elegir conector, transporte, frecuencia, activar)
- CRUD de **mapeos**
- Disparo **manual** de un flujo · `GET /corridas` (historial y errores)
- `docs/openapi.yaml`

## Frontend
- Panel de **integraciones**: conectores disponibles, activar/configurar, **probar conexión**.
- Asignar **conector + transporte + frecuencia** a cada flujo (lo elige el cliente).
- **Historial de corridas** con éxito/error, registros procesados y reintentos; disparo manual.

## Método de trabajo (orden)
1. Modelo `int_*` + migración. 2. Abstracción `Conector` + `Flujo` + scheduler (`@nestjs/schedule`). 3. Transporte **API**. 4. Transporte **archivo** (CSV/Excel). 5. Mapeo de campos. 6. Inbound → puertos de dominio. 7. Outbound ← eventos de dominio. 8. Logs/reintentos + panel. 9. **Primer conector real** (el ERP del cliente, con sus datos). 10. Tests (incluido cambiar el conector activo de un flujo sin tocar el dominio).

## Criterio de validación
Instalar 2 conectores; asignar el flujo "stock" a uno por **API nocturno** y "pedidos" a otro por **archivo**; correr y ver corridas OK en el historial. Cambiar el conector activo de "pedidos" **sin tocar Picking**. Un evento `devolucion.procesada` se exporta por el conector elegido (API y archivo, según config). "Probar conexión" reporta bien éxito/falla.

## Qué NO hacer
- NINGÚN módulo de dominio habla con sistemas externos ni sabe de API/archivo: **todo pasa por Integraciones**.
- NO hardcodear un ERP/WMS puntual: todo es **conector configurable**; el cliente elige.
- NO meter lógica de dominio acá: solo mover/traducir datos.
- NO guardar credenciales en tablas/código: van por variables de entorno, referenciadas desde `int_conector`.
- NO FKs ni imports cruzados con otros módulos.
