import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateOrderInput } from '@/models/schemas/order.schema'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `clientEnv`/`serverEnv` cachean en una variable de módulo y se parsean al
 * importar (`src/lib/env.client.ts`, `src/lib/env.server.ts`); `order.model.ts`
 * los toca indirectamente (vía `productImageUrl`). Mínimo necesario, igual que
 * `tests/models/platform-owner-invite.model.test.ts`.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `createOrder` (`src/models/order.model.ts`) recorrido completo: lee la
 * tienda, aplica las guardas de medio de pago, arma el precio (`priceCart`),
 * estima el ETA (`estimateEta`) y llama a la RPC `create_order`. Se mockea
 * SOLO el cliente admin (el borde real de Postgres) — la orquestación entre
 * las tres guardas y el resto del flujo corre de verdad, que es justo lo que
 * este archivo prueba.
 *
 * `deliveryMethod` se deja en el default `pickup` en todos los casos: así no
 * hace falta mockear `getCourierAvailability` (solo se llama con `delivery`),
 * y el foco queda en las guardas de medio de pago, no en el envío.
 */
const STORE_ID = 7
const PRODUCT_ID = 1

function storeRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: STORE_ID,
    slug: 'la-birra',
    name: 'La Birra',
    description: null,
    phone_e164: null,
    whatsapp_phone_e164: null,
    address: null,
    timezone: 'America/Argentina/Cordoba',
    currency: 'ARS',
    status: 'active',
    accepting_orders: true,
    in_store_payment_enabled: false,
    online_payment_enabled: false,
    min_order_cents: 0,
    demand_threshold_orders: 5,
    demand_multiplier: '1.00',
    auto_start_orders: false,
    auto_ready_orders: false,
    latitude: null,
    longitude: null,
    instagram_handle: null,
    maps_url: null,
    rappi_url: null,
    pedidos_ya_url: null,
    uber_eats_url: null,
    delivery_enabled: false,
    delivery_fee_cents: 0,
    delivery_free_from_cents: 0,
    delivery_min_order_cents: 0,
    delivery_minutes: 15,
    delivery_busy_minutes: 30,
    courier_collects_payment: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function productFixture() {
  return {
    id: PRODUCT_ID,
    name: 'Burger Clásica',
    image_path: null,
    price_cents: 5000,
    prep_minutes: 10,
    is_available: true,
    option_groups: [],
  }
}

function orderRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 555,
    store_id: STORE_ID,
    short_code: 'AB12',
    public_token: '1234567890123456789012ab',
    status: 'pending',
    customer_name: 'Cliente Test',
    customer_phone_e164: '+5493511234567',
    customer_email: null,
    notes: null,
    currency: 'ARS',
    subtotal_cents: 10000,
    total_cents: 10000,
    base_prep_minutes: 10,
    demand_multiplier: '1.00',
    eta_minutes: 10,
    eta_at: '2026-01-01T00:10:00.000Z',
    payment_method: 'online',
    payment_status: 'pending',
    preference_id: null,
    preference_expires_at: null,
    payment_ref: null,
    external_ref: null,
    confirmed_at: null,
    paid_at: null,
    ready_at: null,
    delivered_at: null,
    cancelled_at: null,
    needs_refund_at: null,
    refund_reason: null,
    refunded_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    delivery_method: 'pickup',
    delivery_fee_cents: 0,
    delivery_address_line: null,
    delivery_address_unit: null,
    delivery_address_between: null,
    delivery_address_notes: null,
    delivery_minutes: null,
    courier_id: null,
    courier: null,
    assigned_at: null,
    on_the_way_at: null,
    order_items: [],
    ...overrides,
  }
}

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

/**
 * Dispatcher por tabla, en el mismo estilo que
 * `platform-owner-invite.model.test.ts`. `orders` atiende DOS formas de
 * `select` distintas (`estimateEta` cuenta filas con `head:true`; la lectura
 * final trae el pedido completo): se distinguen por el primer argumento de
 * `select`, no por orden de llamada — es lo único estable si el cuerpo de
 * `createOrder` se reordena.
 */
function buildAdminMock(opts: { storeRow: ReturnType<typeof storeRowFixture>; activeOrders?: number }) {
  return {
    from: (table: string) => {
      if (table === 'stores') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.storeRow, error: null }),
            }),
          }),
        }
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [productFixture()], error: null }),
            }),
          }),
        }
      }
      if (table === 'orders') {
        return {
          select: (columns: string) => {
            if (columns === 'id') {
              // estimateEta: cuenta pedidos "en la plancha".
              return {
                eq: () => ({
                  in: async () => ({ count: opts.activeOrders ?? 0, error: null }),
                }),
              }
            }
            // Lectura final del pedido recién creado.
            return {
              eq: () => ({
                single: async () => ({ data: orderRowFixture(), error: null }),
              }),
            }
          },
        }
      }
      throw new Error(`tabla admin inesperada en el test: ${table}`)
    },
    rpc: rpcMock,
  }
}

// `let` porque cada test necesita un mock con un `storeRow` distinto (activo,
// suspendido, con/sin medios de pago). El factory de `vi.mock` de abajo la
// resuelve por closure EN EL MOMENTO en que `createOrder` llama a
// `createAdminClient()` (dentro del test, no al cargar el módulo), así que
// reasignarla al principio de cada `it` alcanza — no hace falta `vi.resetModules()`.
let currentAdminMock: ReturnType<typeof buildAdminMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => currentAdminMock,
}))

const { createOrder } = await import('@/models/order.model')
const { DomainError } = await import('@/lib/errors')

function orderInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    storeSlug: 'la-birra',
    idempotencyKey: randomUUID(),
    items: [{ productId: PRODUCT_ID, quantity: 2, optionIds: [] }],
    paymentMethod: 'online',
    customerName: 'Cliente Test',
    customerPhone: '1123456789',
    customerEmail: undefined,
    notes: undefined,
    deliveryMethod: 'pickup',
    deliveryAddressLine: undefined,
    deliveryAddressUnit: undefined,
    deliveryAddressBetween: undefined,
    deliveryAddressNotes: undefined,
    ...overrides,
  }
}

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: 555, error: null })
})

describe('createOrder — precedencia de las guardas de medio de pago', () => {
  it('sin NINGÚN medio de pago, pide "online" → el mensaje es el genérico, no el de "no cobra online"', async () => {
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: false, in_store_payment_enabled: false }),
    })

    await expect(createOrder(orderInput({ paymentMethod: 'online' }))).rejects.toThrow(
      'Este local todavía no tiene un medio de pago activo',
    )
  })

  it('sin NINGÚN medio de pago, pide "in_store" → SIGUE siendo el genérico, no "no acepta pago al retirar"', async () => {
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: false, in_store_payment_enabled: false }),
    })

    await expect(createOrder(orderInput({ paymentMethod: 'in_store' }))).rejects.toThrow(
      'Este local todavía no tiene un medio de pago activo',
    )
  })

  it('con pago en el local activo pero online no, pedir "online" da el mensaje ESPECÍFICO (canCollectPayment ya pasó)', async () => {
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: false, in_store_payment_enabled: true }),
    })

    await expect(createOrder(orderInput({ paymentMethod: 'online' }))).rejects.toThrow(
      'Este local no está cobrando online por ahora',
    )
  })

  it('con Mercado Pago activo pero pago en el local no, pedir "in_store" da el mensaje ESPECÍFICO', async () => {
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: true, in_store_payment_enabled: false }),
    })

    await expect(createOrder(orderInput({ paymentMethod: 'in_store' }))).rejects.toThrow(
      'Esta tienda no acepta pago al retirar',
    )
  })

  it('las tres son DomainError (400), no un error interno', async () => {
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: false, in_store_payment_enabled: false }),
    })

    await expect(createOrder(orderInput())).rejects.toBeInstanceOf(DomainError)
  })
})

describe('createOrder — camino feliz: las guardas nuevas no rompen un pedido online normal', () => {
  it('Mercado Pago conectado y pago en el local deshabilitado → el pedido online se crea igual', async () => {
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: true, in_store_payment_enabled: false }),
    })

    const { order } = await createOrder(orderInput({ paymentMethod: 'online' }))

    expect(order.id).toBe(555)
    // Llegó hasta la RPC: las guardas de arriba no cortaron el camino.
    expect(rpcMock).toHaveBeenCalledOnce()
    const [fnName, args] = rpcMock.mock.calls[0] as [string, { p_order: { payment_method: string } }]
    expect(fnName).toBe('create_order')
    expect(args.p_order.payment_method).toBe('online')
  })
})
