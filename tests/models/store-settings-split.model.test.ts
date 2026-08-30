import { describe, expect, it, vi } from 'vitest'
import type { StoreOrderingInput, StoreProfileInput } from '@/models/schemas/store.schema'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * La invariante que motivó el corte (00-architecture.md, pipeline
 * 2026-08-30-ajustes-por-secciones): `updateStoreSettings` escribía las 29
 * columnas de `stores` de una, así que la página de perfil borraba la
 * config de envío del que sí la había cargado. Se partió en
 * `updateStoreProfile` (12 columnas) y `updateStoreOrdering` (14), cada una
 * con su propio `.pick()`. Sin un test que lea el payload REAL que llega a
 * `.update()`, la próxima persona que junte los dos `.update()` en una sola
 * función (o copie una columna del otro schema "por las dudas") reintroduce
 * el bug sin que nada lo note: TypeScript no puede atrapar esto porque el
 * `.update()` interno arma el objeto a mano, no reenvía `parsed` entero.
 *
 * `acceptingOrders` salió de `storeOrderingInputSchema` en la ronda de
 * arreglos posterior al review (03-review.md, hallazgo bloqueante #1):
 * pisaba en silencio una pausa/reapertura hecha desde OTRO dispositivo,
 * porque un submit del resto del formulario (la tarifa de envío, por
 * ejemplo) mandaba el valor viejo que el `useForm` tenía en memoria. Ahora
 * tiene su propio camino inmediato: `resumeAcceptingOrders` (este archivo) y
 * `pauseScheduledNightAction` (no es de este slice). Que `updateStoreOrdering`
 * nunca vuelva a tocar esa columna es, a partir de este arreglo, tan
 * importante como que nunca toque `courier_collects_payment` — es EXACTAMENTE
 * la regresión que el arreglo previene, así que tiene su propio assert
 * dedicado más abajo, no solo el genérico de "columnas prohibidas".
 *
 * Se mockea el único borde real (`@/lib/supabase/server`, dispatcher por
 * tabla igual que `tests/models/order.model.test.ts` y
 * `tests/models/platform-owner-invite.model.test.ts`): `requireStoreMembership`
 * corre de VERDAD contra ese mock, no se reemplaza — es la misma función que
 * las tres funciones llaman primero, y este archivo también prueba que no
 * hace falta ser owner.
 */

const STORE_ID = 7
const USER_ID = 'staff-uid'

type UpdateCall = { table: string; payload: Record<string, unknown> }

/**
 * Dispatcher por tabla. `store_members` resuelve `requireStoreMembership`
 * (rol configurable); `stores` es el `.update()` bajo prueba, que graba cada
 * payload tal cual llega para poder inspeccionar sus claves después.
 */
function buildSupabaseMock(opts: { role?: 'staff' | 'owner' | 'courier' | null; updateError?: string } = {}) {
  const { role = 'staff', updateError } = opts
  const updateCalls: UpdateCall[] = []
  let lastEqArgs: unknown[] | null = null

  const client = {
    from(table: string) {
      if (table === 'store_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: role ? { role } : null, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'stores') {
        return {
          update: (payload: Record<string, unknown>) => {
            updateCalls.push({ table, payload })
            return {
              eq: async (...args: unknown[]) => {
                lastEqArgs = args
                return { error: updateError ? { message: updateError } : null }
              },
            }
          },
        }
      }
      throw new Error(`tabla inesperada en el mock: ${table}`)
    },
  }

  return {
    client,
    updateCalls,
    get lastEqArgs() {
      return lastEqArgs
    },
  }
}

let currentMock: ReturnType<typeof buildSupabaseMock>

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => currentMock.client,
  getCurrentUser: async () => ({ id: USER_ID }),
}))

const { updateStoreProfile, updateStoreOrdering, resumeAcceptingOrders } = await import('@/models/store.model')

/** Las 12 columnas snake_case que `updateStoreProfile` tiene permitido tocar. */
const PROFILE_COLUMNS = [
  'name',
  'description',
  'phone_e164',
  'whatsapp_phone_e164',
  'address',
  'latitude',
  'longitude',
  'instagram_handle',
  'maps_url',
  'rappi_url',
  'pedidos_ya_url',
  'uber_eats_url',
] as const

/** Las 14 columnas snake_case que `updateStoreOrdering` tiene permitido tocar. */
const ORDERING_COLUMNS = [
  'in_store_payment_enabled',
  'min_order_cents',
  'auto_start_orders',
  'auto_ready_orders',
  'delivery_enabled',
  'delivery_fee_cents',
  'delivery_free_from_cents',
  'delivery_min_order_cents',
  'delivery_minutes',
  'delivery_busy_minutes',
  'scheduled_delivery_enabled',
  'scheduled_capacity_per_night',
  'demand_threshold_orders',
  'demand_multiplier',
] as const

/**
 * Columnas que NINGUNA de las dos acciones (perfil, pedidos/envío) puede
 * escribir, nunca. `accepting_orders` está acá aunque SÍ tenga grant de
 * `authenticated` (a diferencia de sus vecinas de esta lista): la razón de
 * exclusión no es de permisos sino de concurrencia — tiene su propio camino
 * inmediato (`resumeAcceptingOrders`/`pauseScheduledNightAction`) precisamente
 * para que un `useForm` con un valor viejo no pise una pausa/reapertura hecha
 * desde otra pantalla. Ver el comentario del bloque de arriba.
 */
const FORBIDDEN_FOR_BOTH = [
  'id',
  'slug',
  'status',
  'created_at',
  'updated_at',
  'timezone',
  'currency',
  'courier_collects_payment',
  'online_payment_enabled',
  'accepting_orders',
] as const

/**
 * `updateStoreProfile`/`updateStoreOrdering` tipan su parámetro con el tipo
 * de SALIDA de Zod (`z.infer`, post-default), no el de entrada — igual que
 * arma el objeto `zodResolver` del lado del form, que siempre manda las
 * claves completas. Por eso las fixtures de este archivo son objetos
 * completos (aunque casi todos los campos tengan default en el schema): es
 * el mismo shape que un caller real produce, no un atajo del test.
 */
function validProfileInput(overrides: Partial<StoreProfileInput> = {}): StoreProfileInput {
  return {
    name: 'La Birra',
    description: null,
    phoneE164: null,
    whatsappPhoneE164: null,
    address: null,
    latitude: null,
    longitude: null,
    instagramHandle: null,
    mapsUrl: null,
    rappiUrl: null,
    pedidosYaUrl: null,
    uberEatsUrl: null,
    ...overrides,
  }
}

function validOrderingInput(overrides: Partial<StoreOrderingInput> = {}): StoreOrderingInput {
  return {
    inStorePaymentEnabled: false,
    minOrderCents: 0,
    autoStartOrders: false,
    autoReadyOrders: false,
    deliveryEnabled: false,
    deliveryFeeCents: 0,
    deliveryFreeFromCents: 0,
    deliveryMinOrderCents: 0,
    deliveryMinutes: 30,
    deliveryBusyMinutes: 50,
    scheduledDeliveryEnabled: false,
    scheduledCapacityPerNight: null,
    demandThresholdOrders: 5,
    demandMultiplier: 1.5,
    ...overrides,
  }
}

describe('updateStoreProfile — solo sus 12 columnas, nunca las de pedidos/envío', () => {
  it('el payload de .update() tiene EXACTAMENTE las 12 columnas de perfil, ni una más ni una menos', async () => {
    currentMock = buildSupabaseMock()
    await updateStoreProfile(STORE_ID, validProfileInput())

    expect(currentMock.updateCalls).toHaveLength(1)
    const keys = Object.keys(currentMock.updateCalls[0].payload).sort()
    expect(keys).toEqual([...PROFILE_COLUMNS].sort())
  })

  it('el .update() apunta a la fila de la tienda correcta', async () => {
    currentMock = buildSupabaseMock()
    await updateStoreProfile(STORE_ID, validProfileInput())
    expect(currentMock.lastEqArgs).toEqual(['id', STORE_ID])
  })

  it.each(ORDERING_COLUMNS)('NUNCA toca la columna de pedidos/envío "%s" — este es el bug que motivó el corte', async (column) => {
    currentMock = buildSupabaseMock()
    await updateStoreProfile(STORE_ID, validProfileInput())
    expect(currentMock.updateCalls[0].payload).not.toHaveProperty(column)
  })

  it.each(FORBIDDEN_FOR_BOTH)('NUNCA toca "%s" (plataforma, candado de pago, o fuera del set escribible)', async (column) => {
    currentMock = buildSupabaseMock()
    await updateStoreProfile(STORE_ID, validProfileInput())
    expect(currentMock.updateCalls[0].payload).not.toHaveProperty(column)
  })

  it('cualquier staff (no solo el owner) puede guardar el perfil', async () => {
    currentMock = buildSupabaseMock({ role: 'staff' })
    await expect(updateStoreProfile(STORE_ID, validProfileInput())).resolves.toBeUndefined()
  })

  it('un repartidor (role courier) no puede llamar esto — requireStoreMembership corta antes del .update()', async () => {
    currentMock = buildSupabaseMock({ role: 'courier' })
    await expect(updateStoreProfile(STORE_ID, validProfileInput())).rejects.toThrow()
    expect(currentMock.updateCalls).toHaveLength(0)
  })

  describe('normalización "las dos o ninguna" de latitude/longitude', () => {
    it('latitude sola (longitude null) persiste latitude en null también — una coordenada a medias no ubica nada', async () => {
      currentMock = buildSupabaseMock()
      await updateStoreProfile(STORE_ID, { ...validProfileInput(), latitude: -31.4, longitude: null })

      const payload = currentMock.updateCalls[0].payload
      expect(payload.latitude).toBeNull()
      expect(payload.longitude).toBeNull()
    })

    it('longitude sola (latitude null) persiste longitude en null también', async () => {
      currentMock = buildSupabaseMock()
      await updateStoreProfile(STORE_ID, { ...validProfileInput(), latitude: null, longitude: -64.2 })

      const payload = currentMock.updateCalls[0].payload
      expect(payload.latitude).toBeNull()
      expect(payload.longitude).toBeNull()
    })

    it('las dos presentes persisten las dos, sin tocarlas', async () => {
      currentMock = buildSupabaseMock()
      await updateStoreProfile(STORE_ID, { ...validProfileInput(), latitude: -31.4, longitude: -64.2 })

      const payload = currentMock.updateCalls[0].payload
      expect(payload.latitude).toBe(-31.4)
      expect(payload.longitude).toBe(-64.2)
    })
  })
})

describe('updateStoreOrdering — solo sus 14 columnas, nunca las de perfil, ni courier_collects_payment, ni accepting_orders', () => {
  it('el payload de .update() tiene EXACTAMENTE las 14 columnas de pedidos/envío, ni una más ni una menos', async () => {
    currentMock = buildSupabaseMock()
    await updateStoreOrdering(STORE_ID, validOrderingInput())

    expect(currentMock.updateCalls).toHaveLength(1)
    const keys = Object.keys(currentMock.updateCalls[0].payload).sort()
    expect(keys).toEqual([...ORDERING_COLUMNS].sort())
  })

  it('el .update() apunta a la fila de la tienda correcta', async () => {
    currentMock = buildSupabaseMock()
    await updateStoreOrdering(STORE_ID, validOrderingInput())
    expect(currentMock.lastEqArgs).toEqual(['id', STORE_ID])
  })

  it.each(PROFILE_COLUMNS)('NUNCA toca la columna de perfil "%s"', async (column) => {
    currentMock = buildSupabaseMock()
    await updateStoreOrdering(STORE_ID, validOrderingInput())
    expect(currentMock.updateCalls[0].payload).not.toHaveProperty(column)
  })

  it.each(FORBIDDEN_FOR_BOTH)('NUNCA toca "%s" (plataforma, candado de pago, o fuera del set escribible)', async (column) => {
    currentMock = buildSupabaseMock()
    await updateStoreOrdering(STORE_ID, validOrderingInput())
    expect(currentMock.updateCalls[0].payload).not.toHaveProperty(column)
  })

  it('el candado de plata: courier_collects_payment NO aparece ni con un input que intenta colarlo (el schema .strict-picked lo descarta)', async () => {
    currentMock = buildSupabaseMock()
    // Si alguien reabre el schema para aceptar este campo "por comodidad",
    // este test es el que tiene que fallar primero.
    await updateStoreOrdering(STORE_ID, { ...validOrderingInput(), courierCollectsPayment: true } as never)
    expect(currentMock.updateCalls[0].payload).not.toHaveProperty('courier_collects_payment')
  })

  it('LA REGRESIÓN QUE ESTE ARREGLO PREVIENE: accepting_orders NO aparece ni con un input que intenta colarlo, aunque tenga grant de columna para authenticated', async () => {
    currentMock = buildSupabaseMock()
    // A diferencia de courier_collects_payment, esta columna SÍ tiene grant
    // para `authenticated` (20260826120000_hardening.sql) — así que si
    // volviera a este `.update()`, el UPDATE no fallaría por permisos: fallaría
    // en silencio pisando una pausa/reapertura hecha desde otra pantalla. Ese
    // es justo el bug que motivó sacarla de `storeOrderingInputSchema`
    // (03-review.md, hallazgo #1) — este test es el que tiene que fallar
    // primero si alguien la reintroduce "para que el formulario la controle".
    await updateStoreOrdering(STORE_ID, { ...validOrderingInput(), acceptingOrders: true } as never)
    expect(currentMock.updateCalls[0].payload).not.toHaveProperty('accepting_orders')
  })

  it('cualquier staff (no solo el owner) puede guardar pedidos/envío', async () => {
    currentMock = buildSupabaseMock({ role: 'staff' })
    await expect(updateStoreOrdering(STORE_ID, validOrderingInput())).resolves.toBeUndefined()
  })

  it('un repartidor (role courier) no puede llamar esto', async () => {
    currentMock = buildSupabaseMock({ role: 'courier' })
    await expect(updateStoreOrdering(STORE_ID, validOrderingInput())).rejects.toThrow()
    expect(currentMock.updateCalls).toHaveLength(0)
  })
})

/**
 * `resumeAcceptingOrders` — la mitad "prender" del camino inmediato de
 * `accepting_orders` (00-architecture.md / 03-review.md hallazgo #1). Sin
 * diálogo, sin código por mail, sin `createAdminClient()`: la columna tiene
 * grant de `authenticated` (`20260826120000_hardening.sql:424`), así que el
 * cliente de sesión alcanza. Este archivo NO mockea `@/lib/supabase/admin`:
 * si la función alguna vez llamara a `createAdminClient()` en vez del cliente
 * de sesión mockeado, el import real de ese módulo correría sin sus env vars
 * (no seteadas acá a propósito) y el test fallaría con un error bien
 * distinto al esperado — es una segunda señal, no solo el assert de abajo.
 */
describe('resumeAcceptingOrders — reapertura inmediata de "Tomando pedidos"', () => {
  it('el payload de .update() es EXACTAMENTE { accepting_orders: true }, nada más', async () => {
    currentMock = buildSupabaseMock()
    await resumeAcceptingOrders(STORE_ID)

    expect(currentMock.updateCalls).toHaveLength(1)
    expect(currentMock.updateCalls[0].payload).toEqual({ accepting_orders: true })
  })

  it('el .update() apunta a la fila de la tienda correcta', async () => {
    currentMock = buildSupabaseMock()
    await resumeAcceptingOrders(STORE_ID)
    expect(currentMock.lastEqArgs).toEqual(['id', STORE_ID])
  })

  it('cualquier staff (no solo el owner) puede reabrir', async () => {
    currentMock = buildSupabaseMock({ role: 'staff' })
    await expect(resumeAcceptingOrders(STORE_ID)).resolves.toBeUndefined()
  })

  it('un repartidor (role courier) no puede llamar esto — requireStoreMembership corta antes del .update()', async () => {
    currentMock = buildSupabaseMock({ role: 'courier' })
    await expect(resumeAcceptingOrders(STORE_ID)).rejects.toThrow()
    expect(currentMock.updateCalls).toHaveLength(0)
  })

  it('alguien sin sesión (no miembro de la tienda) tampoco puede — requireStoreMembership exige una fila en store_members', async () => {
    currentMock = buildSupabaseMock({ role: null })
    await expect(resumeAcceptingOrders(STORE_ID)).rejects.toThrow()
    expect(currentMock.updateCalls).toHaveLength(0)
  })
})

describe('las dos acciones nunca comparten una fila de .update(): perfil y pedidos/envío son transacciones separadas', () => {
  it('llamar a las dos NO produce un solo update mezclado — cada llamada es su propio round-trip con su propio payload acotado', async () => {
    currentMock = buildSupabaseMock()
    await updateStoreProfile(STORE_ID, validProfileInput())
    await updateStoreOrdering(STORE_ID, validOrderingInput())

    expect(currentMock.updateCalls).toHaveLength(2)
    const [profileKeys, orderingKeys] = currentMock.updateCalls.map((c) => new Set(Object.keys(c.payload)))
    const overlap = [...profileKeys].filter((k) => orderingKeys.has(k))
    expect(overlap).toEqual([])
  })
})
