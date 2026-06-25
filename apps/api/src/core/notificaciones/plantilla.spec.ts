import { parsearEmails, renderPlantilla, unirEmails, estadoLabel } from './plantilla';

describe('plantilla', () => {
  it('renderPlantilla reemplaza placeholders y traduce el estado', () => {
    const out = renderPlantilla('#{{nro}} {{cliente}} → {{estado}} (de {{ estadoAnterior }})', {
      nro: 7,
      cliente: 'Librería X',
      estado: 'EN_TRANSITO',
      estadoAnterior: 'APROBADO',
      fecha: '01/01',
    });
    expect(out).toBe('#7 Librería X → En tránsito (de Aprobado)');
  });

  it('renderPlantilla deja vacío un campo ausente y conserva placeholders desconocidos', () => {
    const out = renderPlantilla('{{cliente}}|{{estadoAnterior}}|{{otro}}', {
      nro: 1,
      cliente: 'A',
      estado: 'PROCESADO',
      fecha: 'hoy',
    });
    expect(out).toBe('A||{{otro}}');
  });

  it('estadoLabel cae al código si no lo conoce', () => {
    expect(estadoLabel('PROCESADO')).toBe('Procesado');
    expect(estadoLabel('RARO')).toBe('RARO');
  });

  it('parsearEmails separa por coma/;/salto, recorta, descarta inválidos y deduplica', () => {
    const r = parsearEmails('a@x.com, b@x.com; a@x.com\n no-mail \nC@X.com');
    expect(r).toEqual(['a@x.com', 'b@x.com', 'C@X.com']); // a@x.com una vez (case-insensitive)
  });

  it('parsearEmails tolera null/undefined/vacío', () => {
    expect(parsearEmails(null)).toEqual([]);
    expect(parsearEmails(undefined)).toEqual([]);
    expect(parsearEmails('   ')).toEqual([]);
  });

  it('unirEmails deduplica entre listas preservando orden', () => {
    expect(unirEmails(['a@x.com'], ['A@X.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
  });
});
