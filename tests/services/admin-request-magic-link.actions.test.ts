import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `requestMagicLinkAction` (`src/controllers/admin.actions.ts`) es la acción
 * de `/admin/acceso`. La invariante de negocio es que la respuesta es
 * SIEMPRE la misma —email desconocido, email válido, o pedido frenado por el
 * throttle— porque cualquier diferencia convierte el formulario en un
 * oráculo para averiguar qué email tiene panel de qué local. Se mockea solo
 * `signInWithOtp` (el borde de I/O) y `headers()` (de dónde sale la IP para
 * la clave del throttle); el resto corre de verdad.
 */
const { signInWithOtpMock } = vi.hoisted(() => ({
  signInWithOtpMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithOtp: signInWithOtpMock } }),
}))

// `x-forwarded-for` fija por default; los tests de throttle la pisan por test
// para no compartir la clave (email+ip) entre casos.
let forwardedFor = '1.2.3.4'
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-forwarded-for' ? forwardedFor : null) }),
}))

const { requestMagicLinkAction } = await import('@/controllers/admin.actions')

beforeEach(() => {
  signInWithOtpMock.mockReset()
  forwardedFor = `${Date.now()}.${Math.random()}` // IP única por test → throttle no se pisa entre tests
})

describe('requestMagicLinkAction — S-06: la respuesta no puede filtrar quién tiene panel', () => {
  it('email con panel real (signInWithOtp sin error) → { ok: true }', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null })

    const res = await requestMagicLinkAction('dueno@la-birra.test')

    expect(res).toEqual({ ok: true, data: undefined })
  })

  it('email SIN panel (Auth devuelve otp_disabled/422 por shouldCreateUser:false) → { ok: true }, idéntico al caso anterior', async () => {
    signInWithOtpMock.mockResolvedValue({ error: { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' } })

    const res = await requestMagicLinkAction('nadie@existe.test')

    expect(res).toEqual({ ok: true, data: undefined })
  })

  it('un error inesperado de Auth (no otp_disabled/422) también devuelve { ok: true } — nunca se filtra el detalle', async () => {
    signInWithOtpMock.mockResolvedValue({ error: { code: 'unexpected_failure', status: 500, message: 'algo se rompió' } })

    const res = await requestMagicLinkAction('dueno@la-birra.test')

    expect(res).toEqual({ ok: true, data: undefined })
  })

  it('email mal formado SÍ devuelve error — es un chequeo de FORMA, no de existencia', async () => {
    const res = await requestMagicLinkAction('esto-no-es-un-email')

    expect(res.ok).toBe(false)
    expect(signInWithOtpMock).not.toHaveBeenCalled()
  })

  it('el throttle corta a partir del 6to intento en la ventana, pero la respuesta sigue siendo { ok: true } (no un error distinto)', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null })
    const email = 'mismo-email-para-el-throttle@la-birra.test'
    // Misma IP para los 6 intentos: el throttle es (email + ip).
    forwardedFor = 'ip-fija-para-throttle'

    for (let i = 0; i < 5; i++) {
      const res = await requestMagicLinkAction(email)
      expect(res).toEqual({ ok: true, data: undefined })
    }
    expect(signInWithOtpMock).toHaveBeenCalledTimes(5)

    // 6to intento: el throttle lo frena ANTES de llamar a Auth.
    const throttled = await requestMagicLinkAction(email)
    expect(throttled).toEqual({ ok: true, data: undefined })
    expect(signInWithOtpMock).toHaveBeenCalledTimes(5) // no subió: no volvió a pegarle a Auth
  })

  it('signInWithOtp se llama con shouldCreateUser: false — este panel nunca es un registro público', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null })

    await requestMagicLinkAction('dueno@la-birra.test')

    expect(signInWithOtpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'dueno@la-birra.test',
        options: expect.objectContaining({ shouldCreateUser: false }),
      }),
    )
  })

  it('el emailRedirectTo apunta a /admin/acceso/confirm (la ruta nueva, no /admin/login/confirm)', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null })

    await requestMagicLinkAction('dueno@la-birra.test')

    const call = signInWithOtpMock.mock.calls[0]?.[0]
    expect(call.options.emailRedirectTo).toBe('https://burgershop.test/admin/acceso/confirm')
  })
})
