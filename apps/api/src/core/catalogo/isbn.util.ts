/**
 * Normalización y validación de ISBN. El "número de serie" del negocio es el
 * ISBN (EAN-13). Acepta ISBN-10 y lo convierte a ISBN-13; valida dígito de control.
 */

function soloDigitos(valor: string): string {
  return valor.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function checksumIsbn13(doce: string): number {
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    suma += Number(doce[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (suma % 10)) % 10;
}

function isbn10a13(isbn10: string): string | null {
  if (isbn10.length !== 10) return null;
  const cuerpo = '978' + isbn10.slice(0, 9);
  return cuerpo + String(checksumIsbn13(cuerpo));
}

/**
 * Devuelve el ISBN normalizado a 13 dígitos si es válido, o null si no lo es.
 */
export function normalizarIsbn(entrada: string): string | null {
  const limpio = soloDigitos(entrada);

  if (limpio.length === 10) {
    // Validar checksum ISBN-10 antes de convertir.
    let suma = 0;
    for (let i = 0; i < 10; i++) {
      const c = limpio[i];
      const val = c === 'X' ? 10 : Number(c);
      if (Number.isNaN(val)) return null;
      suma += val * (10 - i);
    }
    if (suma % 11 !== 0) return null;
    return isbn10a13(limpio);
  }

  if (limpio.length === 13) {
    if (!/^\d{13}$/.test(limpio)) return null;
    if (checksumIsbn13(limpio.slice(0, 12)) !== Number(limpio[12])) return null;
    return limpio;
  }

  return null;
}

export function esIsbnValido(entrada: string): boolean {
  return normalizarIsbn(entrada) !== null;
}
