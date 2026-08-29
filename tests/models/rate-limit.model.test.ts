import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `consumeRateLimit` (`src/models/rate-limit.model.ts`) es la única puerta a
 * `public.rate_limits`. Lo que importa acá NO es que la cuenta atómica ande
 * bien (eso lo prueba `tests/db/consume-rate-limit.test.ts` contra Postgres
 * real) sino el contrato que ve el llamador: el sujeto nunca viaja crudo, el
 * kill-switch no toca la base, y el fail-open/fail-closed hace lo que dice el
 * comentario largo del archivo (que es la especificación real de la tarea:
 * T2 la escribió después de que el hilo principal resolviera la discrepancia
 * con `01-tasks.md`).
 *
 * Se mockea el único borde de I/O (`createAdminClient().rpc(...)`); todo lo
 * demás (hasheo, normalización, decisión de fail-open/closed) corre de
 * verdad.
 */
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}))

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SECRET_KEY: 'secret-key',
  NEXT_PUBLIC_SITE_URL: 'https://burgershop.test',
  CRON_SECRET: 'cron-secret',
}

const ENV_KEYS = [...Object.keys(BASE_ENV), 'RATE_LIMIT_ENABLED', 'CREDENTIALS_ENCRYPTION_KEY'] as const
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  rpcMock.mockReset()
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

/**
 * `serverEnv()` cachea por módulo (una variable a nivel de módulo en
 * `env.server.ts`), así que para poder alternar `RATE_LIMIT_ENABLED` y
 * `CREDENTIALS_ENCRYPTION_KEY` entre tests hace falta `vi.resetModules()` +
 * `import()` dinámico, el mismo patrón que ya usa
 * `tests/services/owner-invite-email.adapter.test.ts`.
 */
async function loadModel(env: { RATE_LIMIT_ENABLED?: string; CREDENTIALS_ENCRYPTION_KEY?: string } = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  if (env.RATE_LIMIT_ENABLED === undefined) delete process.env.RATE_LIMIT_ENABLED
  else process.env.RATE_LIMIT_ENABLED = env.RATE_LIMIT_ENABLED
  if (env.CREDENTIALS_ENCRYPTION_KEY === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
  else process.env.CREDENTIALS_ENCRYPTION_KEY = env.CREDENTIALS_ENCRYPTION_KEY
  return import('@/models/rate-limit.model')
}

const HEX64 = /^[0-9a-f]{64}$/

describe('consumeRateLimit — el sujeto nunca llega crudo a Postgres', () => {
  it('el `p_subject` que recibe la RPC es un hex de 64 chars, nunca el email/teléfono/IP original', async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, count: 1, retry_after_seconds: 0 }], error: null })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    await consumeRateLimit({ bucket: 'magic_link:email', subject: 'dueno@la-birra.test', limit: 2, windowSeconds: 900 })

    const call = rpcMock.mock.calls[0]?.[1] as { p_bucket: string; p_subject: string }
    expect(call.p_subject).toMatch(HEX64)
    expect(call.p_subject).not.toContain('dueno')
    expect(call.p_subject).not.toContain('@')
    expect(call.p_bucket).toBe('magic_link:email')
  })

  it('normalización: `"  Foo@Bar.COM "` y `"foo@bar.com"` producen el MISMO subject hasheado', async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, count: 1, retry_after_seconds: 0 }], error: null })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    await consumeRateLimit({ bucket: 'magic_link:email', subject: '  Foo@Bar.COM ', limit: 2, windowSeconds: 900 })
    await consumeRateLimit({ bucket: 'magic_link:email', subject: 'foo@bar.com', limit: 2, windowSeconds: 900 })

    const [firstCall, secondCall] = rpcMock.mock.calls.map((c) => (c[1] as { p_subject: string }).p_subject)
    expect(firstCall).toBe(secondCall)
  })

  it('dos sujetos distintos producen hashes distintos (si no, todos comparten balde)', async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, count: 1, retry_after_seconds: 0 }], error: null })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    await consumeRateLimit({ bucket: 'order:phone', subject: '+5491111111111', limit: 5, windowSeconds: 600 })
    await consumeRateLimit({ bucket: 'order:phone', subject: '+5492222222222', limit: 5, windowSeconds: 600 })

    const [a, b] = rpcMock.mock.calls.map((c) => (c[1] as { p_subject: string }).p_subject)
    expect(a).not.toBe(b)
  })
})

describe('consumeRateLimit — kill-switch RATE_LIMIT_ENABLED', () => {
  it('en `false`, devuelve allowed:true sin llamar a la RPC ni tocar la base', async () => {
    const { consumeRateLimit } = await loadModel({
      RATE_LIMIT_ENABLED: 'false',
      CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test',
    })

    const decision = await consumeRateLimit({ bucket: 'order:phone', subject: '+5491111111111', limit: 5, windowSeconds: 600 })

    expect(decision).toEqual({ allowed: true, remaining: 5, retryAfterSeconds: 0 })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('sin la variable seteada (default), SÍ limita — el default es "limitando", apagar por accidente es peor', async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, count: 1, retry_after_seconds: 0 }], error: null })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    await consumeRateLimit({ bucket: 'order:phone', subject: '+5491111111111', limit: 5, windowSeconds: 600 })

    expect(rpcMock).toHaveBeenCalledOnce()
  })
})

describe('consumeRateLimit — fail-open / fail-closed cuando la RPC falla', () => {
  it('la RPC tira (error de Postgres): onError por defecto ("allow") deja pasar sin contar la llamada', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    const decision = await consumeRateLimit({ bucket: 'order:phone', subject: '+5491111111111', limit: 5, windowSeconds: 600 })

    expect(decision).toEqual({ allowed: true, remaining: 5, retryAfterSeconds: 0 })
    vi.restoreAllMocks()
  })

  it('la RPC tira: con onError:"deny" explícito, bloquea como si se hubiera llegado al límite', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    const decision = await consumeRateLimit({
      bucket: 'payment_change:store',
      subject: '42',
      limit: 3,
      windowSeconds: 3600,
      onError: 'deny',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.remaining).toBe(0)
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    vi.restoreAllMocks()
  })

  it('la RPC no devuelve ninguna fila (data vacío): se trata igual que un error, respeta onError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValue({ data: [], error: null })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    const decision = await consumeRateLimit({
      bucket: 'magic_link:global',
      subject: 'global',
      limit: 15,
      windowSeconds: 3600,
      onError: 'deny',
    })

    expect(decision.allowed).toBe(false)
    vi.restoreAllMocks()
  })

  it('sin CREDENTIALS_ENCRYPTION_KEY: no se puede hashear el sujeto, así que nunca llama a la RPC y cae al fail-open/closed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { consumeRateLimit } = await loadModel({}) // sin CREDENTIALS_ENCRYPTION_KEY

    const decision = await consumeRateLimit({ bucket: 'order:phone', subject: '+5491111111111', limit: 5, windowSeconds: 600 })

    expect(decision.allowed).toBe(true) // default 'allow'
    expect(rpcMock).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('el log de la falla no lleva el sujeto (ni crudo ni hasheado), solo el nombre del balde y el modo de error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    await consumeRateLimit({ bucket: 'order:phone', subject: '+5491111111111', limit: 5, windowSeconds: 600 })

    const loggedText = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(loggedText).not.toContain('+5491111111111')
    vi.restoreAllMocks()
  })
})

describe('consumeRateLimit — `remaining` nunca negativo', () => {
  it('con count muy por encima del límite, remaining da 0, no un número negativo', async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: false, count: 500, retry_after_seconds: 120 }], error: null })
    const { consumeRateLimit } = await loadModel({ CREDENTIALS_ENCRYPTION_KEY: 'una-clave-de-test' })

    const decision = await consumeRateLimit({ bucket: 'order:store', subject: 'la-birra', limit: 300, windowSeconds: 600 })

    expect(decision.remaining).toBe(0)
    expect(decision.allowed).toBe(false)
  })
})
