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
    scheduled_delivery_enabled: false,
    scheduled_capacity_per_night: null,
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
    // Un pedido inmediato (la mayoría de los fixtures de este archivo) no
    // programa nada: los tres campos nuevos de horarios quedan en null, igual
    // que en la base para cualquier fila creada antes de este feature.
    scheduled_for: null,
    fire_at: null,
    scheduled_night: null,
    ...overrides,
  }
}

/** Fila de `store_hours`: un rango semanal, tal como lo lee `getStoreScheduleForOrder`. */
function weeklyRowFixture(overrides: Record<string, unknown> = {}) {
  return { day_of_week: 0, opens_at_minute: 0, duration_minutes: 1440, ...overrides }
}

const { rpcMock, courierAvailabilityMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  courierAvailabilityMock: vi.fn(),
}))

// `createOrder` solo llama a `getCourierAvailability` cuando el pedido es de
// delivery — se mockea acá, aparte del admin client, porque vive en su propio
// módulo (`courier.model.ts`) y usa su propia RPC de Postgres.
vi.mock('@/models/courier.model', () => ({
  getCourierAvailability: courierAvailabilityMock,
}))

/**
 * Dispatcher por tabla, en el mismo estilo que
 * `platform-owner-invite.model.test.ts`. `orders` atiende TRES formas de
 * `select` distintas (`estimateEta` cuenta filas con `head:true`; la lectura
 * final trae el pedido completo; `findOrderIdByIdempotencyKey` busca por
 * clave): se distinguen por el primer argumento de `select`, no por orden de
 * llamada — es lo único estable si el cuerpo de `createOrder` se reordena.
 *
 * `store_hours`/`store_hours_overrides`: la guarda nueva de horarios
 * (`getStoreScheduleForOrder`) los consulta SIEMPRE, incluso para un pedido
 * inmediato — sin esto cualquier test de `createOrder` revienta con "tabla
 * admin inesperada", que es justo la caída que este fix soluciona.
 */
function buildAdminMock(opts: {
  storeRow: ReturnType<typeof storeRowFixture>
  activeOrders?: number
  weeklyRows?: Record<string, unknown>[]
  overrideRows?: Record<string, unknown>[]
  orderRow?: Record<string, unknown>
}) {
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
      if (table === 'store_hours') {
        return { select: () => ({ eq: async () => ({ data: opts.weeklyRows ?? [], error: null }) }) }
      }
      if (table === 'store_hours_overrides') {
        return { select: () => ({ eq: async () => ({ data: opts.overrideRows ?? [], error: null }) }) }
      }
      if (table === 'orders') {
        return {
          select: (columns: string) => {
            if (columns === 'id') {
              // estimateEta: cuenta pedidos "en la plancha", con el filtro de
              // `fire_at` encadenado DESPUÉS de `.in()` — el mismo `.or()` que
              // usa el código real.
              return {
                eq: () => ({
                  in: () => ({
                    or: async () => ({ count: opts.activeOrders ?? 0, error: null }),
                  }),
                }),
              }
            }
            // Lectura final del pedido recién creado.
            return {
              eq: () => ({
                single: async () => ({ data: opts.orderRow ?? orderRowFixture(), error: null }),
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
  courierAvailabilityMock.mockReset()
  courierAvailabilityMock.mockResolvedValue({ activeCouriers: 0, freeCouriers: 0 })
  vi.useRealTimers()
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

  it('regresión: un pedido inmediato manda scheduled_for/scheduled_night/night_capacity en null a la RPC', async () => {
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: true, scheduled_capacity_per_night: 5 }),
    })

    await createOrder(orderInput({ paymentMethod: 'online' }))

    const [, args] = rpcMock.mock.calls[0] as [string, { p_order: Record<string, unknown> }]
    expect(args.p_order.scheduled_for).toBeNull()
    expect(args.p_order.scheduled_night).toBeNull()
    expect(args.p_order.night_capacity).toBeNull()
  })
})

/**
 * La guarda nueva de horarios (§7.3 de `00-architecture.md`, punto 2): un
 * pedido "para ahora" contra una tienda con horario cargado y cerrada en este
 * instante ahora rechaza — ANTES esto ni se evaluaba, porque el horario no
 * existía como concepto. `dayOfWeekOf` calcula el día de la semana en UTC a
 * partir del día LOCAL, así que hay que fijar el reloj del proceso para poder
 * predecir qué día de la semana ve `isOpenAt`.
 *
 * 2026-01-08T12:00:00.000Z es jueves (día 4) tanto en UTC como en
 * America/Argentina/Cordoba (09:00 local, mismo día calendario: Cordoba no
 * tiene horario de verano, así que el offset es -3 fijo).
 */
describe('createOrder — pedido "para ahora" con horario cargado', () => {
  const NOW_ISO = '2026-01-08T12:00:00.000Z'
  const THURSDAY = 4

  it('la tienda tiene horario cargado y está CERRADA ahora → DomainError invitando a programar', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: true }),
      // Abre jueves 18:00–22:00 (1080 = 18*60, 240 = 4h). A las 09:00 local
      // (la hora fijada) está cerrada: ni el rango de hoy la cubre, ni el de
      // ayer (miércoles, sin filas) cruza la medianoche hasta acá.
      weeklyRows: [weeklyRowFixture({ day_of_week: THURSDAY, opens_at_minute: 1080, duration_minutes: 240 })],
    })

    await expect(createOrder(orderInput({ paymentMethod: 'online' }))).rejects.toThrow(
      'La cocina está cerrada. Podés programar un pedido para cuando abra.',
    )
    // Nunca llegó a construir el precio ni a llamar la RPC: la guarda corta antes.
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('la tienda tiene horario cargado y está ABIERTA ahora → el pedido inmediato sigue funcionando igual que siempre', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: true }),
      // Abierta las 24 h del jueves: cubre las 09:00 locales fijadas arriba.
      weeklyRows: [weeklyRowFixture({ day_of_week: THURSDAY, opens_at_minute: 0, duration_minutes: 1440 })],
    })

    const { order } = await createOrder(orderInput({ paymentMethod: 'online' }))
    expect(order.id).toBe(555)
    expect(rpcMock).toHaveBeenCalledOnce()
  })

  it('sin NINGUNA fila de horario (weekly vacío), la tienda se comporta como siempre abierta — compatibilidad hacia atrás', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })

    await expect(createOrder(orderInput({ paymentMethod: 'online' }))).resolves.toBeDefined()
  })
})

/**
 * `scheduledFor`: las cuatro validaciones de §7.3, en el orden en que
 * `createOrder` las aplica. `weeklyRows: []` dejar la tienda "siempre
 * abierta" en los casos que no prueban `isOpenAt`, para que cada test aísle
 * UNA sola guarda.
 */
describe('createOrder — pedido programado: validaciones del servidor', () => {
  const NOW_ISO = '2026-01-08T12:00:00.000Z' // :00 exacto, alineado a los 15 min — clave para separar granularidad de lead.

  function isoPlusMinutes(minutes: number, extraMs = 0): string {
    return new Date(new Date(NOW_ISO).getTime() + minutes * 60_000 + extraMs).toISOString()
  }

  it('granularidad: segundos distintos de cero rechaza aunque el minuto sea válido', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })

    await expect(
      createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(90, 30_000) })),
    ).rejects.toThrow('Elegí un horario de la lista de turnos disponibles')
  })

  it('granularidad: un minuto que no es múltiplo de 15 rechaza', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })

    await expect(
      createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(61) })),
    ).rejects.toThrow('Elegí un horario de la lista de turnos disponibles')
  })

  it('lead: JUSTO POR DEBAJO del piso (45 min — el slot de 15 en 15 más cercano por debajo de 60) rechaza', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })

    await expect(
      createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(45) })),
    ).rejects.toThrow('Programá tu pedido con al menos 60 minutos de anticipación')
  })

  it('lead: EXACTAMENTE 60 minutos (el piso, borde inclusive) pasa la guarda', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })

    await expect(
      createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(60) })),
    ).resolves.toBeDefined()
  })

  it('horizonte: EXACTAMENTE 3 días (el borde, inclusive) pasa la guarda', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })

    await expect(
      createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(3 * 24 * 60) })),
    ).resolves.toBeDefined()
  })

  it('horizonte: JUSTO POR ENCIMA de 3 días (un slot más, +15 min) rechaza', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })

    await expect(
      createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(3 * 24 * 60 + 15) })),
    ).rejects.toThrow('Solo podés programar pedidos hasta 3 días por adelantado')
  })

  it('el instante elegido cae FUERA de un rango abierto (misma lib que pintó el selector) → rechaza nombrando que hay que elegir otro turno', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO)) // jueves 09:00 local (Cordoba, -3)
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: true }),
      // Abre jueves 18:00–22:00: un turno a las 10:15 local (75 min después)
      // cae fuera, aunque el lead y el horizonte sean válidos.
      weeklyRows: [weeklyRowFixture({ day_of_week: 4, opens_at_minute: 1080, duration_minutes: 240 })],
    })

    await expect(
      createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(75) })),
    ).rejects.toThrow('Ese horario ya no está disponible. Elegí otro turno.')
  })

  it('el marcador scheduled_night_full de la RPC se traduce a un DomainError de interfaz, nunca crudo', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
    currentAdminMock = buildAdminMock({
      storeRow: storeRowFixture({ online_payment_enabled: true, scheduled_capacity_per_night: 1 }),
      weeklyRows: [],
    })
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'scheduled_night_full: la noche esta completa (1 de 1)' } })

    const promise = createOrder(orderInput({ paymentMethod: 'online', scheduledFor: isoPlusMinutes(90) }))
    await expect(promise).rejects.toBeInstanceOf(DomainError)
    await expect(promise).rejects.toThrow('Esa noche ya está completa. Elegí otro día.')
  })

  describe('campos congelados de un pedido programado (nunca los de uno inmediato)', () => {
    it('demand_multiplier null, eta_minutes null, eta_at = scheduledFor tal cual, scheduled_night derivado', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(NOW_ISO))
      currentAdminMock = buildAdminMock({ storeRow: storeRowFixture({ online_payment_enabled: true }), weeklyRows: [] })
      const scheduledFor = isoPlusMinutes(90)

      await createOrder(orderInput({ paymentMethod: 'online', scheduledFor }))

      const [, args] = rpcMock.mock.calls[0] as [string, { p_order: Record<string, unknown> }]
      expect(args.p_order.demand_multiplier).toBeNull()
      expect(args.p_order.eta_minutes).toBeNull()
      expect(args.p_order.eta_at).toBe(scheduledFor)
      expect(args.p_order.scheduled_for).toBe(scheduledFor)
      // Siempre-abierta (weeklyRows: []) ⇒ commercialNightOf cae al día calendario local.
      expect(args.p_order.scheduled_night).toBe('2026-01-08')
    })
  })

  describe('delivery programado (Q2): política del dueño Y realidad del repartidor', () => {
    function scheduledDeliveryInput(scheduledFor: string) {
      return orderInput({
        paymentMethod: 'online',
        deliveryMethod: 'delivery',
        deliveryAddressLine: 'Calle Falsa 123',
        scheduledFor,
      })
    }

    it('scheduledDeliveryEnabled en false → rechaza aunque el local SÍ haga delivery inmediato', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(NOW_ISO))
      currentAdminMock = buildAdminMock({
        storeRow: storeRowFixture({ online_payment_enabled: true, delivery_enabled: true, scheduled_delivery_enabled: false }),
        weeklyRows: [],
      })

      await expect(createOrder(scheduledDeliveryInput(isoPlusMinutes(90)))).rejects.toThrow(
        'Este local no permite programar pedidos con envío',
      )
      // Ni siquiera llegó a consultar si hay repartidores: la política corta antes que la realidad.
      expect(courierAvailabilityMock).not.toHaveBeenCalled()
    })

    it('scheduledDeliveryEnabled en true pero CERO repartidores activos → rechaza', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(NOW_ISO))
      currentAdminMock = buildAdminMock({
        storeRow: storeRowFixture({ online_payment_enabled: true, delivery_enabled: true, scheduled_delivery_enabled: true }),
        weeklyRows: [],
      })
      courierAvailabilityMock.mockResolvedValue({ activeCouriers: 0, freeCouriers: 0 })

      await expect(createOrder(scheduledDeliveryInput(isoPlusMinutes(90)))).rejects.toThrow(
        'No hay repartidores disponibles para programar un envío',
      )
    })

    it('con política Y al menos 1 repartidor activo, el envío programado usa los minutos PLANOS de la tienda, nunca el cálculo por flota ocupada', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(NOW_ISO))
      currentAdminMock = buildAdminMock({
        storeRow: storeRowFixture({
          online_payment_enabled: true,
          delivery_enabled: true,
          scheduled_delivery_enabled: true,
          delivery_minutes: 15,
          delivery_busy_minutes: 45,
        }),
        weeklyRows: [],
      })
      // Toda la flota ocupada (freeCouriers: 0): si el código usara
      // `deliveryMinutesFor` con la ocupación de AHORA, esto daría 45
      // (busyMinutes). El plano ignora ese dato a propósito.
      courierAvailabilityMock.mockResolvedValue({ activeCouriers: 1, freeCouriers: 0 })

      await createOrder(scheduledDeliveryInput(isoPlusMinutes(90)))

      const [, args] = rpcMock.mock.calls[0] as [string, { p_order: Record<string, unknown> }]
      expect(args.p_order.delivery_minutes).toBe(15)
    })
  })
})
