import { describe, expect, it } from 'vitest'
import { bankAccountInputSchema } from '@/models/schemas/store.schema'

/**
 * `bankAccountInputSchema` (`store.schema.ts`) — la puerta de entrada del CBU
 * que el dueño carga en `/admin/pagos`. Dos invariantes se juegan acá:
 *
 * 1. `.strict()`, mismo motivo que `cartItemSchema`/`createOrderSchema`: una
 *    clave que el schema no conoce (por ejemplo, alguien intentando mandar
 *    `holderMatch` desde el browser) tiene que rebotar con 400, no perderse
 *    en silencio.
 * 2. D3 (00-architecture.md §8): cualquiera de los tres identificadores sirve
 *    — CBU, CVU o alias —, pero al menos uno tiene que estar. Es el espejo
 *    exacto del CHECK `store_bank_accounts_has_identifier_check` de Postgres.
 */
const VALID_CBU = '0070325120000003733248'

describe('bankAccountInputSchema — .strict() como propiedad de seguridad', () => {
  it('rechaza una clave desconocida', () => {
    const result = bankAccountInputSchema.safeParse({
      cbu: VALID_CBU,
      holderName: 'La Birra SRL',
      holderMatch: 'match', // no es un campo de INPUT: lo calcula el servidor
    })
    expect(result.success).toBe(false)
  })

  it('acepta el objeto mínimo válido (solo cbu + holderName)', () => {
    const result = bankAccountInputSchema.safeParse({ cbu: VALID_CBU, holderName: 'La Birra SRL' })
    expect(result.success).toBe(true)
  })
})

describe('bankAccountInputSchema — checksum del CBU', () => {
  it('un CBU con el dígito verificador mal da un mensaje que NOMBRA el problema, no "campo inválido"', () => {
    const brokenCbu = `${VALID_CBU.slice(0, 21)}${VALID_CBU[21] === '0' ? '1' : '0'}`
    const result = bankAccountInputSchema.safeParse({ cbu: brokenCbu, holderName: 'La Birra SRL' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/dígitos verificadores/)
    }
  })

  it('acepta un CBU con espacios/guiones — se normaliza antes de validar', () => {
    const result = bankAccountInputSchema.safeParse({ cbu: '007-0325-12-0000003733248', holderName: 'La Birra SRL' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.cbu).toBe(VALID_CBU)
  })
})

describe('bankAccountInputSchema — D3: CBU, CVU o alias, cualquiera de los tres', () => {
  it('rechaza un objeto sin cbu NI alias (espejo del CHECK de la base)', () => {
    const result = bankAccountInputSchema.safeParse({ holderName: 'La Birra SRL' })
    expect(result.success).toBe(false)
  })

  it('ACEPTA un objeto con SOLO alias (sin cbu) — decisión D3, no un olvido', () => {
    const result = bankAccountInputSchema.safeParse({ alias: 'la.birra.pagos', holderName: 'La Birra SRL' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cbu).toBeUndefined()
      expect(result.data.alias).toBe('la.birra.pagos')
    }
  })

  it('un alias con formato inválido rechaza con mensaje propio', () => {
    const result = bankAccountInputSchema.safeParse({ alias: 'ab', holderName: 'La Birra SRL' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/6 a 20 caracteres/)
  })

  it('un cbu/alias vacío (string "") se trata como AUSENTE, no como inválido — y sigue exigiendo al menos uno', () => {
    const result = bankAccountInputSchema.safeParse({ cbu: '', alias: '', holderName: 'La Birra SRL' })
    expect(result.success).toBe(false)
  })

  it('con cbu Y alias los dos presentes, entran los dos', () => {
    const result = bankAccountInputSchema.safeParse({
      cbu: VALID_CBU,
      alias: 'la.birra.pagos',
      holderName: 'La Birra SRL',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cbu).toBe(VALID_CBU)
      expect(result.data.alias).toBe('la.birra.pagos')
    }
  })
})

describe('bankAccountInputSchema — holderName y holderTaxId', () => {
  it('rechaza holderName vacío', () => {
    const result = bankAccountInputSchema.safeParse({ cbu: VALID_CBU, holderName: '' })
    expect(result.success).toBe(false)
  })

  it('holderTaxId opcional: ausente no rompe nada', () => {
    const result = bankAccountInputSchema.safeParse({ cbu: VALID_CBU, holderName: 'La Birra SRL' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.holderTaxId).toBeUndefined()
  })

  it('holderTaxId se normaliza a solo dígitos y exige 11', () => {
    const result = bankAccountInputSchema.safeParse({
      cbu: VALID_CBU,
      holderName: 'La Birra SRL',
      holderTaxId: '20-11111111-2',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.holderTaxId).toBe('20111111112')
  })

  it('holderTaxId con menos de 11 dígitos rechaza', () => {
    const result = bankAccountInputSchema.safeParse({
      cbu: VALID_CBU,
      holderName: 'La Birra SRL',
      holderTaxId: '2011111111', // 10 dígitos
    })
    expect(result.success).toBe(false)
  })
})

describe('bankAccountInputSchema — bankName no es un campo de input', () => {
  it('bankName no está en el schema: mandarlo es una clave desconocida y rebota por .strict()', () => {
    const result = bankAccountInputSchema.safeParse({
      cbu: VALID_CBU,
      holderName: 'La Birra SRL',
      bankName: 'Un banco cualquiera',
    })
    expect(result.success).toBe(false)
  })
})
