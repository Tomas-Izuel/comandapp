import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://comandapp.ar'
process.env.NEXT_PUBLIC_STORE_HOST_MODE = 'subdomain'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `src/app/pedido/[token]/page.tsx` — T7 de subdominio-por-local: coherencia
 * host↔pedido. Esta ruta NO se reescribe por host (a propósito, para que el
 * seguimiento quede en el mismo origen que el carrito), así que sin este
 * chequeo `otra-tienda.comandapp.ar/pedido/<token-de-la-birra>` serviría el
 * pedido de otro local bajo un host ajeno.
 *
 * Se mockean los bordes de datos (`getOrderStatus`, `getStoreBySlug`) y
 * `next/headers`; `@/lib/urls` (`parseStoreHost`/`storeUrl`) corre de
 * verdad — es la autoridad real que decide si hay que corregir el host.
 */
const { getOrderStatusMock, getStoreBySlugMock } = vi.hoisted(() => ({
  getOrderStatusMock: vi.fn(),
  getStoreBySlugMock: vi.fn(),
}))

vi.mock('@/controllers/checkout.controller', () => ({ getOrderStatus: getOrderStatusMock }))
vi.mock('@/models/store.model', () => ({ getStoreBySlug: getStoreBySlugMock }))

let hostHeader: string | null = 'la-birra.comandapp.ar'
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'host' ? hostHeader : null) }),
}))

const { default: OrderTrackingPage } = await import('@/app/pedido/[token]/page')
const { getURLFromRedirectError } = await import('next/dist/client/components/redirect')

const TOKEN = 'a'.repeat(24)
const ORDER = {
  storeSlug: 'la-birra',
  publicToken: TOKEN,
  // Campos mínimos: `getOrderStatus` real trae más, pero la page solo lee
  // `storeSlug` (para el chequeo de host y el tema) — el resto lo consume
  // `OrderTracking`, que acá no se ejercita.
}

beforeEach(() => {
  getOrderStatusMock.mockReset()
  getStoreBySlugMock.mockReset()
  getOrderStatusMock.mockResolvedValue(ORDER)
  getStoreBySlugMock.mockResolvedValue(null)
})

/** Corre la page y, si redirige, devuelve la URL; si no, `null`. Cualquier
 * otra excepción se re-lanza (no es el mecanismo de redirect que buscamos). */
async function runPage(token: string): Promise<string | null> {
  try {
    await OrderTrackingPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    })
    return null
  } catch (err) {
    const url = getURLFromRedirectError(err as Parameters<typeof getURLFromRedirectError>[0])
    if (url === null) throw err
    return url
  }
}

describe('/pedido/[token] — coherencia host↔pedido (T7)', () => {
  it('1. host de la MISMA tienda (la-birra.comandapp.ar) → sin redirect', async () => {
    hostHeader = 'la-birra.comandapp.ar'
    const url = await runPage(TOKEN)
    expect(url).toBeNull()
  })

  it('2. host de OTRA tienda (otra.comandapp.ar) → redirect permanente al subdominio de la tienda DUEÑA del pedido', async () => {
    hostHeader = 'otra.comandapp.ar'
    const url = await runPage(TOKEN)
    expect(url).toBe(`https://la-birra.comandapp.ar/pedido/${TOKEN}`)
  })

  it('3. host apex (comandapp.ar) → sin redirect', async () => {
    hostHeader = 'comandapp.ar'
    const url = await runPage(TOKEN)
    expect(url).toBeNull()
  })

  it('4. host localhost:3000 → sin redirect (comportamiento igual al de hoy)', async () => {
    hostHeader = 'localhost:3000'
    const url = await runPage(TOKEN)
    expect(url).toBeNull()
  })

  it('5. token inexistente: se muestra el EmptyState (sin redirect, ni siquiera con un host de otra tienda) — el host nunca puede ser un oráculo de si el token existe', async () => {
    getOrderStatusMock.mockResolvedValue(null)
    hostHeader = 'otra.comandapp.ar' // un host que, si el pedido existiera, SÍ dispararía redirect

    const url = await runPage('token-inexistente'.padEnd(24, 'z'))

    expect(url).toBeNull() // ninguna redirección: se llegó al EmptyState sin evaluar el host
  })
})
