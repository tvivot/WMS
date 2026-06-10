# MÓDULO 1 — Devoluciones (`dev_*`)

> Spec de UN módulo. Se construye **solo**, sin tocar otros. Va en `docs/modulos/devoluciones.md`.
> Depende del `CLAUDE.md` raíz (stack, políticas, arquitectura modular). Acá va el dominio propio del módulo.

## Objetivo
Gestionar la **devolución de libros desde los clientes hacia el depósito**: solicitud → aprobación → carga/despacho del cliente → recepción → ingreso → control bulto por bulto → cierre con reconciliación. Front del cliente (escanear/declarar/despachar) y consola de depósito (recibir/ingresar/controlar/cerrar).

## Alcance
**Entra:** autorizaciones + máquina de estados, RBAC del flujo, escaneo de ISBN, declaración del cliente (bultos/peso/transportista), recepción (bultos vs declarados), ingreso (ubicación de espera), control por bulto (cantidad + buen/mal estado), reconciliación por ISBN, **cierre del circuito** (destino de la mercadería), informes y la API/eventos del módulo.
**No entra:** **gestión de stock/inventario**. Devoluciones controla y **entrega el resultado** (qué llegó bueno/malo y a qué ubicación va); mover y sumar stock real es de un futuro módulo Inventario/Picking. Tampoco maneja el mapa del depósito (eso es Ubicaciones).

## Aislamiento (duro)
- Tablas con prefijo `dev_`. **Sin FKs hacia/desde otros módulos.**
- Consume `core` (usuarios, permisos, auditoría, clientes, catálogo de libros, transportistas) y, para ubicaciones, **solo** `UbicacionResolverPort` (hoy texto libre; mañana delega en `UbicacionesPort`).
- Nada externo importa internos de Devoluciones: se accede por sus eventos / API.

## Roles y permisos (RBAC granular)
- **Roles:** Cliente, Vendedor, Gerencial, Depósito, Administrador.
- Permisos del flujo: `solicitud.crear`, `solicitud.aprobar`, `deposito.recibir`, `deposito.ingresar`, `deposito.controlar`, `informes.ver`.
- Crear solicitud: Cliente / Vendedor / Gerencial. **Aprobar: quien tenga `solicitud.aprobar`** (asignable a vendedor/gerencia/admin, no hardcodeado).
- **Acceso del cliente:** login con **número de cliente + clave generada** por el sistema (alta y reseteo por un usuario interno; entrega manual, sin email). **Cambio de clave obligatorio en el primer ingreso.** El cliente ve **solo sus propias devoluciones**.

## Máquina de estados
`A Aprobar → Aprobado → En tránsito → Entregado → Ingreso a depósito → Procesado`
- **A Aprobar:** solicitud creada por `solicitud.crear`. Siempre ligada a un `cliente`; guarda `creado_por`.
- **Aprobado:** la autoriza `solicitud.aprobar`. Recién acá el cliente carga.
- **En tránsito:** el cliente cargó (libros + bultos + peso total + transportista) y despachó.
- **Entregado:** llegó; Depósito registra **bultos recibidos** (vs declarados).
- **Ingreso a depósito:** Depósito registra la **ubicación de espera** (vía puerto; tipo `devoluciones`/`staging`).
- **Procesado:** Depósito cerró el control de **todos** los bultos → se calcula la reconciliación, se registra el **destino** (ver cierre) y se **emite `devolucion.procesada`**.

No se saltean estados. Cada transición valida **permiso** y queda en **auditoría** (quién, cuándo, origen→destino).

## Reglas de dominio
**Bultos y peso**
- El cliente declara **cantidad de bultos** y **peso total**. En depósito se **pesa cada bulto**; la suma debe igualar el total.
- Diferencia de peso → NO bloquea, **exige observación**. Bultos recibidos ≠ declarados → **observación + registrar la cantidad real recibida** (esa es la que se controla).

**Catálogo y escaneo**
- "Número de serie" = **ISBN** (EAN-13; normalizar ISBN-10/13): identifica un **título**, no una copia → solo cantidades por título.
- Al escanear muestra el **título**; cantidad arranca en 1; reescanear el mismo ISBN **autosuma**; o cantidad directa. ISBN no catalogado → avisar, no crear línea fantasma.

**Control y reconciliación**
- El cliente puede **mezclar un ISBN en varios bultos**: el control es **bulto por bulto**, la reconciliación **agrega por ISBN sobre todos los bultos**.
- Por defecto los libros quedan **"para la venta"**; el operario carga la **cantidad en mal estado**; buen estado = recibido − mal estado.
- **Procesado** exige **todos** los bultos controlados. Por ISBN: recibido vs declarado (faltante/sobrante) y buen/mal estado.

**Cierre del circuito — destino de la mercadería procesada** *(NUEVO)*
- Al pasar a Procesado, los libros **en buen estado** van a una ubicación vendible (tipo `picking`/`pallet`) y los **en mal estado** a `dañados`/`cuarentena`.
- Devoluciones **registra** las ubicaciones destino (bueno y malo), validadas por `UbicacionResolverPort.esValidaPara(codigo, tipo)`, y **emite `devolucion.procesada`** con el resultado por ISBN (bueno/malo + destinos).
- **El alta de stock real NO la hace Devoluciones** — la hará Inventario cuando exista, consumiendo el evento. Mientras tanto, queda el registro y el seam listos.

**Reapertura / corrección** *(default)*
- Una devolución en **Procesado NO se reabre**. Cualquier corrección posterior la hace solo un **Administrador** y queda en **auditoría**.
- Las diferencias (bultos/peso/conteo) se registran con **observación**: no bloquean ni requieren aprobación extra.

**Dos ubicaciones, no una** *(NUEVO)*
- **Ubicación de espera:** dónde aguardan los bultos mientras se controlan (Ingreso a depósito) → valida contra tipo `devoluciones`/`staging`.
- **Ubicación destino:** dónde terminan los libros ya controlados (cierre) → valida contra `picking`/`pallet`/`dañados`/`cuarentena`.
- Ambas pasan por `UbicacionResolverPort`; ningún string de ubicación suelto.

## Puerto consumido
`UbicacionResolverPort` (en `docs/contratos/`):
- `esValidaPara(codigo, tipo): boolean` · `existe(codigo): boolean`
- **Implementación actual:** acepta texto libre (devuelve true si no vacío).
- **Cuando exista Ubicaciones:** delega en `UbicacionesPort.esValidaPara(...)`. Cambio en **un solo archivo adaptador**, sin tocar el resto de Devoluciones.

## Eventos emitidos
- `devolucion.estado_cambiado` (en cada transición) · `devolucion.procesada` (resultado por ISBN + destinos).
- **Contrato único:** estos mismos eventos son los que consume la **integración WMS** y los futuros módulos internos. Se documentan una vez en `docs/contratos/`; no duplicar.

## Modelo de datos (`dev_*`)
- `dev_autorizacion`(id, estado, cliente_id, creado_por, transportista_id, bultos_declarados, peso_total_declarado, bultos_recibidos, **ubicacion_espera**, **ubicacion_destino_bueno**, **ubicacion_destino_malo**, observaciones, timestamps)
- `dev_declaracion`(autorizacion_id, isbn, cantidad)
- `dev_bulto`(autorizacion_id, numero, peso, estado_control)
- `dev_control`(bulto_id, isbn, cantidad, mal_estado)
- (referencias a cliente/usuario/libro/transportista/ubicación son por **ID/código**, sin FK cruzada a otros módulos)

## API REST (`/api/v1/devoluciones`)
- CRUD de autorizaciones + transiciones de estado (con validación de permiso)
- Escaneo/declaración, recepción, ingreso, control, cierre
- Eventos salientes + `docs/openapi.yaml`

## Frontend
- **Portal cliente:** ver autorizaciones aprobadas, escanear (cámara/USB), declarar bultos/peso/transportista, despachar.
- **Consola depósito:** recepción, ingreso (ubicación espera), control por bulto (buen/mal estado), cierre con destino.
- Grillas con TanStack Table v8; marca Grupal según `CLAUDE.md`.

## Método de trabajo (orden)
1. `dev_*` (Prisma) + migración. 2. Máquina de estados + permisos por transición. 3. Crear/aprobar solicitud. 4. Flujo cliente (escaneo/declaración/despacho). 5. Recepción. 6. Ingreso (ubicación espera vía puerto). 7. Control por bulto. 8. Reconciliación. 9. **Cierre + destino + evento `devolucion.procesada`**. 10. API + OpenAPI + eventos. 11. Frontend. 12. Tests del módulo + del seam de ubicación.

## Criterio de validación
Vendedor crea solicitud para Cliente X → se aprueba → cliente escanea 3 ISBN, declara 2 bultos/10 kg, despacha → Depósito recibe 2 bultos, pesa 6+4=10, ingresa a ubicación de **espera** `DEV-01` → controla cada bulto (1 en mal estado) → cierra: buenos a `A-01` (picking), malo a `DAN-01` (dañados), ambas validadas por el puerto → **Procesado**, reconciliación correcta por ISBN, evento `devolucion.procesada` emitido, todo en auditoría. Test extra: cambiar la implementación del `UbicacionResolverPort` por una falsa de "ubicaciones" sin tocar Devoluciones.

## Futuro (opcionales, NO ahora)
- Subdividir la zona de devoluciones y asignar cada bulto a una **celda** (usando el árbol de Ubicaciones) para saber físicamente dónde está cada bulto.
- **Vista en el mapa** de bultos pendientes de control (reusa el editor visual de Ubicaciones).

## Qué NO hacer
- NO mover ni sumar **stock/inventario** dentro de Devoluciones: solo registrar destino y **emitir el evento**.
- NO acoplar ubicaciones a strings sueltos: todo por `UbicacionResolverPort`.
- NO saltear estados ni permitir Procesado con bultos sin controlar.
- NO bloquear por diferencias de peso/bultos: observación.
- NO FKs ni imports cruzados con otros módulos.
