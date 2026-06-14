# Manual de integración — Importación de Clientes (WMS Grupal)

> **Audiencia:** equipo del sistema externo (ERP/integrador) que enviará los datos de clientes al WMS.
> **Versión:** 1.0 (2026-06-10) · Contrato estable: cambios se avisan y se versionan.

## 1. Datos generales

| Ítem | Valor |
|---|---|
| URL base | `https://devoluciones.grupaldistribuidora.com.ar/api` |
| Protocolo | HTTPS obligatorio (TLS) |
| Formato | JSON (`Content-Type: application/json`) |
| Autenticación | JWT Bearer (ver §2) |
| Rate limit | 120 requests/min por IP (HTTP 429 si se excede) |
| Tamaño máximo | 1000 clientes por request |
| Documentación interactiva | `https://devoluciones.grupaldistribuidora.com.ar/api/docs` |

## 2. Autenticación

El WMS entrega al integrador un **usuario dedicado** (ej. `integrador`) con el permiso `cliente.administrar`. El flujo es:

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
  "permisos": ["cliente.administrar"],
  "primerIngreso": false
}
```

- El `token` **vence a las 8 horas**. Recomendado: pedir un token nuevo al inicio de cada corrida de sincronización (no cachearlo entre corridas).
- Errores: `401` credenciales inválidas · `403` usuario bloqueado (5 intentos fallidos → lockout 15 min) · `429` demasiados intentos (máx. 10 logins/min).

### 2.2 Usar el token

En cada request: header `Authorization: Bearer <token>`.

## 3. Importar clientes (upsert masivo)

```
POST /api/clientes/import
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "clientes": [
    { "nroCliente": "C-00123", "nombre": "Librería Norte SRL", "direccion": "Av. Corrientes 1234, CABA" },
    { "nroCliente": "C-00456", "nombre": "Distribuidora Sur", "direccion": "Mitre 567, Rosario", "activo": true }
  ]
}
```

### Campos por cliente

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `nroCliente` | string | **Sí** | Máx. 40 caracteres. **Clave de identidad**: si ya existe, se ACTUALIZA; si no, se CREA. |
| `nombre` | string | **Sí** | Máx. 200 caracteres. |
| `direccion` | string | No | Máx. 300 caracteres. Si se omite en una actualización, queda en blanco (enviar siempre el dato completo). |
| `activo` | boolean | No | `false` desactiva el cliente en el WMS (no se borra). Si se omite: alta como activo / sin cambio en update. |

### Semántica (importante)

- **Upsert por `nroCliente`**: la operación es **idempotente** — reenviar el mismo lote produce el mismo resultado. Ante un error de red, reintentar el lote completo es seguro.
- **La importación NUNCA toca la clave de acceso al portal** de un cliente existente. Los clientes nuevos quedan **sin clave de portal** (no pueden loguear) hasta que un administrador del WMS les genere una.
- Es un **espejo de datos**: el sistema externo es el dueño de `nroCliente`, `nombre` y `direccion`.

### Respuesta 201

```json
{
  "recibidos": 2,
  "creados": 1,
  "actualizados": 1,
  "errores": []
}
```

Si alguna fila falla, no aborta el lote: se informa en `errores`:
```json
{ "recibidos": 100, "creados": 97, "actualizados": 2, "errores": [ { "nroCliente": "C-0999", "error": "..." } ] }
```

### Errores HTTP

| Código | Causa | Acción sugerida |
|---|---|---|
| 400 | Body inválido (campo faltante, demasiado largo, lote > 1000) | Corregir y reenviar; el detalle viene en `message` |
| 401 | Token vencido o ausente | Hacer login de nuevo y reintentar |
| 403 | El usuario no tiene `cliente.administrar` | Avisar al admin del WMS |
| 429 | Rate limit | Esperar 60s y reintentar |
| 5xx | Error del servidor | Reintentar con backoff (30s, 60s, 120s) |

## 4. Flujo recomendado de sincronización

1. `POST /api/auth/login/usuario` → token.
2. Particionar el padrón en **lotes de hasta 1000**.
3. `POST /api/clientes/import` por cada lote (secuencial; respeta el rate limit).
4. Registrar la respuesta de cada lote (`creados/actualizados/errores`) en el log del integrador.
5. Frecuencia sugerida: **nocturna diaria** (full) o incremental si el ERP detecta cambios.

## 5. Ejemplo completo (curl)

```bash
# 1) login
TOKEN=$(curl -s -X POST https://devoluciones.grupaldistribuidora.com.ar/api/auth/login/usuario \
  -H 'Content-Type: application/json' \
  -d '{"username":"integrador","clave":"LA_CLAVE"}' | jq -r .token)

# 2) importar
curl -s -X POST https://devoluciones.grupaldistribuidora.com.ar/api/clientes/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "clientes": [
      {"nroCliente":"C-00123","nombre":"Librería Norte SRL","direccion":"Av. Corrientes 1234, CABA"}
    ]
  }'
```

## 6. Consulta (para verificación del integrador)

Con el mismo token se puede verificar lo cargado:

```
GET /api/clientes?q=C-00123          → { total, items } paginado (skip/take, take máx. 500, default 50; requiere cliente.administrar)
GET /api/clientes/buscar?q=Norte     → autocomplete liviano (máx. 10, solo activos)
```

## 7. Seguridad / acuerdos

- La clave del usuario `integrador` se entrega por canal seguro y se **rota** ante cualquier sospecha.
- Solo HTTPS; el WMS valida tipo, tamaño y contenido de toda entrada.
- El WMS audita las operaciones; cada corrida queda trazada con el usuario `integrador`.
- Cambios de contrato (campos nuevos, etc.) se comunican antes de desplegarse; los campos desconocidos enviados de más son **rechazados** (validación estricta).
