import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `src/app/backoffice/auth/callback/route.ts` es el callback OAuth de
 * "Continuar con Google". Se mockea SOLO el borde de I/O
 * (`exchangeCodeForSession`, vía `@/lib/supabase/server`) — la lógica de
 * discriminar `sin_acceso` vs. `google_fallo` corre de verdad, que es
 * justamente lo que hay que cubrir bien acá (ver comentario del propio
 * archivo: "es sutil y se rompe fácil en un refactor").
 */
const { exchangeCodeForSessionMock } = vi.hoisted(() => ({
  exchangeCodeForSessionMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionMock },
  }),
}))

const { GET } = await import('@/app/backoffice/auth/callback/route')

function buildRequest(query: string): NextRequest {
  return new NextRequest(`https://backoffice.test/backoffice/auth/callback${query}`)
}

function locationOf(res: Response): string {
  return res.headers.get('location') ?? ''
}

beforeEach(() => {
  exchangeCodeForSessionMock.mockReset()
})

describe('GET /backoffice/auth/callback', () => {
  it('sin `code` en la query redirige a login con error, no explota', async () => {
    const res = await GET(buildRequest(''))

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(locationOf(res)).toBe('https://backoffice.test/backoffice/login?error=google_fallo')
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled()
  })

  it('Google devuelve `error` propio (el usuario canceló el consentimiento) → google_fallo sin intentar canjear nada', async () => {
    const res = await GET(buildRequest('?error=access_denied'))

    expect(locationOf(res)).toBe('https://backoffice.test/backoffice/login?error=google_fallo')
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled()
  })

  it('éxito: exchangeCodeForSession sin error redirige a /backoffice', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null })

    const res = await GET(buildRequest('?code=un-code-de-pkce'))

    expect(locationOf(res)).toBe('https://backoffice.test/backoffice')
  })

  /**
   * El caso central del archivo: el hook `before_user_created` rechaza a un
   * usuario de Google fuera de la allowlist con un error 4xx SIN `error_code`
   * propio (GoTrue no le pone nombre a los errores que vienen de un hook). Es
   * la única señal disponible para distinguir "no tenés acceso" de una falla
   * técnica del intercambio PKCE — si un refactor empezara a mirar el mensaje
   * en vez de `code`+`status`, este test lo agarra.
   */
  it('P4xx sin `code` nombrado (rechazo del hook de allowlist) mapea a sin_acceso', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      error: { message: 'Signup not allowed for this instance', status: 403 },
    })

    const res = await GET(buildRequest('?code=un-code-de-pkce'))

    expect(locationOf(res)).toBe('https://backoffice.test/backoffice/login?error=sin_acceso')
  })

  it('un error CON `code` nombrado (bad_code_verifier) es google_fallo, no sin_acceso', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      error: { code: 'bad_code_verifier', message: 'invalid code verifier', status: 400 },
    })

    const res = await GET(buildRequest('?code=un-code-de-pkce'))

    expect(locationOf(res)).toBe('https://backoffice.test/backoffice/login?error=google_fallo')
  })

  it('un 5xx (falla técnica de Supabase, no un rechazo del hook) es google_fallo, no sin_acceso', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      error: { message: 'internal error', status: 500 },
    })

    const res = await GET(buildRequest('?code=un-code-de-pkce'))

    expect(locationOf(res)).toBe('https://backoffice.test/backoffice/login?error=google_fallo')
  })

  it('un error sin `status` numérico (nunca debería pasar, pero no es 4xx confirmado) cae a google_fallo', async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      error: { message: 'algo raro' },
    })

    const res = await GET(buildRequest('?code=un-code-de-pkce'))

    expect(locationOf(res)).toBe('https://backoffice.test/backoffice/login?error=google_fallo')
  })
})

/**
 * Open redirect (S-13, mismo chequeo que `/admin/acceso/confirm`): este
 * handler NO lee ningún parámetro `next` de la query — siempre redirige a
 * `/backoffice` en éxito y a rutas fijas de `/backoffice/login` en error. No
 * hay superficie de open redirect que testear acá; si algún día se agrega un
 * `next`, tiene que llevar el mismo chequeo `isSafeRedirectPath` que
 * `admin/acceso/confirm/route.ts`.
 */
