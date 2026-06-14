# CLAUDE.md — WMS Grupal · Módulo de Devolución de Libros

> Archivo de reglas del proyecto. Va en la **raíz** del repo. Claude Code lo relee en cada sesión.
> Lo que se decide acá no se vuelve a preguntar ni a romper.

## Objetivo
Primer módulo de un **WMS propio que se construye por módulos**: gestión de **devolución de libros desde los clientes hacia el depósito** (front del cliente para escanear/declarar/despachar; consola de depósito para recibir/ingresar/controlar). Tiene API propia para integrarse a un WMS y está diseñado para que **los próximos módulos (Ubicaciones, Picking) se sumen sin romper este**.

## Stack
- **Backend:** Node.js + TypeScript + **NestJS** + **Prisma** (ORM).
- **Base de datos:** **MySQL/MariaDB** (la del plan Hostinger). NO PostgreSQL.
- **Frontend:** React + TypeScript + **Vite** + Tailwind + **shadcn/ui**, **PWA** (vite-plugin-pwa).
- **Grillas:** **TanStack Table v8** (+ shadcn/ui). Columnas dinámicas, orden por cualquier columna, ocultar/mostrar/agregar, menú contextual. Verificar versión vigente.
- **Informes:** Recharts (KPIs + gráficos, profesionales y vistosos).
- **Escaneo:** API nativa **BarcodeDetector** con **fallback ZXing** (`@zxing/browser` + `@zxing/library`). Lector **USB** = keyboard-wedge (modo de captura, sin librería).
- **Auth:** JWT + **RBAC granular** (roles = paquetes de permisos).
- **Hosting:** Hostinger **Business/Cloud** (Node.js gestionado), **deploy automático desde GitHub** (push a `main`).
- **Deployable único** (decisión de arquitectura): NestJS sirve la API en `/api` **y** el build de la PWA como estáticos. Un repo, una app Node. La **modularidad es a nivel de código** (monolito modular), no de despliegue: más simple para el deploy gestionado y suficiente para todo el WMS. Si algún módulo justifica separarse, los límites de módulo permiten extraerlo después sin reescribir.

---

## Arquitectura: MONOLITO MODULAR (clave del proyecto)
El WMS se construye por módulos con **límites duros**: tocar un módulo NO puede romper otro. Reglas no negociables:

1. **Un módulo no importa código interno de otro.** Se comunican SOLO por:
   - **Puertos (interfaces públicas)** que el módulo expone, y/o
   - **Eventos de dominio** (un módulo emite, otros se suscriben).
2. **Cada módulo es dueño de sus tablas**, con prefijo propio (`dev_*` devoluciones, `ubi_*` ubicaciones, `pick_*` picking, `core_*` transversal). **Sin foreign keys duras cruzadas entre módulos**: las relaciones cross-módulo se resuelven por ID + el puerto del otro módulo. Así una migración de un módulo no rompe a otro.
3. **Núcleo transversal (`core`)**, lo usan todos: auth, usuarios, **permisos/roles**, auditoría, países, transportistas y **catálogo de productos (libros: ISBN + título)** — porque productos los van a compartir devoluciones, picking, etc.
4. **Contratos estables.** Cambiar un puerto o evento es un cambio consciente y documentado en `docs/contratos/`. Cada módulo tiene sus tests; hay tests de integración para los seams.

### Roadmap de módulos
1. **Devoluciones** (`dev_*`) — circuito de devolución cliente→depósito.
2. **Ubicaciones** (`ubi_*`) — mapa del depósito; cada ubicación tiene **tipo** (`picking`/`pallet`/`devoluciones`/`staging`/`recepcion`/`cuarentena`/`dañados`) que define qué módulo la usa.
3. **Inventario** (`inv_*`) — stock por ubicación; **sync con el sistema de gestión (ERP)** (catálogo + stock nocturno); **comparación stock ERP vs WMS**; **export de devoluciones** al ERP. Consume `devolucion.procesada` para dar de alta stock.
4. **Recepción de mercadería** (`rec_*`) — importa la **OC/remito** del proveedor y corre el circuito de recepción (estados + control de cantidad/estado) hasta el **putaway** (alta de stock). Consume Ubicaciones + Inventario.
5. **Picking** (`pick_*`) — importa pedidos del ERP, decide picking vs bulto entero en reserva, arma **ruta secuenciada por ubicación**, genera remito. Consume Ubicaciones + Inventario.

Detalle de dominio de cada uno en `docs/modulos/<modulo>.md` (autoritativo).

**Plataforma — Integraciones** (`int_*`): módulo transversal de **conectores** con sistemas externos (ERP/WMS/otros), **multi-conector y elegible por el cliente** por flujo. Es el ÚNICO que habla con sistemas externos. Se construye **antes del primer sync externo** (antes de Inventario). Detalle en `docs/modulos/integraciones.md`.

### Seam de ubicaciones en Devoluciones (preparado para Ubicaciones)
Devoluciones usa **dos** ubicaciones, ambas detrás de la interfaz `UbicacionResolverPort` (nunca un string suelto):
- **Ubicación de espera** (Ingreso a depósito): dónde aguardan los bultos a controlar → tipo `devoluciones`/`staging`.
- **Ubicación destino** (cierre): dónde terminan los libros controlados → `picking`/`pallet` (buenos) y `dañados`/`cuarentena` (malos).
- **Implementación actual:** acepta texto libre. **Cuando exista Ubicaciones:** delega en `UbicacionesPort.esValidaPara(codigo, tipo)` — cambio en **un solo archivo adaptador**, sin tocar el resto de Devoluciones.

## Decisiones de modelo (cerradas)
Definidas de antemano porque cambiarlas tarde obliga a rehacer tablas. Aplican a todos los módulos.

1. **Multi-depósito.** El sistema soporta **varios depósitos** desde el día uno. `core_deposito` es entidad transversal; **ubicaciones, stock, recepciones y pedidos referencian un depósito**. Toda operación ocurre en el contexto de un depósito.
2. **Unidades y equivalencias.** El stock se guarda en **unidad base** (libro). Cada producto define **caja = N unidades** y **pallet = N cajas**. Se puede **cargar, controlar, pickear y mostrar por unidad, caja o pallet**, convirtiendo a unidad base internamente. La decisión "picking vs bulto entero" usa la equivalencia de caja/pallet.
3. **Identidad de producto.** El identificador maestro es un **código interno de producto** del WMS. Un producto puede tener **uno o varios ISBN** asociados (reimpresión, ISBN-10/13); los ítems **sin ISBN** (combos, promocional) se cargan con código interno y sin ISBN. El escaneo resuelve ISBN→producto; sin ISBN, se usa el código interno. (`core_libro` pasa a `core_producto`.)
4. **Lote / vencimiento / serie.** Hoy NO se usa (todo por título). El modelo deja un **campo opcional reservado** a nivel de movimiento de stock, **desactivado por defecto**, para no migrar tablas si en el futuro entra un producto que lo requiera.

## Estructura del proyecto
```
wms-grupal/
├─ CLAUDE.md
├─ package.json              # workspaces + scripts raíz (build / start / migrate)
├─ .env.example              # nombres de variables (NUNCA el .env real)
├─ apps/
│  ├─ api/                   # NestJS (monolito modular)
│  │  ├─ prisma/schema.prisma
│  │  └─ src/
│  │     ├─ core/                  # TRANSVERSAL
│  │     │  ├─ auth/               # login, JWT
│  │     │  ├─ usuarios/
│  │     │  ├─ permisos/           # RBAC granular (roles = paquetes de permisos)
│  │     │  ├─ auditoria/          # log de cambios de estado / acciones
│  │     │  ├─ paises/
│  │     │  ├─ depositos/          # multi-depósito (transversal)
│  │     │  ├─ transportistas/
│  │     │  └─ catalogo/           # productos: código interno + ISBN(s) + unidades (unidad/caja/pallet)
│  │     ├─ modulos/
│  │     │  ├─ devoluciones/       # MÓDULO 1
│  │     │  │  ├─ autorizaciones/  # cabecera + máquina de estados
│  │     │  │  ├─ declaracion/     # líneas declaradas por el cliente
│  │     │  │  ├─ bultos/          # peso por bulto, estado de control
│  │     │  │  ├─ control/         # control por bulto: cantidad, buen/mal estado
│  │     │  │  ├─ reconciliacion/  # declarado vs recibido por ISBN
│  │     │  │  ├─ informes/
│  │     │  │  └─ puertos/         # UbicacionResolverPort (seam), eventos
│  │     │  ├─ ubicaciones/        # MÓDULO 2 (árbol, tipos, dividir, mapa)
│  │     │  ├─ inventario/         # MÓDULO 3 (stock x ubicación, sync ERP, conciliación, export)
│  │     │  ├─ recepcion/          # MÓDULO 4 (OC/remito, control, putaway)
│  │     │  └─ picking/            # MÓDULO 5 (pedidos, ruta, remito)
│  │     ├─ integraciones/         # PLATAFORMA: conectores (ERP/WMS), flujos, transporte API+archivo, scheduler
│  │     │  ├─ conectores/         # un conector por sistema externo (elegible)
│  │     │  ├─ flujos/             # inbound (catálogo/stock/pedidos) + outbound (eventos)
│  │     │  └─ scheduler/          # tareas programadas (cron)
│  │     └─ static/                # sirve el build de apps/web
│  └─ web/                   # React PWA
│     └─ src/
│        ├─ portal-cliente/        # autorizaciones, escaneo, despacho
│        ├─ consola-deposito/      # recepción, ingreso, control, cierre
│        ├─ admin/                 # usuarios, roles/permisos, clientes, transportistas, catálogo
│        ├─ informes/
│        ├─ componentes/escaner/   # BarcodeDetector + ZXing + USB wedge
│        ├─ componentes/grilla/    # TanStack Table v8 reusable
│        └─ brand/                 # logo + tokens de marca
│     └─ public/                   # manifest.webmanifest, service worker, /brand/*
├─ packages/shared/                # tipos y contratos compartidos (DTOs, enums de estados)
└─ docs/
   ├─ openapi.yaml                 # contrato de la API (para el WMS)
   ├─ contratos/                   # puertos y eventos entre módulos
   ├─ modulos/                     # spec autoritativo de cada módulo (dominio)
   │  ├─ devoluciones.md
   │  ├─ ubicaciones.md
   │  ├─ inventario.md
   │  ├─ recepcion.md
   │  ├─ picking.md
   │  └─ integraciones.md          # módulo de plataforma (conectores)
   ├─ maquina-estados.md
   └─ modelo-datos.md
```

> **Dónde vive el detalle de dominio:** el `CLAUDE.md` raíz es la biblia transversal (stack, arquitectura, roles, deploy, políticas). El dominio específico de cada módulo es **autoritativo en `docs/modulos/<modulo>.md`**. Si hay diferencia, manda el archivo del módulo.

## Método de trabajo
Construir en este orden; cada paso queda **funcional y probado** antes de avanzar:
1. **`core` + esquema Prisma + migración inicial** (MySQL): usuarios, **permisos/roles**, auditoría, países, transportistas, catálogo. Tablas con prefijo `core_*`.
2. **Auth + RBAC granular** (ver Roles y permisos). Cliente loguea con `nro_cliente` + clave generada; internos con usuario + clave.
3. **Catálogo por API** (alta masiva de libros: ISBN + título) + ABM. Probar carga.
4. **Módulo Devoluciones — autorizaciones + máquina de estados** (tablas `dev_*`). Bloquear transiciones inválidas y validar permisos por transición.
5. **Flujo creación de solicitud:** la crea Cliente, Vendedor o Gerencial; queda en **A Aprobar**, siempre ligada a un Cliente.
6. **Aprobación:** quien tenga el permiso `solicitud.aprobar` (Vendedor/Gerencial/Admin) pasa a **Aprobado**.
7. **Flujo cliente:** ve autorizaciones aprobadas → escanea ISBN (autosuma / cantidad directa) → declara bultos + peso total + transportista → despacha (**En tránsito**).
8. **Recepción** (→ **Entregado**): comparar bultos recibidos vs declarados; observación obligatoria si difieren.
9. **Ingreso a depósito** (→ **Ingreso a depósito**): registrar ubicación **vía `UbicacionResolverPort`** (hoy texto libre).
10. **Control bulto por bulto:** escanear, cargar cantidad, marcar cantidad en mal estado (resto queda "para la venta"). Marcar bulto como controlado.
11. **Reconciliación + cierre** (→ **Procesado**): solo si **todos** los bultos están controlados. Calcular declarado vs recibido por ISBN, **registrar ubicación destino** (buenos a `picking`/`pallet`, malos a `dañados`/`cuarentena`, vía puerto) y **emitir `devolucion.procesada`**.
12. **Pesos:** suma de pesos de bultos vs peso total declarado; observación obligatoria si difieren.
13. **PWA:** manifest + service worker + offline básico del control (no perder un control por caída de red).
14. **Integración WMS:** endpoints + `docs/openapi.yaml` + eventos salientes en cada cambio de estado.
15. **Informes** profesionales y vistosos (KPIs + gráficos).
16. **Tests:** por módulo + integración del seam de ubicación + circuito completo (ver Criterio de validación).

---

## Reglas de dominio (decididas — no reinventar)

### Roles y permisos (RBAC granular)
- **Roles:** Cliente, Vendedor, Gerencial, Depósito, Administrador.
- **Los permisos son granulares y los roles son paquetes de permisos configurables por el Administrador.** Permisos clave: `solicitud.crear`, `solicitud.aprobar`, `deposito.recibir`, `deposito.ingresar`, `deposito.controlar`, `cliente.administrar`, `usuario.administrar`, `rol.administrar`, `informes.ver`, `catalogo.administrar`.
- **Mapa por defecto** (editable):
  - **Cliente:** `solicitud.crear` (solo lo suyo), cargar y despachar lo suyo. Ve solo sus autorizaciones.
  - **Vendedor:** `solicitud.crear`, `solicitud.aprobar` (asignable), `informes.ver`.
  - **Gerencial:** `solicitud.crear`, `solicitud.aprobar`, `cliente.administrar`, `informes.ver`.
  - **Depósito:** `deposito.recibir`, `deposito.ingresar`, `deposito.controlar`.
  - **Administrador:** todo, incluido `usuario.administrar` y `rol.administrar`.
- **`solicitud.aprobar` es un permiso asignable** a vendedor o gerencia (o admin). Quién aprueba se configura, no está hardcodeado a un rol.

### Máquina de estados (cabecera de la autorización)
`A Aprobar → Aprobado → En tránsito → Entregado → Ingreso a depósito → Procesado`
- **A Aprobar:** solicitud creada por quien tenga `solicitud.crear` (Cliente / Vendedor / Gerencial). Siempre ligada a un `cliente`; se guarda `creado_por`.
- **Aprobado:** la autoriza quien tenga `solicitud.aprobar`. Recién acá el cliente puede cargar.
- **En tránsito:** el Cliente terminó de cargar (libros + bultos + peso total + transportista) y despachó.
- **Entregado:** llegó la mercadería; Depósito registra bultos recibidos.
- **Ingreso a depósito:** Depósito registra la ubicación (vía puerto; hoy texto libre).
- **Procesado:** Depósito cerró el control de **todos** los bultos → reconciliación + **destino** de la mercadería (buenos a `picking`/`pallet`, malos a `dañados`/`cuarentena`, vía puerto) + emite `devolucion.procesada`.

No se saltean estados. Cada transición valida **permiso** del usuario. Todo cambio queda en **auditoría** (quién, cuándo, estado origen→destino).

### Bultos y peso
- El cliente declara **cantidad de bultos** y **peso total**.
- En depósito se **pesa cada bulto**; la suma debe igualar el peso total declarado.
- **Suma de pesos ≠ peso total declarado → NO bloquea, exige observación.**
- **Bultos recibidos ≠ declarados → observación obligatoria + registrar cantidad real recibida** (esa es la cantidad de bultos a controlar).

### Catálogo y escaneo
- "Número de serie" = **ISBN** (EAN-13; normalizar ISBN-10/13). Identifica un **título**, no una copia física → solo cantidades por título.
- Al escanear se muestra el **título** del catálogo, cantidad arranca en **1**. Reescanear el mismo ISBN **autosuma**; también cantidad directa.
- Catálogo (ISBN + título) se carga **por API**. ISBN no catalogado → avisar, no crear líneas fantasma.

### Control y reconciliación
- El cliente puede haber **mezclado un mismo ISBN en varios bultos**: el control es **bulto por bulto**, la reconciliación **agrega por ISBN sobre todos los bultos**.
- Por defecto los libros quedan **"para la venta"**. El operario carga la **cantidad en mal estado**; buen estado = recibido − mal estado.
- **Procesado** exige **todos** los bultos controlados. Al cerrar, por ISBN: recibido vs declarado (faltante/sobrante) y buen/mal estado.

### Cierre del circuito — destino de la mercadería (decidido)
- Al pasar a Procesado: los libros **buenos** van a ubicación vendible (`picking`/`pallet`) y los **malos** a `dañados`/`cuarentena`. Devoluciones **registra los destinos** (validados por el puerto) y **emite `devolucion.procesada`** con el resultado por ISBN.
- **El alta de stock real NO la hace Devoluciones** — la hará Inventario cuando exista, consumiendo el evento. Devoluciones solo controla y entrega el dato.
- Detalle completo del módulo en `docs/modulos/devoluciones.md`.

### Modelo de datos (entidades)
`core_pais` · `core_deposito`(nombre) · `core_usuario` · `core_rol` · `core_permiso` · `core_rol_permiso` · `core_cliente`(nro_cliente, clave generada, pais) · `core_producto`(codigo_interno, isbns, titulo, editorial, unidad_base, equiv_caja, equiv_pallet; lote/serie reservado) · `core_transportista` · `core_auditoria` · `dev_autorizacion`(estado, creado_por, cliente, bultos/peso declarados y recibidos, **ubicacion_espera**, **ubicacion_destino_bueno**, **ubicacion_destino_malo**, observaciones) · `dev_declaracion`(isbn, cantidad) · `dev_bulto`(numero, peso, estado_control) · `dev_control`(bulto, isbn, cantidad, mal_estado).

---

## Identidad visual (marca Grupal) — extraer del sitio, no inventar
- **Logo (blanco, para fondo de color/oscuro):**
  `https://grupaldistribuidora.com.ar/wp-content/uploads/2025/03/Grupal_libros-logo_blanco_chico.png`
  (variante 296x72: `...Grupal_libros-logo_blanco_chico-296x72.png`)
- **Ícono "G" (favicon / PWA):**
  `https://grupaldistribuidora.com.ar/wp-content/uploads/2021/11/G-300x300.png`
- Descargar los assets a `apps/web/public/brand/` (no hotlinkear).
- **Colores y tipografía: EXTRAER los reales del sitio** (es un sitio Elementor + Google Fonts). Receta exacta:
  1. Descargar `https://grupaldistribuidora.com.ar/wp-content/uploads/elementor/css/global.css`.
  2. Leer las variables de **paleta**: `--e-global-color-primary`, `--e-global-color-secondary`, `--e-global-color-text`, `--e-global-color-accent` → esos hex son la marca.
  3. Leer las variables de **tipografía**: `--e-global-typography-primary-font-family`, `-secondary-`, `-text-`, `-accent-` (con sus `-font-weight`).
  4. Confirmar los pesos a cargar mirando el `<link>` a Google Fonts en el `<head>` del home.
  5. Mapear esos valores a tokens Tailwind/shadcn. El logo es **blanco** → header/topbar sobre el color **primary** (oscuro).
- **Fallback SOLO si la global.css no se puede leer** (marcar y avisar al usuario para confirmar): tipografía sans profesional (Inter) + primario oscuro de marca con logo blanco encima.
- Diseño **dinámico, profesional y fácil para cualquier usuario**: micro-interacciones, feedback al escanear, estados por color. Informes vistosos.

## Deploy (Hostinger Business/Cloud + GitHub)
- App **Node.js** en hPanel conectada al repo GitHub; **auto-deploy en push a `main`**.
- Scripts raíz en `package.json`:
  - `build`: `build shared → build web (Vite) → copiar dist a apps/api/src/static → build api`
  - `start`: `node apps/api/dist/main.js`
  - `migrate`: `prisma migrate deploy` (en cada deploy)
- **Credenciales por variables de entorno** (hPanel / `.env`, NUNCA commiteadas): `DATABASE_URL` (MySQL de hPanel), `JWT_SECRET`, `PORT`, y las del WMS cuando existan. Ver `.env.example`.
- `manifest.webmanifest`: name "WMS Grupal — Devoluciones", `display: standalone`, íconos 192/512 derivados de `G-300x300.png`.

---

## Políticas permanentes (no negociables)

### 1. Skills y agentes primero — evaluar SIEMPRE la mejor skill
Al iniciar una tarea de código, primero listá las skills y agentes instalados y **analizá explícitamente cuál es la mejor para esa tarea** antes de arrancar. Está PROHIBIDO improvisar código desde cero ignorando una skill o agente que ya resuelve esa tarea. Si dudás si hay una skill aplicable, verificá antes de arrancar a mano. (Para UI: skill `ui-ux-pro-max` / `frontend-design`.)
- **Para tareas sustantivas o cuando la elección no es obvia: usar el ORQUESTADOR** (workflows/agentes en paralelo) para evaluar qué skill/enfoque conviene y para investigar, en vez de iterar a ciegas. Regla práctica: si una iteración de prueba/error falla 2 veces, parar y orquestar una investigación (así se resolvió el problema del host MySQL en Hostinger).

### 2. claude-mem y memorias — leer antes de actuar y MANTENER ACTUALIZADAS
claude-mem captura solo e inyecta el contexto al abrir sesión. Al iniciar CADA sesión, leé el bloque de observaciones recientes (avances, errores, fixes, decisiones) y `docs/estado-proyecto.md` ANTES de tocar nada, y respetalos. Referenciá observaciones por ID. Declará decisiones y fixes con claridad. Antes de re-analizar un archivo o problema, fijate si ya hay una observación.
- **Al cerrar cada hito o resolver un problema no trivial, actualizá las memorias**: `docs/estado-proyecto.md` (estado operativo: qué se construyó, deploy, footguns) y las memorias persistentes del proyecto. Lo que no se registra se vuelve a romper en la próxima sesión.

### 3. Frontend — dinámico, profesional, responsive e instalable
- Dinámico y animado, nunca plano: micro-interacciones, feedback al click/escaneo, estética pulida.
- Responsive siempre (cliente escanea desde celular; depósito desde PC/tablet). Sin anchos fijos.
- Instalable (PWA): manifest + service worker + offline básico; no perder un control por caída de red.
- **Grillas con interacción rica:** ordenar por cualquier columna, ocultar/mostrar y agregar columnas, menú contextual. Columnas **dinámicas**. Usar **TanStack Table v8** (+ shadcn/ui); no reinventarla. Verificar versión vigente.
- Para UI, usá la skill `frontend-design`.

### 4. Verificar antes de descartar
Nunca afirmar que algo "no se puede" sin comprobarlo. Investigar → confirmar → recién ahí hablar. Verificar que una librería existe y está vigente antes de recomendarla.

### 5. No repetir
Si una instrucción, decisión o fix ya está acá o en claude-mem, no se vuelve a preguntar ni a romper.

### 6. Respetar los límites de módulo
Ningún módulo importa internos de otro. Comunicación SOLO por puertos/eventos. Sin FKs duras cruzadas. Un cambio de contrato (puerto/evento) se documenta en `docs/contratos/`. Esta regla es la que mantiene que "tocar un módulo no rompa otro".

### 7. Auto-review con la skill antes de cerrar cualquier cambio sustantivo
Al terminar una tanda de cambios de código (no triviales), antes de darla por cerrada se corre la skill **`/code-review`** sobre el diff propio — sin esperar a que el usuario lo pida. Compilar y testear NO alcanza: `tsc`+`jest` pescan errores de tipo/lógica, pero no problemas de eficiencia, robustez o altitud (p. ej. un fix que duplica requests HTTP o no cachea una decisión por host). El review ya encontró bugs reales en código recién escrito que la compilación y los tests no veían. Flujo fijo: **diagnóstico/investigación con skills + orquestador (agentes en paralelo) → implementar → `/code-review` del diff → aplicar los hallazgos reales → recién ahí cerrar**. Los hallazgos se filtran con criterio (descartar los "por diseño" o falsos positivos, explicando por qué).

---

## Seguridad informática (hardening) — política dura
Aplica a TODOS los módulos; Claude Code la respeta en cada cosa que construye. (Esto es distinto del RBAC/permisos, que es control de acceso; acá es defensa contra ataques.)

- **Validar y sanitizar TODA entrada** (API y archivos importados): tipo, tamaño y contenido, antes de procesar. Consultas siempre parametrizadas (Prisma cubre inyección SQL de base; mantenerlo).
- **Escaneos (ISBN) y archivos del ERP son superficie de ataque:** límite de tamaño, rechazo de contenido inesperado, prevención de XSS almacenado e inyección. No confiar en el origen.
- **Auth robusta:** contraseñas con hash fuerte (argon2/bcrypt), nunca en texto plano; expiración/rotación de tokens (JWT); **límite de intentos de login** (anti fuerza bruta / lockout). **2FA: PENDIENTE — a definir más adelante contra qué servicio; dejar el diseño preparado para sumarlo, NO implementarlo ahora.**
- **API endurecida:** rate limiting, CORS restrictivo, headers de seguridad (HSTS, CSP, X-Content-Type-Options…), y **validación de permiso en cada endpoint** (el front nunca es la única barrera).
- **Integraciones:** credenciales de sistemas externos SOLO en variables de entorno; **TLS** en toda conexión; validar origen y contenido de lo que entra por API/archivo.
- **Secretos y datos:** nada hardcodeado; **HTTPS siempre**; backups de la base con **prueba de restauración** periódica.
- **Auditoría inmutable + monitoreo:** el log de auditoría no se edita; alertar ante patrones anómalos (logins raros, picos de error).
- **Dependencias:** `npm audit` / Dependabot en el pipeline de GitHub; no arrastrar librerías con vulnerabilidades conocidas.
- **Mínimo privilegio** en todo (DB, usuarios, tokens, conectores de integración).

**Fuera del alcance inicial** (se evalúa si el sistema crece o se expone más): WAF dedicado, pentesting continuo, SOC. Hostinger ya aporta la capa de red/HTTPS básica.

---

## Integraciones y credenciales
- **Módulo de plataforma `Integraciones`:** el ÚNICO que habla con sistemas externos. **Multi-conector** y **elegible por el cliente**: para cada flujo (catálogo, stock, pedidos, **órdenes de compra/remitos**, export de devoluciones, confirmaciones) el cliente elige el **conector activo**, el **transporte** (**API directa o archivo CSV/Excel**, las dos opciones) y la **frecuencia**. Detalle en `docs/modulos/integraciones.md`.
- **Los módulos de dominio NO conocen sistemas externos** ni saben de API/archivo: solo exponen **puertos** (inbound: `CatalogoPort.upsert`, `InventarioPort.cargarSnapshotERP`, `RecepcionPort.crearRecepcion`, `PickingPort.crearPedidos`) y emiten **eventos** (outbound: `devolucion.procesada`, `recepcion.cerrada`, `pedido.cerrado`, `inventario.conciliado`). Integraciones mapea y mueve; el dominio decide.
- **Tareas programadas** (cron, `@nestjs/schedule`) viven en Integraciones; el import de stock del ERP es nocturno diario.
- **Contratos de campos** por conector se cierran con los datos del cliente; marcados como pendientes hasta entonces.
- **Secretos:** SIEMPRE en variables de entorno (referenciados desde `int_conector`). Nunca hardcodear `DATABASE_URL`, `JWT_SECRET` ni keys del ERP/WMS.

## Casos borde y manejo de fallos
- **iOS Safari** no tiene BarcodeDetector → fallback ZXing obligatorio; probar en iPhone real.
- **Doble escaneo** del mismo ISBN en milisegundos → debounce.
- **ISBN inexistente** en catálogo → avisar, no cargar.
- **Bultos/peso ≠ declarado** → observación obligatoria, no bloqueo.
- **Caída de red durante el control** → guardado local y reintento (PWA).
- **Transición de estado inválida o sin permiso** → rechazar con mensaje claro.

## Criterio de validación
Caso end-to-end que debe pasar: un **Vendedor** crea una solicitud para el Cliente X (A Aprobar); un usuario con `solicitud.aprobar` la aprueba; el Cliente X escanea 3 ISBN con cantidades, declara 2 bultos y 10 kg, despacha (En tránsito); Depósito recibe 2 bultos y los pesa (6 + 4 = 10, OK), ingresa ubicación "Estante A3" (vía puerto), controla cada bulto marcando 1 libro en mal estado y cierra → **Procesado** con reconciliación correcta por ISBN (declarado vs recibido, buen/mal estado) y todo el recorrido en auditoría. Además: un test que cambie la implementación del `UbicacionResolverPort` por una falsa de "ubicaciones" sin tocar Devoluciones.

## Qué NO hacer en este proyecto
- NO usar PostgreSQL (es MySQL/MariaDB).
- NO hardcodear secretos.
- NO saltear estados ni permitir **Procesado** con bultos sin controlar.
- NO hardcodear quién aprueba: se rige por el permiso `solicitud.aprobar`.
- NO inventar fuentes/colores: extraerlos del sitio de Grupal con la receta de arriba.
- NO romper límites de módulo (sin imports cruzados de internos, sin FKs cruzadas).
- NO acoplar la ubicación a un string suelto: pasa por `UbicacionResolverPort`.
- NO mover ni sumar **stock/inventario** dentro de Devoluciones: registra destino y **emite el evento**; el stock lo maneja Inventario/Picking.
- NO bloquear por diferencias de peso/bultos: se registran con observación.
