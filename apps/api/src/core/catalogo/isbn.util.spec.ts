import { esIsbnValido, normalizarIsbn } from './isbn.util';

describe('normalizarIsbn', () => {
  it('acepta un ISBN-13 válido', () => {
    expect(normalizarIsbn('9780131103627')).toBe('9780131103627');
  });

  it('ignora separadores', () => {
    expect(normalizarIsbn('978-0-13-110362-7')).toBe('9780131103627');
  });

  it('convierte ISBN-10 válido a ISBN-13', () => {
    expect(normalizarIsbn('0131103628')).toBe('9780131103627');
  });

  it('rechaza dígito de control inválido (ISBN-13)', () => {
    expect(normalizarIsbn('9780131103628')).toBeNull();
  });

  it('rechaza basura', () => {
    expect(normalizarIsbn('hola')).toBeNull();
    expect(esIsbnValido('123')).toBe(false);
  });
});
