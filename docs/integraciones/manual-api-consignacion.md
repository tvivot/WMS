# Manual de integración — Importación de Saldo en Consignación (WMS Grupal)

> **Audiencia:** equipo del sistema externo (ERP/integrador) que enviará al WMS, a diario, cuántos libros tiene cada cliente **en consignación**.
> **Versión:** 1.0 (2026-06-17) · Contrato estable: cambios se avisan y se versionan.

## 1. Qué es esto

En consignación, el cliente (librería) tiene libros "en depósito" sin comprarlos: paga lo que vende y devuelve el resto. El **saldo en consignación** es cuántas unidades de cada título tiene hoy cada cliente.

El WMS usa ese saldo para **reconciliar las devoluciones**: cuando un cliente devuelve, compara lo recibido contra lo que tenía en consignación y **marca/avisa si devuelve más de lo que figuraba** (no bloquea, pide una observación). El ERP es el dueño del dato; el WMS solo lo consume.

> Mandá **solo lo que está en consignación** (no las ventas en firme). Si el ERP distingue firme vs consignación por línea/remito, filtrá y enviá únicamente la consignación.

## 2. Datos generales

| Ítem | Valor |
|---|---|
| URL base | `https://devoluciones.grupaldistribuidora.com.ar/api` |
| Endpoint | `POST /api/integraciones/consignacion/import` |
| Protocolo | HTTPS obligatorio (TLS) |
| Formato | JSON (`Content-Type: application/json`) |
| Autenticación | JWT Bearer (ver §3) |
| Permiso requerido | `consignacion.importar` |
| Tamaño máximo | **5000 ítems por request** (paginar si hay más; ver §5) |
| Frecuencia sugerida | **diaria** (snapshot completo) |
| Documentación interactiva | `https://devoluciones.grupaldistribuidora.com.ar/api/docs` |

## 3. Autenticación

El WMS entrega al integrador un **usuario dedicado** con el permiso `consignacion.importar` (puede ser el mismo usuario `integrador` del catálogo, con este permiso agregado).

### 3.1 Obtener token

```
POST /api/auth/login/usuario
Content-Type: application/json

{ "username": "integrador", "clave": "LA_CLAVE_ENTREGADA" }
```

**Respuesta 200:** `{ "token": "eyJhbGci...", "permisos": ["consignacion.importar", ...], ... }`

- El `token` **vence a las 8 horas**: pedir uno nuevo al inicio de cada corrida.
- `401` credenciales inválidas · `403` usuario bloqueado · `429` demasiados intentos.

### 3.2 Usar el token

En cada request: header `Authorization: Bearer <token>`.

## 4. Importar el saldo en consignación

```
POST /api/integraciones/consignacion/import
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "snapshotTs": "2026-06-17T02:00:00.000Z",
  "items": [
    { "nroCliente": "C-1024", "isbn": "9789875668249", "cantidad": 5 },
    { "nroCliente": "C-1024", "isbn": "9788437604947", "cantidad": 2 },
    { "nroCliente": "C-2087", "isbn": "9789875668249", "cantidad": 9 }
  ]
}
```

### Campos

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `snapshotTs` | string | **Sí** | Fecha/hora del snapshot en formato **ISO-8601** (ej. `2026-06-17T02:00:00.000Z`). Sirve para descartar cargas que llegan fuera de orden. Usar el instante en que el ERP generó el corte. |
| `items[].nroCliente` | string | **Sí** | Número de cliente **tal como figura en el WMS** (`nro_cliente`). Máx. 40 caracteres. Si no existe en el WMS, esa línea se ignora y se reporta en `clientesDesconocidos`. |
| `items[].isbn` | string | **Sí** | EAN-13 (se acepta ISBN-10/13, con o sin guiones; se normaliza). Máx. 20 caracteres. ISBN inválido → se rechaza fila por fila (ver `errores`), no aborta el lote. |
| `items[].cantidad` | number | **Sí** | Entero ≥ 0 (unidades en consignación). Máx. 1.000.000. |

### Semántica (importante)

- **Es un snapshot completo por cliente (reemplazo, NO incremental).** Para cada cliente presente en el envío, el WMS **reemplaza** todo su saldo por lo que venga en este request. Lo que no mandes para ese cliente, se borra. Mandá siempre el **estado completo** de cada cliente que incluyas.
- Un cliente que **no** aparece en el envío **no se toca** (conserva su último saldo).
- **Idempotente:** reenviar el mismo snapshot deja el WMS igual. Ante un error de red, reintentar el lote completo es seguro.
- **Fuera de orden:** si llega un snapshot con `snapshotTs` más viejo que el último cargado para un cliente, se descarta (no pisa datos más nuevos).

### Respuesta 201

```json
{
  "recibidos": 3,
  "clientes": 2,
  "upserts": 3,
  "clientesDesconocidos": [],
  "errores": []
}
```

| Campo | Significado |
|---|---|
| `recibidos` | Ítems recibidos en el request. |
| `clientes` | Clientes cuyo saldo se actualizó. |
| `upserts` | Filas de saldo escritas. |
| `clientesDesconocidos` | `nroCliente` enviados que no existen en el WMS (esas líneas se ignoraron). |
| `errores` | Filas descartadas con su motivo, ej. `[{ "isbn": "123", "error": "ISBN inválido" }]`. |

### Errores HTTP

| Código | Causa | Acción sugerida |
|---|---|---|
| 400 | Body inválido (campo faltante/largo, `snapshotTs` no ISO-8601, `items` vacío o > 5000) | Corregir y reenviar; detalle en `message` |
| 401 | Token vencido o ausente | Login de nuevo y reintentar |
| 403 | El usuario no tiene `consignacion.importar` | Avisar al admin del WMS |
| 429 | Rate limit | Esperar 60s y reintentar |
| 5xx | Error del servidor | Reintentar con backoff (30s, 60s, 120s) |

## 5. Paginación (si hay más de 5000 ítems)

Si el snapshot total supera 5000 ítems, enviar en varios requests con el **mismo `snapshotTs`**, pero respetando una regla:

> ⚠️ **Un mismo cliente NO puede partirse entre dos requests.** Como cada envío *reemplaza* el saldo del cliente, si los ISBN de un cliente vienen en dos páginas, la segunda borraría los de la primera. Agrupá por cliente y cortá las páginas **entre clientes**, nunca dentro de uno.

## 6. Flujo recomendado

1. `POST /api/auth/login/usuario` → token.
2. Generar el corte del ERP (solo consignación) y sellar `snapshotTs`.
3. Agrupar por cliente; particionar en lotes de ≤ 5000 ítems **sin partir un cliente**.
4. `POST /api/integraciones/consignacion/import` por cada lote (secuencial).
5. Registrar la respuesta (`clientes/upserts/clientesDesconocidos/errores`) en el log del integrador; revisar `clientesDesconocidos` (suelen ser altas de clientes pendientes en el WMS).
6. Frecuencia: **nocturna diaria**.

## 7. Ejemplo completo (curl)

```bash
# 1) login
TOKEN=$(curl -s -X POST https://devoluciones.grupaldistribuidora.com.ar/api/auth/login/usuario \
  -H 'Content-Type: application/json' \
  -d '{"username":"integrador","clave":"LA_CLAVE"}' | jq -r .token)

# 2) importar saldo en consignación
curl -s -X POST https://devoluciones.grupaldistribuidora.com.ar/api/integraciones/consignacion/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "snapshotTs": "2026-06-17T02:00:00.000Z",
    "items": [
      {"nroCliente":"C-1024","isbn":"9789875668249","cantidad":5},
      {"nroCliente":"C-1024","isbn":"9788437604947","cantidad":2}
    ]
  }'
```

## 8. Seguridad / acuerdos

- La clave del usuario `integrador` se entrega por canal seguro y se **rota** ante cualquier sospecha.
- Solo HTTPS; el WMS valida tipo, tamaño y contenido de toda entrada (los campos desconocidos enviados de más se **rechazan**: validación estricta).
- El WMS audita las operaciones; cada corrida queda trazada con el usuario `integrador`.
- Cambios de contrato se comunican antes de desplegarse.
```
