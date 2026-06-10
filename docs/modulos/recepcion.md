# MÓDULO 4 — Recepción de mercadería (`rec_*`)

> Spec de UN módulo. Se construye **solo**. Va en `docs/modulos/recepcion.md`. Depende del `CLAUDE.md` raíz.

## Objetivo
Registrar el **ingreso de mercadería nueva de editoriales/proveedores**: importar la **orden de compra / remito** con lo que va a entrar y, al llegar, correr el **circuito completo con estados y controles** de recepción, terminando en el **guardado (putaway)** que da de alta el stock. Es el espejo de entrada de Picking y el hermano de Devoluciones (entra del proveedor en vez del cliente).

## Alcance
**Entra:** recepción del documento (OC/remito) que inyecta Integraciones; máquina de estados de la recepción; **control de lo recibido** (cantidad y estado) contra lo declarado; **putaway** (asignar ubicaciones + alta de stock).
**No entra:** traer el documento del ERP / transporte (eso es **Integraciones**); el stock en sí (Inventario); el mapa del depósito (Ubicaciones); la gestión de compras/negociación con el proveedor (sistema de gestión).

## Aislamiento (duro)
- Tablas `rec_`. **Sin FKs cruzadas.**
- Consume `core` (catálogo, auditoría), **UbicacionesPort** (validar ubicaciones de guardado) e **InventarioPort** (alta de stock en putaway). El documento entra por **`RecepcionPort.crearRecepcion`** desde Integraciones.

## Máquina de estados
`Esperada → En recepción → Controlada → Ingresada (putaway) → Cerrada`
- **Esperada:** se importó la OC/remito; el depósito ya sabe **qué y cuánto** va a llegar.
- **En recepción:** llegó la mercadería; el operario empieza el control.
- **Controlada:** control terminado — cantidades recibidas vs declaradas y estado (bueno/dañado) registrados; diferencias en observación.
- **Ingresada (putaway):** cada ítem asignado a una ubicación (vía puerto) y **stock dado de alta**.
- **Cerrada:** recepción finalizada; se puede **notificar al ERP** (evento → Integraciones).

No se saltean estados. Cada transición valida **permiso** y queda en **auditoría**.

## Reglas de dominio
- **Control vs declarado:** por ISBN, cantidad recibida vs declarada en la OC/remito (faltante/sobrante). La diferencia **NO bloquea** pero **exige observación** (igual criterio que Devoluciones).
- **Estado de la mercadería:** **bueno** (vendible) o **dañado**; lo dañado va a su destino (no vendible).
- **Putaway:** cada línea se guarda en una ubicación validada por `UbicacionesPort.esValidaPara(codigo, tipo)` (tipo `recepcion`/`pallet`/`picking` según corresponda) y se da de alta con `InventarioPort.ingresar(...)`.
- **Cierre:** una recepción solo pasa a **Cerrada** cuando todo lo recibido está **controlado y guardado**.
- (Opcional, si manejás bultos en la recepción) control bulto por bulto, igual que Devoluciones.
- **Transversal:** la recepción ocurre en un **depósito** (multi-depósito) y las cantidades pueden venir/cargarse por **unidad, caja o pallet** (se convierten a unidad base al dar de alta). Ver *Decisiones de modelo* en `CLAUDE.md`.

## Puerto público
`RecepcionPort` (en `docs/contratos/`):
- `crearRecepcion(documento)` ← lo llama **Integraciones** al importar la OC/remito (nro doc, tipo, proveedor, líneas: ISBN + cantidad declarada).

## Eventos
- **Emite:** `recepcion.cerrada` (Integraciones puede notificar/confirmar al ERP).
- No consume eventos de otros módulos.

## Modelo de datos (`rec_*`)
- `rec_recepcion`(id, nro_documento, tipo_doc[orden_compra|remito], proveedor, deposito, estado, fecha, observaciones)
- `rec_linea_esperada`(recepcion_id, producto, cantidad_declarada, unidad[unidad|caja|pallet])
- `rec_control`(recepcion_id, producto, cantidad_recibida, cantidad_dañada, unidad, observacion)
- `rec_putaway`(recepcion_id, producto, ubicacion_codigo, cantidad, estado)  // alta en unidad base
- (referencias a proveedor/libro/ubicación por ID/código; sin FK cruzada)

## API REST (`/api/v1/recepciones`)
- `GET /` (esperadas y en curso) · `GET /:id`
- Transiciones de estado (con validación de permiso)
- `POST /:id/control` (cargar lo recibido) · `POST /:id/putaway` (asignar ubicaciones)
- `docs/openapi.yaml` *(el import de la OC/remito se dispara desde `/api/v1/integraciones`)*

## Frontend
- Lista de recepciones **esperadas** y en curso.
- Pantalla de **control**: escaneo de ISBN, cantidad recibida, cantidad dañada, observaciones; comparación contra lo declarado.
- Pantalla de **putaway**: asignar ubicaciones (puede apoyarse en el mapa de Ubicaciones).
- Cierre. Grillas con TanStack Table v8; marca Grupal.

## Método de trabajo (orden)
1. `rec_*` + migración. 2. `RecepcionPort.crearRecepcion` (recibe la OC/remito de Integraciones). 3. Máquina de estados + permisos. 4. Control vs declarado (cantidad/estado + observaciones). 5. Putaway → `UbicacionesPort` + `InventarioPort.ingresar`. 6. Cierre + evento `recepcion.cerrada`. 7. API + frontend. 8. Tests del módulo.

## Criterio de validación
Importar una OC con 3 ISBN → **Esperada**. Llega la mercadería → **En recepción**; el operario controla (1 unidad dañada, 1 faltante registrado en observación) → **Controlada**. Putaway a ubicaciones validadas por el puerto → el stock sube en Inventario (`ingresar`) → **Ingresada**. Cerrar → **Cerrada** y se emite `recepcion.cerrada`. Test: cambiar la implementación de los puertos por dobles de prueba sin tocar Recepción.

## Qué NO hacer
- NO traer la OC/remito del ERP ni manejar transporte/agenda: eso es **Integraciones** (acá solo `crearRecepcion`).
- NO escribir stock directo: usar `InventarioPort.ingresar`.
- NO validar ubicaciones a mano: usar `UbicacionesPort`.
- NO bloquear por diferencias de cantidad/estado: se registran con observación.
- NO gestionar compras/proveedores (eso es del sistema de gestión).
- NO FKs ni imports cruzados con otros módulos.
