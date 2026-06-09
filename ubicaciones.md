# MÓDULO 2 — Ubicaciones (`ubi_*`)

> Spec de UN módulo. Se construye **solo**, sin tocar otros módulos. Va en `docs/modulos/ubicaciones.md`.
> Depende del `CLAUDE.md` raíz (stack, políticas, arquitectura modular). Repetimos acá solo lo propio del módulo.

## Por qué módulo por módulo
Cada módulo del WMS tiene su propio archivo como este. Se desarrolla y se valida **aislado**, contra sus contratos (puertos/eventos), sin imports cruzados ni FKs cruzadas. Así "ir de a uno": terminás Ubicaciones, lo validás, y recién ahí arranca el próximo. Cuando me pases la operatoria de un módulo nuevo, te genero su archivo equivalente.

## Objetivo
Modelar y administrar el **mapa del depósito**: el árbol de ubicaciones, su **tipo** (qué módulo la usa), sus atributos, y la operación de **dividir** una ubicación en otras más chicas. Incluye un **editor visual 2D** (lo que valida el prototipo) y expone a otros módulos qué ubicaciones pueden usar.

## Alcance
**Entra:** árbol de ubicaciones (CRUD), tipos, atributos (capacidad, dimensiones, coordenadas del mapa), subdivisión, activar/desactivar, editor visual 2D (dibujar/mover/pintar por tipo/dividir/inspeccionar), carga masiva por API/Excel, y el **puerto** que consumen otros módulos.
**No entra:** stock real dentro de las ubicaciones (eso es de Inventario/Picking), recorridos de picking, ni 3D (futuro).

## Aislamiento (duro)
- Tablas con prefijo `ubi_`. **Sin FKs hacia/desde otros módulos.**
- Nada fuera de Ubicaciones importa código interno de este módulo: se accede SOLO por `UbicacionesPort` (abajo) y por eventos.
- Devoluciones (módulo 1) ya tiene sembrado `UbicacionResolverPort`: este módulo provee la implementación real, **sin tocar Devoluciones**.

## Modelo de datos
**`ubi_ubicacion`** — árbol recursivo de profundidad libre:
- `id` (pk)
- `parent_id` (fk a `ubi_ubicacion`, nullable) → raíz si null
- `codigo` (string, único por depósito; ej. `B-01-03`)
- `nivel_semantico` (enum: `zona | pasillo | rack | nivel | bin | celda` — informativo, no fija la profundidad)
- `tipos` (set/array: `picking | pallet | devoluciones | staging | recepcion | cuarentena | dañados`) → **una ubicación puede tener más de un tipo**
- `capacidad` (int, en unidades o HUs) · `peso_max` (decimal, opcional) · `volumen_max` (opcional)
- `atributos` (JSON: tipos de unidad permitidos, temperatura, secuencia de picking, etc.)
- `coords` (JSON `{x,y,w,h}` para el editor 2D)
- `contenedor` (bool) → true cuando fue subdividida: NO almacena stock directo, lo hacen sus hijas
- `activa` (bool)
- timestamps + auditoría (vía `core`)

**`ubi_plano`** — plano visual (lienzo) por depósito. Cada ubicación pertenece a un **depósito** (`core_deposito`, transversal — el sistema es **multi-depósito**). Las ubicaciones cuelgan de un depósito.

## Reglas de dominio
- **Tipo = qué módulo la usa.** Picking consumirá tipo `picking`; Devoluciones, tipo `devoluciones`; etc. El set de tipos es la fuente de verdad de la relación módulo↔ubicación.
- **Dividir (subdivisión / "bin sectioning"):** operación que recibe `(ubicacion, filas, columnas)` → crea `filas*columnas` hijas que mosaican el área, hereda tipo y reparte capacidad, y marca al padre como `contenedor=true`. Si una hija se borra y el padre queda sin hijas, el padre vuelve a `contenedor=false`. Todo el cambio va a **auditoría**.
- **No se puede** almacenar/asignar stock a un `contenedor` (solo a sus hojas).
- **Código único** dentro del depósito; las hijas heredan prefijo del padre (`B-01` → `B-01-01`).
- Borrar una ubicación borra su subárbol (con confirmación), auditado.

## Puerto público (lo que otros módulos consumen)
`UbicacionesPort` (en `docs/contratos/`), implementación dentro de este módulo:
- `existe(codigo): boolean`
- `resolver(codigo): { id, codigo, tipos, activa, contenedor } | null`
- `listarPorTipo(tipo): Ubicacion[]`
- `esValidaPara(codigo, tipo): boolean`  → true si la ubicación está activa, no es contenedor y tiene ese tipo

**Conexión con Devoluciones:** la implementación de `UbicacionResolverPort` de Devoluciones pasa a delegar en `UbicacionesPort.esValidaPara(codigo, 'devoluciones')`. Cambio aislado a un solo archivo adaptador en Devoluciones; el resto del módulo 1 no se toca.

## Eventos
- `ubicacion.creada` · `ubicacion.dividida` · `ubicacion.desactivada` (otros módulos pueden suscribirse; hoy nadie obligado a hacerlo).

## API REST (`/api/v1/ubicaciones`)
- `GET /depositos/:id/arbol` → árbol completo (para el mapa)
- `POST /` · `PATCH /:id` · `DELETE /:id`
- `POST /:id/dividir` `{filas, columnas}`
- `POST /import` (bulk: API o Excel) — autogenerar estructura
- `GET /?tipo=picking` — consumo por otros módulos
- Documentar todo en `docs/openapi.yaml`.

## Editor visual 2D (frontend)
- **react-konva** (canvas) sobre el stack del proyecto. Funciones del prototipo, ya validadas: dibujar/mover ubicaciones, snap a grilla, pintar por **tipo** (color), seleccionar para editar atributos, **dividir** en celdas, zoom/pan, leyenda con filtro por tipo, y export del árbol.
- Patrones de producción: snap con `dragBoundFunc`, `Transformer` (resize) en capa de UI aparte, sincronizar a estado React solo en `onDragEnd`/`onTransformEnd`.
- Al lado del mapa, grilla de ubicaciones con **TanStack Table v8** (orden por cualquier columna, columnas dinámicas, menú contextual). Marca de Grupal según `CLAUDE.md`.
- Responsive: en celular, mapa arriba y panel/grilla abajo (como el prototipo).

## Método de trabajo (orden)
1. `ubi_deposito` + `ubi_ubicacion` (Prisma) + migración. 2. CRUD + árbol. 3. Operación **dividir** + reglas de contenedor + auditoría. 4. `UbicacionesPort` + eventos + tests del puerto. 5. Enchufar `UbicacionResolverPort` de Devoluciones al puerto (1 archivo). 6. API + OpenAPI. 7. Import masivo. 8. Editor 2D (react-konva) + grilla. 9. Tests del módulo + integración del seam.

## Criterio de validación
- Crear un rack, dividirlo en 2×3 → 6 hijas, padre = contenedor, suma de capacidades coherente, todo en auditoría.
- Marcar una ubicación como `devoluciones` y verificar que, desde Devoluciones, `esValidaPara(codigo,'devoluciones')` da true y una de tipo `picking` da false — **sin haber modificado la lógica de Devoluciones**, solo el adaptador.
- Importar N ubicaciones por Excel y verlas en el mapa.

## Qué NO hacer
- NO FKs ni imports cruzados con otros módulos (solo puerto/eventos).
- NO permitir stock en contenedores.
- NO meter lógica de picking/inventario acá.
- NO romper el contrato `UbicacionesPort` sin documentarlo en `docs/contratos/`.
