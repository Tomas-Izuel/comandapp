import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitDecision } from '@/models/types'

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
 * SIEMPRE la misma —email desconocido, email válido, o pedido frenado por
 * cualquiera de los 4 baldes de `checkMagicLinkBudget`— porque cualquier
 * diferencia convierte el formulario en un oráculo para averiguar qué email
 * tiene panel de qué local.
 *
 * REESCRITO (T4/rate-limiting): el `Map` en memoria (`magicLinkAttempts`)
 * que este archivo probaba se borró — el throttle real vive en
 * `public.rate_limits` vía `consumeRateLimit`. Se mockea ESE borde (no
 * `signInWithOtp` solo) para poder simular "balde agotado" sin depender de
 * Postgres: la atomicidad real del balde ya la prueba
 * `tests/db/consume-rate-limit.test.ts` contra la base. Lo que este archivo
 * prueba es el CONTRATO de la acción: en qué orden consume los 4 baldes, que
 * corta apenas uno bloquea, que todos van `onError:'deny'`, y que la
 * respuesta nunca varía.
 */
const { signInWithOtpMock, consumeRateLimitMock } = vi.hoisted(() => ({
  signInWithOtpMock: vi.fn(),
  consumeRateLimitMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithOtp: signInWithOtpMock } }),
}))

vi.mock('@/models/rate-limit.model', () => ({
  consumeRateLimit: consumeRateLimitMock,
}))

// `x-forwarded-for` fija por default; algunos tests la pisan para variar la IP.
let forwardedFor = '1.2.3.4'
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-forwarded-for' ? forwardedFor : null) }),
}))

const { requestMagicLinkAction } = await import('@/controllers/admin.actions')

/** Siempre permite, en cualquier balde — el caso feliz por default. */
function allowAll(): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: true, remaining: 99, retryAfterSeconds: 0 })
}

beforeEach(() => {
  signInWithOtpMock.mockReset()
  consumeRateLimitMock.mockReset()
  consumeRateLimitMock.mockImplementation(allowAll)
  forwardedFor = `${Date.now()}.${Math.random()}`
})

afterEach(() => {
  vi.restoreAllMocks()
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

  it('email mal formado SÍ devuelve error — es un chequeo de FORMA, no de existencia, y no gasta ningún balde', async () => {
    const res = await requestMagicLinkAction('esto-no-es-un-email')

    expect(res.ok).toBe(false)
    expect(signInWithOtpMock).not.toHaveBeenCalled()
    expect(consumeRateLimitMock).not.toHaveBeenCalled() // la validación corre ANTES de gastar cupo
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

describe('requestMagicLinkAction — los 4 baldes: orden, corte temprano, y fail-closed', () => {
  it('consume los 4 baldes EN ORDEN (email → email:day → ip → global) cuando todos dejan pasar', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null })

    await requestMagicLinkAction('orden@la-birra.test')

    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).toEqual(['magic_link:email', 'magic_link:email:day', 'magic_link:ip', 'magic_link:global'])
  })

  it('los 4 baldes se consumen con onError:"deny" (fail-closed) — a diferencia de casi todo el resto del sistema', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null })

    await requestMagicLinkAction('fail-closed@la-birra.test')

    for (const call of consumeRateLimitMock.mock.calls) {
      expect((call[0] as { onError?: string }).onError).toBe('deny')
    }
  })

  it('si `magic_link:email` ya está agotado, corta ahí: NO llega a consumir `magic_link:ip` ni `magic_link:global`', async () => {
    // Es la pieza que protege el presupuesto compartido con las invitaciones
    // (CLAUDE.md): un mismo email golpeando en loop no puede seguir gastando
    // el balde global después del primer rechazo.
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'magic_link:email' ? { allowed: false, remaining: 0, retryAfterSeconds: 900 } : allowAll(),
    )

    const res = await requestMagicLinkAction('agotado@la-birra.test')

    expect(res).toEqual({ ok: true, data: undefined }) // misma respuesta, siempre
    expect(signInWithOtpMock).not.toHaveBeenCalled()
    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).toEqual(['magic_link:email']) // ni :email:day, ni :ip, ni :global
  })

  it('el 3er intento con el mismo email (magic_link:email, limit real 2) no llega a signInWithOtp, y la respuesta es idéntica a un éxito', async () => {
    signInWithOtpMock.mockResolvedValue({ error: null })
    let emailCalls = 0
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) => {
      if (bucket !== 'magic_link:email') return allowAll()
      emailCalls++
      return emailCalls > 2 ? { allowed: false, remaining: 0, retryAfterSeconds: 900 } : { allowed: true, remaining: 2 - emailCalls, retryAfterSeconds: 0 }
    })

    for (let i = 0; i < 2; i++) {
      const res = await requestMagicLinkAction('mismo@la-birra.test')
      expect(res).toEqual({ ok: true, data: undefined })
    }
    expect(signInWithOtpMock).toHaveBeenCalledTimes(2)

    const third = await requestMagicLinkAction('mismo@la-birra.test')
    expect(third).toEqual({ ok: true, data: undefined })
    expect(signInWithOtpMock).toHaveBeenCalledTimes(2) // no subió: el 3ro no llegó a Auth
  })

  /**
   * Criterio 1b de T4 — la invariante ENTERA del presupuesto compartido: un
   * anónimo no puede dejar sin cuota al camino autenticado (invitaciones del
   * backoffice). Acá se prueba la mitad que le toca a esta acción: agotado
   * `magic_link:global`, un email NUEVO —nunca antes usado, con su propio
   * balde `magic_link:email` en cero— IGUAL se frena antes de `signInWithOtp`.
   * La otra mitad (que `resendOwnerInvite`/`inviteCourier` sigan funcionando
   * porque no tocan este bucket) se prueba en
   * `tests/services/invite-rate-limit.test.ts`, y que el CONTADOR de
   * `magic_link:global` sea de verdad compartido entre sujetos —no algo que un
   * mock pueda demostrar de forma convincente— lo prueba
   * `tests/db/consume-rate-limit.test.ts` contra Postgres real.
   */
  it('agotado `magic_link:global`, un email NUEVO (nunca antes usado) tampoco llega a signInWithOtp', async () => {
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'magic_link:global' ? { allowed: false, remaining: 0, retryAfterSeconds: 1800 } : allowAll(),
    )

    const res = await requestMagicLinkAction('jamas-visto-antes@la-birra.test')

    expect(res).toEqual({ ok: true, data: undefined })
    expect(signInWithOtpMock).not.toHaveBeenCalled()
    // Sí pasó por los tres baldes propios del email (todos en cero para un
    // email nuevo) antes de toparse con el global compartido.
    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).toEqual(['magic_link:email', 'magic_link:email:day', 'magic_link:ip', 'magic_link:global'])
  })

  it('el rechazo se loguea con el nombre del balde, nunca con el email ni la IP (regla del repo: cero PII en logs)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'magic_link:ip' ? { allowed: false, remaining: 0, retryAfterSeconds: 60 } : allowAll(),
    )
    forwardedFor = '203.0.113.9'

    await requestMagicLinkAction('secreto@la-birra.test')

    const logged = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(logged).not.toContain('secreto@la-birra.test')
    expect(logged).not.toContain('203.0.113.9')
    expect(logged).toContain('magic_link:ip') // el nombre del balde SÍ es diagnóstico útil
  })
})
