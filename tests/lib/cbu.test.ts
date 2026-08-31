import { describe, expect, it } from 'vitest'
import {
  ALIAS_PATTERN,
  CBU_LENGTH,
  bankNameForCbu,
  cbuEntityCode,
  isCvu,
  isValidAlias,
  isValidCbu,
  normalizeAlias,
  normalizeCbu,
} from '@/lib/cbu'

/**
 * `src/lib/cbu.ts` — checksum de CBU/CVU (módulo 10, ponderador 9713) y forma
 * de alias. Es la única defensa contra el error más frecuente en este medio
 * de pago: un dígito mal tipeado que manda la plata de todos los clientes del
 * local a ningún lado (00-architecture.md §3.1).
 *
 * Los dos vectores de abajo son reales, documentados y verificados en
 * `00-architecture.md` §3.1 y en el dev log de T1: un CVU de Mercado Pago y
 * un CBU bancario real, publicados por sus emisores.
 */
const MP_CVU = '0000003100023596996524' // CVU de Mercado Pago — posiciones 4-7 = '0003'
const REAL_CBU = '0070325120000003733248'

describe('isValidCbu — el checksum es la defensa contra el dedo gordo', () => {
  it('acepta el CVU real de Mercado Pago', () => {
    expect(isValidCbu(MP_CVU)).toBe(true)
  })

  it('acepta el CBU bancario real', () => {
    expect(isValidCbu(REAL_CBU)).toBe(true)
  })

  it('mutar CUALQUIER dígito de cualquiera de los dos vectores lo invalida (barrido completo de las 22 posiciones)', () => {
    for (const original of [MP_CVU, REAL_CBU]) {
      for (let i = 0; i < CBU_LENGTH; i++) {
        const digits = original.split('')
        // Cambiar el dígito de la posición i por otro distinto (mod 10 evita
        // "cambiarlo" por el mismo valor si el dígito original ya era alto).
        digits[i] = String((Number(digits[i]) + 1) % 10)
        const mutated = digits.join('')
        expect(isValidCbu(mutated), `posición ${i} de ${original} debería invalidar`).toBe(false)
      }
    }
  })

  it('rechaza longitud distinta de 22', () => {
    expect(isValidCbu(REAL_CBU.slice(0, 21))).toBe(false)
    expect(isValidCbu(REAL_CBU + '0')).toBe(false)
  })

  it('rechaza si contiene algo que no sea dígito', () => {
    expect(isValidCbu(`${REAL_CBU.slice(0, 21)}x`)).toBe(false)
  })

  /**
   * El caso obligatorio de `01-tasks.md`: un CBU cuyo bloque suma resto 0
   * (DV = 0). El texto del BCRA dice "el resto se deducirá de 10", lo que
   * daría 10 — imposible como dígito único. El comportamiento real es 0, y es
   * exactamente lo que rompe si a alguien se le ocurre "simplificar" a
   * `10 - (sum % 10)` sin el `% 10` exterior. Prefijo de CVU de Prex:
   * `0000013` (bloque 1) suma 10, resto 0, DV real 0.
   */
  it('DV = 0: el prefijo de Prex (bloque 0000013, suma ponderada 10, resto 0) valida con DV 0, no con DV 10', () => {
    // Bloque 1 = '0000013', pesos [7,1,3,9,7,1,3]:
    //   0·7+0·1+0·3+0·9+0·7+1·1+3·3 = 10, resto 0 → DV = (10 − 0) % 10 = 0.
    // Se completa con el bloque 2 + DV2 del vector real de Mercado Pago (ya
    // verificado arriba), para no depender de una segunda copia del algoritmo.
    const block2 = MP_CVU.slice(8, 21)
    const dv2 = MP_CVU[21]
    const cbuWithDvZero = `0000013` + '0' + block2 + dv2
    expect(cbuWithDvZero).toHaveLength(CBU_LENGTH)
    expect(isValidCbu(cbuWithDvZero)).toBe(true)

    // Control: cualquier otro dígito en esa posición (el DV "ingenuo" sería
    // 10, irrepresentable como un solo dígito) tiene que rechazar.
    const wrongDv = `0000013` + '1' + block2 + dv2
    expect(isValidCbu(wrongDv)).toBe(false)
  })
})

describe('isCvu — pregunta de FORMA, no de validez', () => {
  it('el CVU real de Mercado Pago es un CVU', () => {
    expect(isCvu(MP_CVU)).toBe(true)
  })

  it('el CBU bancario real NO es un CVU', () => {
    expect(isCvu(REAL_CBU)).toBe(false)
  })

  it('un string de 22 dígitos que empieza con "000" pero con DV malo SIGUE siendo un CVU (de forma), aunque sea inválido', () => {
    const brokenCvu = `${MP_CVU.slice(0, 21)}${MP_CVU[21] === '0' ? '1' : '0'}`
    expect(isCvu(brokenCvu)).toBe(true)
    expect(isValidCbu(brokenCvu)).toBe(false)
  })

  it('forma inválida (longitud distinta) nunca es un CVU', () => {
    expect(isCvu('000123')).toBe(false)
  })
})

describe('cbuEntityCode', () => {
  it('las tres primeras posiciones, tal cual', () => {
    expect(cbuEntityCode(REAL_CBU)).toBe('007')
    expect(cbuEntityCode(MP_CVU)).toBe('000')
  })

  it('null si la forma no es la de un CBU/CVU', () => {
    expect(cbuEntityCode('123')).toBeNull()
  })
})

describe('bankNameForCbu', () => {
  it('resuelve el PSP de un CVU de Mercado Pago (código 0003)', () => {
    expect(bankNameForCbu(MP_CVU)).toBe('Mercado Pago')
  })

  it('resuelve el banco de un CBU real de la tabla embebida (007 = Banco de Galicia)', () => {
    expect(bankNameForCbu(REAL_CBU)).toBe('Banco de Galicia y Buenos Aires S.A.')
  })

  it('null para un código de entidad que la tabla no cubre — sin drama, no es un banco inexistente', () => {
    // '999' no está en ENTITY_NAMES ni es CVU.
    const unknownEntity = `999${REAL_CBU.slice(3)}`
    expect(bankNameForCbu(unknownEntity)).toBeNull()
  })

  it('null si la forma no es válida', () => {
    expect(bankNameForCbu('no-es-un-cbu')).toBeNull()
  })
})

describe('normalizeCbu / normalizeAlias', () => {
  it('normalizeCbu saca espacios y guiones de un CBU pegado con formato', () => {
    expect(normalizeCbu('007 0325 12 0000003733248')).toBe(REAL_CBU)
    expect(normalizeCbu('007-0325-12-0000003733248')).toBe(REAL_CBU)
  })

  it('normalizeAlias hace trim y minúsculas', () => {
    expect(normalizeAlias('  La.Birra-Pagos  ')).toBe('la.birra-pagos')
  })
})

describe('isValidAlias / ALIAS_PATTERN — 6 a 20 caracteres, [A-Za-z0-9.-]', () => {
  it('acepta el mínimo (6 caracteres)', () => {
    expect(isValidAlias('abc.12')).toBe(true)
  })

  it('acepta el máximo (20 caracteres)', () => {
    expect(isValidAlias('a'.repeat(20))).toBe(true)
  })

  it('rechaza 5 caracteres (uno menos que el mínimo)', () => {
    expect(isValidAlias('abc.1')).toBe(false)
  })

  it('rechaza 21 caracteres (uno más que el máximo)', () => {
    expect(isValidAlias('a'.repeat(21))).toBe(false)
  })

  it('rechaza espacio', () => {
    expect(isValidAlias('la birra')).toBe(false)
  })

  it('rechaza guion bajo', () => {
    expect(isValidAlias('la_birra')).toBe(false)
  })

  it('rechaza arroba', () => {
    expect(isValidAlias('la@birra')).toBe(false)
  })

  it('acepta punto y guion medio, que sí son válidos', () => {
    expect(isValidAlias('la.birra-pagos')).toBe(true)
  })

  it('el pattern exportado coincide con isValidAlias', () => {
    expect(ALIAS_PATTERN.test('la.birra-pagos')).toBe(true)
  })
})
