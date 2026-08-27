import { describe, expect, it } from 'vitest'
import {
  assertCents,
  centsToDecimal,
  decimalToCents,
  formatCents,
  formatCentsCompact,
  scaleUpInt,
  sumCents,
} from '@/lib/money'

/**
 * `Intl` mete NBSP/narrow-NBSP entre el símbolo de moneda y el número en
 * `es-AR`. `\s` en un regex de JS ya matchea esos caracteres Unicode, así que
 * alcanza con colapsar todo a un espacio normal en vez de hardcodear el
 * carácter exacto (que varía según la versión de ICU del runtime).
 */
function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ')
}

describe('scaleUpInt — P-17: multiplicar por un decimal sin pasar por float', () => {
  it('20 × 1.1 da 22, el caso citado en el hallazgo', () => {
    expect(scaleUpInt(20, 1.1)).toBe(22)
  })

  it('50 × 1.1: Math.ceil(50 * 1.1) ingenuo da 56 por el error de punto flotante; el entero correcto es 55', () => {
    // 50 * 1.1 === 55.00000000000001 en IEEE-754 double.
    expect(Math.ceil(50 * 1.1)).toBe(56) // así se rompía antes
    expect(scaleUpInt(50, 1.1)).toBe(55) // así se arregla: en puntos base
  })

  it('90 × 1.1 también reproduce el error de float y scaleUpInt lo evita', () => {
    expect(Math.ceil(90 * 1.1)).toBe(100)
    expect(scaleUpInt(90, 1.1)).toBe(99)
  })

  it('redondea hacia arriba cuando el resultado realmente tiene fracción', () => {
    expect(scaleUpInt(7, 1.15)).toBe(9) // 7 * 1.15 = 8.05 minutos → 9
  })

  it('factor 1 no cambia el valor', () => {
    expect(scaleUpInt(45, 1)).toBe(45)
  })

  it('valor 0 da 0 sin importar el factor', () => {
    expect(scaleUpInt(0, 2.5)).toBe(0)
  })
})

describe('assertCents', () => {
  it('acepta un entero no negativo', () => {
    expect(assertCents(780000)).toBe(780000)
  })

  it('acepta 0', () => {
    expect(assertCents(0)).toBe(0)
  })

  it('rechaza un decimal: la plata nunca es float', () => {
    expect(() => assertCents(100.5)).toThrow()
  })

  it('rechaza un negativo', () => {
    expect(() => assertCents(-1)).toThrow()
  })

  it('el mensaje de error incluye la etiqueta pasada, para poder rastrear qué monto falló', () => {
    expect(() => assertCents(-1, 'total del pedido')).toThrow(/total del pedido/)
  })
})

describe('sumCents — propaga el rechazo de assertCents', () => {
  it('suma una lista de montos válidos', () => {
    expect(sumCents([100, 200, 300])).toBe(600)
  })

  it('la lista vacía suma 0', () => {
    expect(sumCents([])).toBe(0)
  })

  it('si un elemento es inválido, sumCents también tira (no lo ignora en silencio)', () => {
    expect(() => sumCents([100, -5, 200])).toThrow()
  })

  it('si un elemento es decimal, sumCents también tira', () => {
    expect(() => sumCents([100, 10.5])).toThrow()
  })
})

describe('centsToDecimal / decimalToCents — inversos en el rango realista', () => {
  it('7800 centavos ↔ 78.00', () => {
    expect(centsToDecimal(780000)).toBe(7800)
    expect(decimalToCents(7800)).toBe(780000)
  })

  it('round-trip para varios montos típicos de un pedido', () => {
    for (const cents of [1, 100, 999, 12345, 500000, 1999999]) {
      expect(decimalToCents(centsToDecimal(cents))).toBe(cents)
    }
  })

  it('decimalToCents rechaza NaN: un transaction_amount corrupto no puede convertirse en total de pedido', () => {
    expect(() => decimalToCents(NaN)).toThrow()
  })

  it('decimalToCents rechaza Infinity', () => {
    expect(() => decimalToCents(Infinity)).toThrow()
    expect(() => decimalToCents(-Infinity)).toThrow()
  })

  it('decimalToCents rechaza un decimal negativo', () => {
    expect(() => decimalToCents(-5)).toThrow()
  })
})

describe('formatCents — es-AR, con decimales', () => {
  it('formatea con separador de miles y dos decimales', () => {
    const out = collapseSpaces(formatCents(780000))
    expect(out).toBe('$ 7.800,00')
  })

  it('siempre imprime los dos decimales, incluso en un monto redondo', () => {
    const out = collapseSpaces(formatCents(100000))
    expect(out.endsWith(',00')).toBe(true)
  })

  it('usa el separador de miles con punto', () => {
    const out = collapseSpaces(formatCents(123456700))
    expect(out).toContain('.')
  })
})

describe('formatCentsCompact — es-AR, sin decimales', () => {
  it('no muestra decimales', () => {
    const out = collapseSpaces(formatCentsCompact(780000))
    expect(out).toBe('$ 7.800')
    expect(out).not.toMatch(/,\d{2}$/)
  })

  it('igual mantiene el separador de miles', () => {
    const out = collapseSpaces(formatCentsCompact(1234500))
    expect(out).toContain('.')
  })
})
