# Estado del proyecto — WMS Grupal (actualizado 2026-06-10)

> **Leer este archivo al iniciar una sesión de trabajo.** Resume qué está construido,
> cómo funciona el deploy y los errores ya resueltos para NO repetirlos.
> Las reglas de arquitectura viven en `CLAUDE.md` (raíz); esto es el estado operativo.

## Qué está construido (Módulo 1 COMPLETO y en producción)

- **Esqueleto desplegable**: monorepo npm workspaces. Un solo proceso Node: NestJS sirve la API en `/api` y la PWA como estáticos.
- **Core**: auth JWT + RBAC granular, ABM de clientes / usuarios / roles+permisos, catálogo de productos (ISBN), auditoría inmutable, seed idempotente.
- **Devoluciones**: máquina de estados completa (`A_APROBAR → … → PROCESADO`), control bulto por bulto, reconciliación por ISBN, `UbicacionResolverPort` (seam), eventos `devolucion.procesada` y `devolucion.estado_cambiado`.
- **PWA**: marca Grupal, escáner (BarcodeDetector + ZXing + wedge USB), **offline del control** (outbox en localStorage con resync), informes Recharts, nav por permisos.
- **Calidad**: tests jest 7/7 (`npm test`, incluye test del seam), OpenAPI (`/api/docs` + `npm run openapi` → `docs/openapi.yaml`), CSP + rate limiting (login 10/min → 429).
- **Integración de clientes (2026-06-10)**: `core_cliente` tiene `direccion`; **import masivo** `POST /api/clientes/import` (upsert por `nro_cliente`, máx 1000, idempotente, NO toca claves; importados quedan sin clave de portal hasta reset) + **autocomplete** `GET /api/clientes/buscar?q=` (número o nombre, máx 10, bloqueado para actores tipo cliente). Manual para el sistema externo: `docs/integraciones/manual-api-clientes.md` (auth = usuario dedicado `integrador` con permiso `cliente.administrar`). Front: `ClientePicker` en el form de nueva devolución.

## ⚠️ INCIDENTE ABIERTO (2026-06-10): producción 503
El dominio devuelve **503 de LiteSpeed** (el proceso Node no corre); build OK en deploy log. Fix preventivo ya aplicado (listen primero, migración en background). **Falta que el usuario revise**: botón Restart (badge "Running" del dashboard), y los **Runtime logs** (menú del dashboard ≠ log de deploy; o File Manager → `domains/<dominio>/nodejs/stdout.log` / `stderr.log`). El log de build que termina tras `nest build` es NORMAL. Investigación completa hecha con orquestador (causas rankeadas: crash al arranque por env/módulos vs proceso colgado de plataforma → Restart).

## Hosting / Deploy (Hostinger)

| Ítem | Valor |
|---|---|
| Dominio | `https://devoluciones.grupaldistribuidora.com.ar` |
| Tipo | Hostinger Business/Cloud, app Node.js gestionada (contenedor) |
| Repo | `github.com/tvivot/WMS`, rama `main`, **auto-deploy en push** |
| hPanel → Framework | Other · Node **22.x** · root `./` |
| hPanel → Build command | `npm run build` |
| hPanel → Entry file | `apps/api/dist/main.js` |
| hPanel → Output dir | **vacío** (la app Node sirve todo) |
| Health | `GET /api/health` → `{"status":"ok","db":"up"}` |
| Docs API | `/api/docs` (Swagger) |

### Base de datos (CRÍTICO — costó 4 iteraciones)
- MySQL de hPanel: base `u722074339_WMSGrupal`, usuario `u722074339_GruWMS`.
- **El host NO es `localhost`**: la app corre en un contenedor; `localhost:3306` responde pero es OTRO MySQL → "Authentication failed" con credenciales correctas.
- **Host correcto: `srv1894.hstgr.io`** + **Remote MySQL con "Cualquier host" (%)** habilitado en hPanel (sin el `%` rechaza al contenedor).
- `DATABASE_URL` lleva sufijo `?connect_timeout=15` (sin él, un host inalcanzable cuelga el health >60s).
- **Las env vars solo se leen al arrancar**: cambiar una variable exige redeploy/restart.

### Env vars en hPanel (nunca en el repo)
`DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD` (y opcional `ADMIN_USERNAME`, `PORT`, `CORS_ORIGIN`).

## Decisiones técnicas con su porqué (no revertir sin motivo)

1. **Prisma `engineType = "binary"`** (schema.prisma): el engine por defecto (library/Node-API) **panickea** en Hostinger con `PANIC: timer has gone away`. No volver a library.
2. **Hash de claves con `scrypt` nativo de Node** (`core/seguridad/password.service.ts`): se evitó argon2/bcrypt porque son módulos nativos compilados (frágiles en Hostinger). La interfaz permite cambiarlo a futuro.
3. **Migraciones automáticas al arranque** (`src/migrate.ts` → `prisma migrate deploy`): el usuario NO tiene acceso a terminal en Hostinger. Idempotente; si falla, la app igual arranca y `/api/health` reporta `db:down`.
4. **Seed idempotente** (`core/seed/seed.service.ts`): crea permisos/roles/depósito/admin solo si faltan. **No pisa los permisos editados por el ABM de roles** (solo aplica defaults al CREAR el rol).
5. **`tsc` sin `incremental`** (apps/api/tsconfig.json): un `.tsbuildinfo` viejo + `deleteOutDir` de nest hacía que `main.js` no se emitiera. No reactivar.
6. **La API no importa `@wms/shared`**: en el build de Hostinger el symlink del workspace no resuelve (TS2307). Los tipos que necesita la API se definen localmente; `@wms/shared` lo usa la web.
7. **PWA**: `base:'/'` en vite.config es crítico. El build se copia con `scripts/copy-web.mjs` a `apps/api/src/static` ANTES de compilar la API (nest-cli lo lleva a `dist/static`).
8. **CSP en helmet** (main.ts): compatible con Google Fonts/cámara/blob; `/api/docs` queda excluido (Swagger usa inline scripts).

## Flujo de trabajo con el entorno local

- **Hooks del entorno bloquean** `git add/commit/push`, `docker rm` y lectura de archivos sensibles (`.env`, `.git-credentials`). **El usuario ejecuta los push** (se le pasa el bloque de comandos listo). No intentar saltear hooks.
- Verificación local: contenedor Docker `wms-mysql-skel` (MySQL 8, puerto **3307**, db `wms`, user `wms`/`wmspass`); `.env` local apunta ahí. `docker start wms-mysql-skel` si está detenido.
- Git: dos cuentas de GitHub en la máquina. El remote es `https://tvivot@github.com/tvivot/WMS.git` (fuerza usuario `tvivot`); hubo conflicto con credenciales cacheadas de `shopyglobalarg-bit`.
- Para correr el server local: `node apps/api/dist/main.js` con el `.env` de la raíz (no pasar `JWT_SECRET` inline: hook lo bloquea).

## Criterio de validación (pasó completo)
Vendedor crea → aprueba → cliente declara 3 ISBN/2 bultos/10kg → despacha → depósito recibe 2 bultos (6+4=10) → ingresa `DEV-01` → controla bulto por bulto (1 mal estado) → Procesado con reconciliación por ISBN correcta + auditoría completa + evento emitido. Test del seam: adapter falso de Ubicaciones sin tocar Devoluciones ✅.

## Próximos pasos (roadmap CLAUDE.md)
1. **Ubicaciones** (`ubi_*`): al conectarlo, cambiar UNA línea en `devoluciones.module.ts` (`provide: UBICACION_RESOLVER`).
2. **Integraciones** (`int_*`) antes del primer sync externo.
3. **Inventario** (`inv_*`): consume `devolucion.procesada` (ya se emite).
4. Pendientes menores: code-split del bundle web (~666KB por ZXing/Recharts), 2FA (diseño preparado, no implementar aún).
