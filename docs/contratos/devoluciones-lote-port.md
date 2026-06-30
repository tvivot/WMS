# Contrato — DevolucionesLotePort (lotes de devolución del ERP)

Puerto inbound por el que **Integraciones** carga los **lotes de devolución** que
manda el ERP (Fierro). El dato es dueño de **Devoluciones** (tablas `dev_lote` /
`dev_lote_item`); Integraciones no toca internos, solo invoca el puerto.

- **Puerto:** `apps/api/src/modulos/devoluciones/puertos/lote.port.ts`
  (`DevolucionesLotePort.importarLotes()`, token `DEVOLUCIONES_LOTE_PORT`).
- **Adapter:** `puertos/lote.adapter.ts` (`PrismaLoteAdapter`).
- **Endpoint:** `POST /api/integraciones/devoluciones/lotes/import`
  · permiso **`devolucion.importar`**.

## Identidad e idempotencia
Identidad por **`codigo`** (= `return_lot.document_id` de Fierro). El import hace
**upsert por `codigo`** y **reemplaza** todos los renglones del lote. Reenviar el
mismo lote deja el mismo estado (idempotente). Dentro de un mismo batch, si llega
dos veces el mismo `codigo`, gana la última cabecera; dentro de un lote, si llega
dos veces el mismo ISBN, gana el último renglón.

## Request
```json
{
  "lotes": [
    {
      "codigo": "RL-00012345",
      "numero": "12345",
      "fecha": "2026-06-25",
      "nroCliente": "1001",
      "clienteNombre": "Librería X",
      "deposito": "Central",
      "estado": "CERRADO",
      "motivo": "Devolución editorial",
      "remitoCliente": "R-0001",
      "fechaRemitoCliente": "2026-06-20",
      "totalItems": 2,
      "items": [
        { "isbn": "9780131103627", "cantidad": 3, "cantidadCliente": 3, "cantidadRechazada": 0, "titulo": "...", "intCode": "INT-1" }
      ]
    }
  ]
}
```
- Límites (hardening): hasta **1000 lotes** por request y **5000 ítems** por lote.
- `codigo` y `nroCliente` obligatorios; el resto opcional.
- **Fechas (`fecha`, `fechaRemitoCliente`):** se guardan **tal cual** las manda el
  ERP (string), sin parsear (evita ambigüedad de zona horaria).
- **ISBN:** se normaliza (ISBN-10 → ISBN-13, valida checksum). Un ISBN inválido se
  reporta en `errores` y se descarta ese renglón, sin abortar el lote.

## Response
```json
{ "recibidos": 1, "creados": 1, "actualizados": 0, "errores": [ { "codigo": "...", "error": "..." } ] }
```

## Uso en el WMS
El lote es el dato **oficial** del ERP contra el que la **reconciliación** (al
cerrar la devolución) compara, por ISBN, **lo declarado por el cliente** en el WMS
(`dev_declaracion`) → faltante/sobrante. La devolución referencia el lote por su
`codigo` al cerrar.

> Si más adelante existe un módulo propio de lotes/recepción que sea dueño de la
> tabla, expone su adapter y se cambia UNA línea en `devoluciones.module.ts`
> (igual que `UBICACION_RESOLVER` / `CONSIGNACION_PORT`), sin tocar el resto.
