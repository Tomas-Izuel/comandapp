import { describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

const STORE_ID = 7
const CUSTOMER_ID = 42
const VALID_TOKEN = '23456789abcdefghjkmnpqrs' // 24 chars, alfabeto real

function validDirectoryPayload() {
  return {
    customers: [],
    totals: { customers: 0, withEmail: 0, inactive30: 0 },
  }
}

// --- mocks de los dos clientes de Supabase -----------------------------
// `getCustomerDirectory` usa el cliente de SESIÓN (la trampa de
// store_customer_directory: con service_role no hay auth.uid()); las demás
// funciones usan el admin client. Los dos se mockean por separado para que
// cada test pueda armar exactamente la forma de respuesta que necesita.

let sessionRpcMock: ReturnType<typeof vi.fn>
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: sessionRpcMock }),
}))

let adminFromMock: ReturnType<typeof vi.fn>
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))

const { getCustomerDirectory, updateCustomerNotes, setCustomerOptOut, findCustomerByUnsubscribeToken, optOutByToken } = await import(
  '@/models/customer.model'
)
const { DomainError } = await import('@/lib/errors')

describe('getCustomerDirectory — cliente de SESIÓN, nunca admin (misma trampa que store_couriers)', () => {
  it('42501 de la RPC (is_store_owner falló adentro) se traduce a DomainError 403, no al código crudo de Postgres', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'solo el dueno del local ve el padron de clientes' } }))

    await expect(getCustomerDirectory(STORE_ID)).rejects.toBeInstanceOf(DomainError)
    await expect(getCustomerDirectory(STORE_ID)).rejects.toMatchObject({ status: 403 })
  })

  it('un error de Postgres que NO es 42501 (ej. timeout) propaga un error genérico, no un 403 de dominio', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }))

    await expect(getCustomerDirectory(STORE_ID)).rejects.toThrow(/No se pudo leer el padrón/)
  })

  it('un jsonb con forma inesperada (redefinición futura de la RPC) no llega crudo a la vista: se rechaza acá', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: { customers: 'no-es-un-array' }, error: null }))

    await expect(getCustomerDirectory(STORE_ID)).rejects.toThrow(/formato inesperado/)
  })

  it('camino feliz: llama la RPC con p_store_id y devuelve el payload validado', async () => {
    const payload = validDirectoryPayload()
    sessionRpcMock = vi.fn(async () => ({ data: payload, error: null }))

    const result = await getCustomerDirectory(STORE_ID)

    expect(sessionRpcMock).toHaveBeenCalledWith('store_customer_directory', { p_store_id: STORE_ID })
    expect(result).toEqual(payload)
  })
})

function buildUpdateChain(opts: { data: Array<{ id: number }> | null; error: { message: string } | null }) {
  const eqCalls: unknown[][] = []
  const updateCalls: unknown[][] = []
  const chain = {
    eq: vi.fn((...args: unknown[]) => {
      eqCalls.push(args)
      return chain
    }),
    select: vi.fn(async () => ({ data: opts.data, error: opts.error })),
  }
  const update = vi.fn((...args: unknown[]) => {
    updateCalls.push(args)
    return chain
  })
  return { update, eqCalls, updateCalls }
}

describe('updateCustomerNotes — cliente ADMIN + store_id explícito (la tabla no tiene grants para authenticated)', () => {
  it('notes vacío (string vacío) se guarda como null, no como string vacío', async () => {
    const { update, eqCalls } = buildUpdateChain({ data: [{ id: CUSTOMER_ID }], error: null })
    adminFromMock = vi.fn((table: string) => {
      if (table !== 'store_customers') throw new Error(`tabla inesperada: ${table}`)
      return { update }
    })

    await updateCustomerNotes(STORE_ID, CUSTOMER_ID, '')

    expect(update).toHaveBeenCalledWith({ notes: null })
    // El aislamiento por tienda no se apoya en que el customerId que mandó el
    // browser sea correcto: store_id va explícito en el .eq(), no solo el id.
    expect(eqCalls.flat()).toEqual(expect.arrayContaining(['id', CUSTOMER_ID, 'store_id', STORE_ID]))
  })

  it('un customerId que existe pero es de OTRA tienda (0 filas por el .eq(store_id) explícito) → DomainError 404, no éxito silencioso', async () => {
    const { update } = buildUpdateChain({ data: [], error: null })
    adminFromMock = vi.fn(() => ({ update }))

    await expect(updateCustomerNotes(STORE_ID, CUSTOMER_ID, 'una nota')).rejects.toBeInstanceOf(DomainError)
    await expect(updateCustomerNotes(STORE_ID, CUSTOMER_ID, 'una nota')).rejects.toMatchObject({ status: 404 })
  })

  it('un error de Postgres real (no "no encontrado") propaga un error, no un 404 que esconde el fallo', async () => {
    const { update } = buildUpdateChain({ data: null, error: { message: 'connection reset' } })
    adminFromMock = vi.fn(() => ({ update }))

    await expect(updateCustomerNotes(STORE_ID, CUSTOMER_ID, 'x')).rejects.toThrow(/No se pudo guardar la nota/)
  })
})

describe('setCustomerOptOut — baja/alta manual del dueño', () => {
  it('optedOut: true guarda una fecha ISO en marketing_opt_out_at', async () => {
    const { update } = buildUpdateChain({ data: [{ id: CUSTOMER_ID }], error: null })
    adminFromMock = vi.fn(() => ({ update }))

    await setCustomerOptOut(STORE_ID, CUSTOMER_ID, true)

    const payload = update.mock.calls[0][0] as { marketing_opt_out_at: string | null }
    expect(payload.marketing_opt_out_at).not.toBeNull()
    expect(() => new Date(payload.marketing_opt_out_at as string).toISOString()).not.toThrow()
  })

  it('optedOut: false vuelve a poner marketing_opt_out_at en null (reactivar promos)', async () => {
    const { update } = buildUpdateChain({ data: [{ id: CUSTOMER_ID }], error: null })
    adminFromMock = vi.fn(() => ({ update }))

    await setCustomerOptOut(STORE_ID, CUSTOMER_ID, false)

    expect(update).toHaveBeenCalledWith({ marketing_opt_out_at: null })
  })

  it('un customerId de otra tienda → DomainError 404', async () => {
    const { update } = buildUpdateChain({ data: [], error: null })
    adminFromMock = vi.fn(() => ({ update }))

    await expect(setCustomerOptOut(STORE_ID, CUSTOMER_ID, true)).rejects.toMatchObject({ status: 404 })
  })
})

describe('findCustomerByUnsubscribeToken — la lectura de /baja/[token]', () => {
  it('un token con formato inválido NUNCA toca la base — se rechaza antes con Zod', async () => {
    adminFromMock = vi.fn(() => {
      throw new Error('no debería llamarse a createAdminClient().from(...) con un token inválido')
    })

    const result = await findCustomerByUnsubscribeToken('formato-invalido')

    expect(result).toBeNull()
    expect(adminFromMock).not.toHaveBeenCalled()
  })

  it('un token con formato válido pero que no matchea ninguna fila devuelve null (no tira, no distingue "no existe")', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    adminFromMock = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }))

    const result = await findCustomerByUnsubscribeToken(VALID_TOKEN)

    expect(result).toBeNull()
  })

  it('token válido y encontrado: devuelve el nombre del LOCAL (storeName), nunca el del cliente ni su plata', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { marketing_opt_out_at: null, stores: { name: 'La Birra Burgers' } },
      error: null,
    }))
    adminFromMock = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }))

    const result = await findCustomerByUnsubscribeToken(VALID_TOKEN)

    expect(result).toEqual({ storeName: 'La Birra Burgers', alreadyOptedOut: false })
  })

  it('un cliente ya dado de baja reporta alreadyOptedOut: true', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { marketing_opt_out_at: '2026-01-01T00:00:00.000Z', stores: { name: 'La Birra Burgers' } },
      error: null,
    }))
    adminFromMock = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }))

    const result = await findCustomerByUnsubscribeToken(VALID_TOKEN)

    expect(result?.alreadyOptedOut).toBe(true)
  })
})

describe('optOutByToken — idempotente por construcción, no por un if en TypeScript', () => {
  it('un token con formato inválido NUNCA toca la base', async () => {
    adminFromMock = vi.fn(() => {
      throw new Error('no debería llamarse a createAdminClient().from(...) con un token inválido')
    })

    await optOutByToken('formato-invalido')

    expect(adminFromMock).not.toHaveBeenCalled()
  })

  it('el UPDATE va guardado con .is(marketing_opt_out_at, null) — sin ese guard, una segunda confirmación pisaría la fecha original', async () => {
    const isMock = vi.fn(async () => ({ error: null }))
    const eqMock = vi.fn(() => ({ is: isMock }))
    const updateMock = vi.fn(() => ({ eq: eqMock }))
    adminFromMock = vi.fn(() => ({ update: updateMock }))

    await optOutByToken(VALID_TOKEN)

    expect(eqMock).toHaveBeenCalledWith('unsubscribe_token', VALID_TOKEN)
    expect(isMock).toHaveBeenCalledWith('marketing_opt_out_at', null)
  })
})
