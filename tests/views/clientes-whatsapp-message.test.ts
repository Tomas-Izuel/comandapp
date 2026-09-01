import { describe, expect, it } from 'vitest'

process.env.NEXT_PUBLIC_SITE_URL = 'https://comandapp.ar'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
// Fijado explícito: otro archivo del suite (order-tracking-host-coherence.test.ts)
// setea esta variable a 'subdomain' sin volver a limpiarla, y `env.client.ts`
// la lee una sola vez al importar el módulo. Sin este pin, el resultado de
// `storeUrl()` (y por lo tanto el link del mensaje de reactivación) depende
// de qué archivo corrió antes en el mismo worker — exactamente el problema
// que `tests/lib/urls.test.ts` ya documenta y resetea test por test.
process.env.NEXT_PUBLIC_STORE_HOST_MODE = 'path'

const { buildCustomerWhatsappMessage } = await import('@/views/admin/clientes/whatsapp-message')
type StoreCustomer = Parameters<typeof buildCustomerWhatsappMessage>[0]

/**
 * `buildCustomerWhatsappMessage` — los DOS mensajes precargados de la
 * Entrega A (00-architecture.md §5.5.1). Es EL mecanismo de reactivación (no
 * hay segmento de campaña), así que las cuatro reglas del copy son criterio
 * de aceptación, no estilo: nunca la plata del cliente, nunca un hecho que no
 * tenemos, y `{nombre}` es solo el primer token.
 */
function customer(overrides: Partial<StoreCustomer> = {}): StoreCustomer {
  return {
    id: 1,
    storeId: 7,
    phoneE164: '+5491100000000',
    displayName: 'Juan Pérez',
    email: null,
    ordersCount: 3,
    totalSpentCents: 8_400_00, // $84.000 — la cifra invasiva del ejemplo de la spec
    avgTicketCents: 280_000,
    cancelledOrdersCount: 0,
    firstOrderAt: '2026-01-01T00:00:00.000Z',
    lastOrderAt: '2026-06-01T00:00:00.000Z',
    daysSinceLastOrder: 5,
    marketingOptOutAt: null,
    notes: null,
    ...overrides,
  }
}

describe('buildCustomerWhatsappMessage', () => {
  it('regla dura: NUNCA incluye la plata del cliente, aunque totalSpentCents esté disponible en la fila', () => {
    const c = customer({ totalSpentCents: 8_400_00, daysSinceLastOrder: 45 })
    const message = buildCustomerWhatsappMessage(c, 'La Birra Burgers', 'la-birra')

    expect(message).not.toMatch(/84[.,]?000/)
    expect(message).not.toContain(String(c.totalSpentCents))
  })

  it('{nombre} es SOLO el primer token de displayName, nunca el apellido', () => {
    const c = customer({ displayName: 'Juan Pérez', daysSinceLastOrder: 2 })
    const message = buildCustomerWhatsappMessage(c, 'La Birra Burgers', 'la-birra')

    expect(message).toContain('Juan')
    expect(message).not.toContain('Pérez')
  })

  it('BORDE: daysSinceLastOrder = 29 → mensaje default, SIN link (todavía no es reactivación)', () => {
    const c = customer({ daysSinceLastOrder: 29 })
    const message = buildCustomerWhatsappMessage(c, 'La Birra Burgers', 'la-birra')

    expect(message).not.toContain('comandapp.ar')
    expect(message).not.toMatch(/no te vemos/)
  })

  it('BORDE: daysSinceLastOrder = 30 → mensaje de reactivación, CON el link de la carta', () => {
    const c = customer({ daysSinceLastOrder: 30 })
    const message = buildCustomerWhatsappMessage(c, 'La Birra Burgers', 'la-birra')

    expect(message).toMatch(/no te vemos/)
    expect(message).toContain('comandapp.ar/la-birra')
  })

  it('daysSinceLastOrder null (nunca compró antes, cliente nuevo con pedido cancelado) → mensaje default, no reactivación', () => {
    const c = customer({ daysSinceLastOrder: null })
    const message = buildCustomerWhatsappMessage(c, 'La Birra Burgers', 'la-birra')

    expect(message).not.toMatch(/no te vemos/)
  })

  it('nunca inventa un hecho que el producto no registra (nada de "sabemos que te gustan las dobles")', () => {
    const c = customer({ daysSinceLastOrder: 60 })
    const message = buildCustomerWhatsappMessage(c, 'La Birra Burgers', 'la-birra')

    expect(message.toLowerCase()).not.toContain('doble')
    expect(message.toLowerCase()).not.toContain('sabemos que')
  })

  it('suena a persona: nunca "usted" ni "estimado cliente"', () => {
    for (const days of [null, 5, 30, 90]) {
      const message = buildCustomerWhatsappMessage(customer({ daysSinceLastOrder: days }), 'La Birra Burgers', 'la-birra')
      expect(message.toLowerCase()).not.toContain('usted')
      expect(message.toLowerCase()).not.toContain('estimado')
    }
  })
})
