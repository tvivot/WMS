# Performance y límites en Hostinger — runbook

> Runbook operativo para no repetir los incendios de performance del servidor.
> Si tocás algo de esta lista, leé esto primero. Lo histórico va en `estado-proyecto.md`.

## Síntoma clásico: "se dispara a +120 procesos" / fallas en CloudLinux

Hostinger (CloudLinux + Passenger) cuenta **threads como procesos** (`nproc`, límite ~120).
Varias fuentes escalan con los **cores del SERVIDOR FÍSICO** (32–128), no con tu plan.

### Causas y fixes (orden de impacto)

1. **Migración en el arranque (la peor).** `main.ts` corre `runMigrationsAsync()` en cada
   arranque de proceso → spawnea `prisma migrate deploy` (CLI + engines, ~50+ threads).
   Passenger levanta varios workers bajo tráfico → cada uno la relanzaba → tormenta.
   - **Fix aplicado:** lock atómico por set de migraciones en `migrate.ts` (`mkdir` en tmpdir,
     nombre = última carpeta de migración). Solo el primer worker migra; el resto saltea.
     Si falla, **libera el lock** para reintentar en el próximo arranque.

2. **Prisma `engineType="binary"`.** Engine en proceso aparte; pool por defecto
   `cores*2+1` conexiones + runtime Tokio con threads = cores.
   - **Fix:** `DATABASE_URL ...&connection_limit=3` (acota el pool). Los threads Tokio del
     engine no se cap-ean por env → si después de todo sigue picando, evaluar `engineType="library"`
     (in-process, sin proceso aparte) — con cuidado por el panic "timer has gone away" que motivó binary.

3. **sharp / libvips.** Pool de threads = cores del host por cada conversión de imagen.
   - **Fix aplicado:** `sharp.concurrency(1)` en `imagen.util.ts`. Refuerzo opcional: env `VIPS_CONCURRENCY=1`.

4. **Node libuv / V8.** Threadpools que escalan con cores.
   - **Fix (env vars que SÍ podés setear en hPanel):** `UV_THREADPOOL_SIZE=2`, `NODE_OPTIONS=--v8-pool-size=2`.

> La concurrencia async (p. ej. el sync de WooCommerce con 8 `fetch` en paralelo) **NO** crea procesos.

### Env vars recomendadas en hPanel (exigen redeploy)

```
DATABASE_URL = mysql://...?connect_timeout=15&connection_limit=3
UV_THREADPOOL_SIZE = 2
VIPS_CONCURRENCY = 1
NODE_OPTIONS = --v8-pool-size=2
JWT_SECRET = <obligatorio: sin esto la app NO arranca fuera de dev>
```

> El pool de Passenger ("Application processes") NO está expuesto en este plan; por eso la
> estrategia es **achicar cada worker** con las env de arriba, no limitar la cantidad de workers.

## Performance de queries / DB

- **Listados:** siempre con `take` (cota) y, si crece, paginación server-side. Nunca `findMany` sin límite.
- **Importadores masivos:** batch — un `findMany({ in })` para clasificar + `createMany` + updates
  en `$transaction` por bloques (helper `core/util/bloques.ts`). NO un query por fila.
- **Búsqueda de texto (catálogo):** `LIKE '%q%'` (Prisma `contains`) NO usa índice B-tree.
  - Título → **FULLTEXT** (`@@fulltext`, `MATCH ... AGAINST` boolean mode con prefijo `palabra*`),
    fallback a `contains` para términos < 3 chars (`innodb_ft_min_token_size`).
  - ISBN/código → **prefijo** (`startsWith`) sobre sus `@unique`. **Escapar `%`/`_`** antes
    (Prisma no los escapa → buscar `%` traería toda la tabla). Ver `catalogo.service.ts::escaparLike`.
  - El front debe buscar **server-side** (no bajar todo el dataset y filtrar en memoria).
- **orderBy** sobre una columna sin índice = filesort. Indexar la columna del `orderBy`.

## Si DESPUÉS de las env vars SIGUE picando (orden de ataque)

1. **Verificar que las 4 env estén ACTIVAS en hPanel** (no solo en `.env.example`): `connection_limit` en `DATABASE_URL`, `UV_THREADPOOL_SIZE`, `VIPS_CONCURRENCY`, `NODE_OPTIONS`. Sin redeploy no toman efecto. Esto suele ser el 80%.
2. **Topear los workers de Passenger** (no hay opción en la UI con preset "Other"): probar un **`.htaccess` en el directorio root de la app** (`./`):
   ```
   PassengerMinInstances 1
   PassengerPoolIdleTime 300
   # PassengerMaxPoolSize 1   # a veces solo válido en config global; probar y mirar el error log
   ```
   Revisar el error log de Passenger tras el deploy: si rechaza una directiva, lo dice ahí.
3. **`engineType="library"`** (schema.prisma): el engine `binary` levanta un **proceso aparte por worker**; `library` corre in-process (sin proceso hijo). Se eligió `binary` por el panic "timer has gone away" — **probar `library` y vigilar el log**; si reaparece el panic, volver a `binary` (y entonces `connection_limit` bajo es obligatorio). El `.so` ya está generado.
4. **Mover la migración al build** (sacarla del runtime): quitar `runMigrationsAsync()` de `main.ts` y encadenar `&& npm run migrate` al `build` del package.json raíz, para que corra UNA vez en el deploy y no por worker. Riesgo: el paso de build debe poder alcanzar la DB. Fallback manual: `POST /api/admin/migraciones`.

## Método para diagnosticar (no iterar a ciegas)

Si una hipótesis de prueba/error falla 2 veces → **parar y orquestar agentes** en paralelo para
investigar. Antes de dar por listo cualquier cambio → **pase de review** (`code-review` /
agente `general-code-reviewer`). Persistir hallazgos acá y en `estado-proyecto.md`.
