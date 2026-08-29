import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * La invariante de cookies del plan de subdominio (`00-architecture.md` §3.5,
 * T8 de `01-tasks.md`): NUNCA pasar `cookieOptions.domain` a
 * `createServerClient`/`createBrowserClient`. Hoy estamos a salvo porque
 * ninguna de las tres fábricas de cliente lo hace —así que las cookies de
 * sesión quedan host-only—, pero es una línea de código de distancia del
 * desastre: si `proxy.ts` alguna vez scopeara la cookie al dominio padre
 * (`.comandapp.ar`), cualquier tienda podría leer la sesión de cualquier
 * otra.
 *
 * No alcanza un grep: se corre `proxy()` de verdad (con un `NextRequest`
 * real, no un doble) y se dispara el callback `setAll` que usa
 * `@supabase/ssr` para refrescar cookies — para que la aserción sea sobre el
 * `Set-Cookie` REAL que sale de la respuesta, no sobre una lectura del código
 * fuente que un refactor podría esquivar.
 */
const { createServerClientMock } = vi.hoisted(() => ({ createServerClientMock: vi.fn() }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}))

beforeEach(() => {
  createServerClientMock.mockReset()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
})

describe('proxy() — ningún Set-Cookie de la respuesta trae Domain= (T8, invariante de cookies)', () => {
  it('el tercer argumento de createServerClient NUNCA lleva cookieOptions.domain', async () => {
    createServerClientMock.mockImplementation((_url: string, _key: string, opts: unknown) => {
      // Simula lo que hace @supabase/ssr al refrescar: escribe un cookie
      // nuevo a través del callback que le dio proxy.ts.
      const cookieOpts = opts as { cookies: { setAll: (list: Array<{ name: string; value: string; options?: object }>) => void } }
      cookieOpts.cookies.setAll([{ name: 'sb-access-token', value: 'nuevo-token', options: { path: '/', httpOnly: true } }])
      return { auth: { getClaims: async () => ({ data: { claims: null }, error: null }) } }
    })

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('https://la-birra.comandapp.ar/', {
      headers: { cookie: 'sb-access-token=viejo' },
    })

    const response = await proxy(request)

    // 1. El literal de opciones que `proxy.ts` le pasa a `createServerClient`
    //    no tiene NINGUNA clave `cookieOptions`.
    const passedOptions = createServerClientMock.mock.calls[0]?.[2] as Record<string, unknown>
    expect(passedOptions).not.toHaveProperty('cookieOptions')

    // 2. El Set-Cookie REAL de la respuesta —el que de verdad viaja al
    //    browser— no trae el atributo Domain en ninguna de sus cookies.
    const setCookieHeaders = response.headers.getSetCookie()
    expect(setCookieHeaders.length).toBeGreaterThan(0) // que el test no esté vacío por un mock mal armado
    for (const header of setCookieHeaders) {
      expect(header.toLowerCase()).not.toContain('domain=')
    }
  })
})

describe('src/lib/supabase/server.ts (createClient) — mismo candado', () => {
  it('el tercer argumento de createServerClient tampoco lleva cookieOptions.domain acá', async () => {
    vi.resetModules()
    createServerClientMock.mockReset()
    createServerClientMock.mockImplementation(() => ({ auth: { getUser: async () => ({ data: { user: null } }) } }))

    vi.doMock('next/headers', () => ({
      cookies: async () => ({ getAll: () => [], set: vi.fn() }),
    }))

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
    process.env.SUPABASE_SECRET_KEY = 'secret-key'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
    process.env.CRON_SECRET = 'cron-secret'

    const { createClient } = await import('@/lib/supabase/server')
    await createClient()

    const passedOptions = createServerClientMock.mock.calls[0]?.[2] as Record<string, unknown>
    expect(passedOptions).not.toHaveProperty('cookieOptions')

    vi.doUnmock('next/headers')
  })
})
