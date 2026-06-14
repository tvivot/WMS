# Manual de integración — Importación de Catálogo de Productos (WMS Grupal)

> **Audiencia:** equipo del sistema externo (ERP/integrador) que enviará el catálogo de libros al WMS.
> **Versión:** 1.0 (2026-06-14) · Contrato estable: cambios se avisan y se versionan.

## 1. Datos generales

| Ítem | Valor |
|---|---|
| URL base | `https://devoluciones.grupaldistribuidora.com.ar/api` |
| Protocolo | HTTPS obligatorio (TLS) |
| Formato | JSON (`Content-Type: application/json`) |
| Autenticación | JWT Bearer (ver §2) |
| Rate limit | 120 requests/min por IP (HTTP 429 si se excede) |
| Tamaño máximo | 1000 productos por request |
| Documentación interactiva | `https://devoluciones.grupaldistribuidora.com.ar/api/docs` |

## 2. Autenticación

El WMS entrega al integrador un **usuario dedicado** (ej. `integrador`) con el permiso `catalogo.administrar`. El flujo es:

### 2.1 Obtener token

```
POST /api/auth/login/usuario
Content-Type: application/json

{ "username": "integrador", "clave": "LA_CLAVE_ENTREGADA" }
```

**Respuesta 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "tipo": "usuario",
  "nombre": "Integrador ERP",
  "permisos": ["catalogo.administrar"],
  "primerIngreso": false
}
```

- El `token` **vence a las 8 horas**. Recomendado: pedir un token nuevo al inicio de cada corrida de sincronización (no cachearlo entre corridas).
- Errores: `401` credenciales inválidas · `403` usuario bloqueado (5 intentos fallidos → lockout 15 min) · `429` demasiados intentos (máx. 10 logins/min).

### 2.2 Usar el token

En cada request: header `Authorization: Bearer <token>`.

## 3. Importar productos (upsert masivo)

```
POST /api/catalogo/productos/import
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "productos": [
    { "isbn": "9789875668249", "titulo": "El Aleph", "editorial": "Emecé" },
    { "isbn": "9788437604947", "titulo": "Cien años de soledad", "editorial": "Cátedra" }
  ]
}
```

### Campos por producto

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `isbn` | string | **Sí** | EAN-13 (se acepta ISBN-10/13, con o sin guiones; se normaliza). **Clave de identidad**: si ya está catalogado, se ACTUALIZA; si no, se CREA. Un ISBN inválido se rechaza fila por fila (ver `errores`), no aborta el lote. |
| `titulo` | string | **Sí** | Máx. 300 caracteres. |
| `editorial` | string | No | Máx. 200 caracteres. Si se omite en una actualización, queda en blanco (enviar siempre el dato completo). |

> **Solo ISBN, Título y Editorial.** El WMS no requiere código interno: el ISBN actúa como identificador maestro del producto. Otros atributos del modelo (autor, unidades por caja/pallet) quedan con sus valores por defecto y no se gestionan por esta vía.

### Semántica (importante)

- **Upsert por `isbn`**: la operación es **idempotente** — reenviar el mismo lote produce el mismo resultado. Ante un error de red, reintentar el lote completo es seguro.
- Es un **espejo de datos**: el sistema externo es el dueño de `isbn`, `titulo` y `editorial`.
- Un ISBN no catalogado al momento de un escaneo de devolución **no crea líneas fantasma**: por eso conviene mantener el catálogo al día con esta importación.

### Respuesta 201

```json
{
  "recibidos": 2,
  "creados": 1,
  "actualizados": 1,
  "errores": []
}
```

Si alguna fila falla (p. ej. ISBN inválido), no aborta el lote: se informa en `errores`:
```json
{ "recibidos": 100, "creados": 97, "actualizados": 2, "errores": [ { "isbn": "123", "error": "ISBN inválido" } ] }
```

### Errores HTTP

| Código | Causa | Acción sugerida |
|---|---|---|
| 400 | Body inválido (campo faltante, demasiado largo, lote > 1000) | Corregir y reenviar; el detalle viene en `message` |
| 401 | Token vencido o ausente | Hacer login de nuevo y reintentar |
| 403 | El usuario no tiene `catalogo.administrar` | Avisar al admin del WMS |
| 429 | Rate limit | Esperar 60s y reintentar |
| 5xx | Error del servidor | Reintentar con backoff (30s, 60s, 120s) |

## 4. Flujo recomendado de sincronización

1. `POST /api/auth/login/usuario` → token.
2. Particionar el catálogo en **lotes de hasta 1000**.
3. `POST /api/catalogo/productos/import` por cada lote (secuencial; respeta el rate limit).
4. Registrar la respuesta de cada lote (`creados/actualizados/errores`) en el log del integrador.
5. Frecuencia sugerida: **nocturna diaria** (full) o incremental si el ERP detecta cambios.

## 5. Ejemplo completo (curl)

```bash
# 1) login
TOKEN=$(curl -s -X POST https://devoluciones.grupaldistribuidora.com.ar/api/auth/login/usuario \
  -H 'Content-Type: application/json' \
  -d '{"username":"integrador","clave":"LA_CLAVE"}' | jq -r .token)

# 2) importar
curl -s -X POST https://devoluciones.grupaldistribuidora.com.ar/api/catalogo/productos/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "productos": [
      {"isbn":"9789875668249","titulo":"El Aleph","editorial":"Emecé"}
    ]
  }'
```

## 6. Consulta (para verificación del integrador)

Con el mismo token se puede verificar lo cargado:

```
GET /api/catalogo/productos?q=El%20Aleph     → listado con búsqueda por título/código/ISBN
GET /api/catalogo/productos/por-isbn/9789875668249  → resuelve un ISBN a su producto
```

## 7. Seguridad / acuerdos

- La clave del usuario `integrador` se entrega por canal seguro y se **rota** ante cualquier sospecha.
- Solo HTTPS; el WMS valida tipo, tamaño y contenido de toda entrada.
- El WMS audita las operaciones; cada corrida queda trazada con el usuario `integrador`.
- Cambios de contrato (campos nuevos, etc.) se comunican antes de desplegarse; los campos desconocidos enviados de más son **rechazados** (validación estricta).
```
