import { describe, expect, it } from 'vitest'
import { customerDirectoryRpcSchema, customerNotesSchema, unsubscribeTokenSchema } from '@/models/schemas/customer.schema'

/**
 * Los tres bordes de validación de T1A (padrón de clientes). Sin base: son
 * puramente Zod, y la garantía que importa es que rechacen basura ANTES de
 * que cualquier función del modelo toque Postgres — `customer.model.ts`
 * llama a `unsubscribeTokenSchema.safeParse` primero y solo consulta la base
 * si el formato ya es válido.
 */
describe('unsubscribeTokenSchema — el alfabeto de private.random_token(24), no cualquier string', () => {
  const validToken = '23456789abcdefghjkmnpqrs' // 24 chars, alfabeto real

  it('un token del largo y alfabeto correctos pasa', () => {
    expect(unsubscribeTokenSchema.safeParse(validToken).success).toBe(true)
  })

  it('BORDE: 23 caracteres (uno de menos) rechaza', () => {
    expect(unsubscribeTokenSchema.safeParse(validToken.slice(0, 23)).success).toBe(false)
  })

  it('BORDE: 25 caracteres (uno de más) rechaza', () => {
    expect(unsubscribeTokenSchema.safeParse(`${validToken}2`).success).toBe(false)
  })

  it.each(['0', '1', 'i', 'l', 'o'])(
    'rechaza el carácter confundible "%s" — el alfabeto de random_token los excluye a propósito',
    (char) => {
      const withConfusable = char + validToken.slice(1)
      expect(unsubscribeTokenSchema.safeParse(withConfusable).success).toBe(false)
    },
  )

  it('rechaza mayúsculas — random_token(24) genera siempre minúsculas', () => {
    expect(unsubscribeTokenSchema.safeParse(validToken.toUpperCase()).success).toBe(false)
  })

  it('rechaza un intento de inyección SQL disfrazado de token (el regex de alfabeto ya lo cierra, no hace falta escapar nada río abajo)', () => {
    expect(unsubscribeTokenSchema.safeParse("'; drop table store_customers; --").success).toBe(false)
  })

  it('recorta espacios alrededor (pegado accidental desde un mail) antes de validar el alfabeto', () => {
    expect(unsubscribeTokenSchema.safeParse(`  ${validToken}  `)).toMatchObject({ success: true, data: validToken })
  })
})

describe('customerNotesSchema — la nota interna del dueño', () => {
  it('un texto normal pasa', () => {
    expect(customerNotesSchema.safeParse('Pide siempre sin cebolla').success).toBe(true)
  })

  it('BORDE: exactamente 2000 caracteres pasa', () => {
    expect(customerNotesSchema.safeParse('a'.repeat(2000)).success).toBe(true)
  })

  it('BORDE: 2001 caracteres rechaza', () => {
    const result = customerNotesSchema.safeParse('a'.repeat(2001))
    expect(result.success).toBe(false)
  })

  it('string vacío es válido — customer.model.ts lo convierte a null (borrar la nota), no es un error de formato', () => {
    expect(customerNotesSchema.safeParse('').success).toBe(true)
  })
})

describe('customerDirectoryRpcSchema — el borde no tipado de store_customer_directory (Returns: Json)', () => {
  function validCustomer(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      storeId: 7,
      phoneE164: '+5491100000000',
      displayName: 'Cliente',
      email: null,
      ordersCount: 1,
      totalSpentCents: 1000,
      avgTicketCents: 1000,
      cancelledOrdersCount: 0,
      firstOrderAt: '2026-01-01T00:00:00.000Z',
      lastOrderAt: '2026-01-01T00:00:00.000Z',
      daysSinceLastOrder: 5,
      marketingOptOutAt: null,
      notes: null,
      ...overrides,
    }
  }

  it('la forma completa y válida pasa', () => {
    const payload = { customers: [validCustomer()], totals: { customers: 1, withEmail: 0, inactive30: 0 } }
    expect(customerDirectoryRpcSchema.safeParse(payload).success).toBe(true)
  })

  it('rechaza si una redefinición futura de la función SQL le cambia el nombre a una clave (ej. total_spent_cents en vez de totalSpentCents)', () => {
    const broken = validCustomer({ totalSpentCents: undefined, total_spent_cents: 1000 })
    const payload = { customers: [broken], totals: { customers: 1, withEmail: 0, inactive30: 0 } }
    expect(customerDirectoryRpcSchema.safeParse(payload).success).toBe(false)
  })

  it('rechaza si totals no viene (la RPC devolvió solo el array, por ejemplo)', () => {
    expect(customerDirectoryRpcSchema.safeParse({ customers: [] }).success).toBe(false)
  })

  it('un array de customers vacío con totals en cero es válido — es el padrón sin clientes todavía', () => {
    const payload = { customers: [], totals: { customers: 0, withEmail: 0, inactive30: 0 } }
    expect(customerDirectoryRpcSchema.safeParse(payload).success).toBe(true)
  })
})
