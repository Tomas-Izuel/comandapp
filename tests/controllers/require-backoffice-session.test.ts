import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `requireBackofficeSession()` (`src/controllers/platform.controller.ts`) es
 * la función de 6 líneas que causó el loop infinito de Google + TOTP: antes
 * distinguía "tiene sesión pero sin aal2" en dos destinos según si el
 * usuario ya tenía un factor TOTP verificado, y mandaba a `/backoffice/login`
 * a quien SÍ tenía factor — exactamente el caso de Google, que vuelve por un
 * redirect y no puede pedir el código ahí. El arreglo es que ahora la
 * distinción desaparece: sin `aal2` siempre es `/backoffice/mfa`, tenga o no
 * factor, porque esa página ya sabe decidir sola cuál de las dos mitades
 * mostrar (eso se cubre aparte en backoffice-mfa-page.test.ts).
 *
 * Se mockea el borde real: `requirePlatformAdmin` (que adentro depende de
 * Postgres viendo `aal2`) y `getCurrentUser`. La lógica de a dónde
 * redirigir —el corazón del bug— corre de verdad.
 */
const { requirePlatformAdminMock, getCurrentUserMock } = vi.hoisted(() => ({
  requirePlatformAdminMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
}))

vi.mock('@/models/platform.model', () => ({
  requirePlatformAdmin: requirePlatformAdminMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: getCurrentUserMock,
}))

const { requireBackofficeSession } = await import('@/controllers/platform.controller')

beforeEach(() => {
  requirePlatformAdminMock.mockReset()
  getCurrentUserMock.mockReset()
})

/**
 * `redirect()` de Next lanza una excepción de control de flujo con un
 * `.digest` tipo `NEXT_REDIRECT;<type>;<path>;<status>;` — no hay try/catch
 * que la absorba en el código real, así que el test tiene que capturarla él
 * mismo. No se mockea `next/navigation`: el `redirect()` real funciona sin
 * infraestructura de request (verificado a mano), así que corre de verdad.
 */
async function redirectPathOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (err) {
    const digest = (err as { digest?: string }).digest
    if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT;')) throw err
    // "NEXT_REDIRECT;replace;/backoffice/mfa;307;" → el path es el 3er campo.
    return digest.split(';')[2]
  }
  throw new Error('se esperaba que redirect() lanzara, pero la función terminó sin redirigir')
}

describe('requireBackofficeSession()', () => {
  it('sin sesión (getCurrentUser → null) redirige a /backoffice/login', async () => {
    requirePlatformAdminMock.mockRejectedValue(new Error('No tenés acceso al backoffice de la plataforma'))
    getCurrentUserMock.mockResolvedValue(null)

    const path = await redirectPathOf(() => requireBackofficeSession())

    expect(path).toBe('/backoffice/login')
  })

  it('con sesión pero sin aal2 redirige a /backoffice/mfa — el caso de Google que causaba el loop', async () => {
    // `requireBackofficeSession` YA NO llama a `listFactors`: no le importa
    // si el usuario tiene o no un factor TOTP verificado, así que ese dato ni
    // se mockea acá — es justamente la prueba de que la distinción desapareció.
    // Antes del arreglo, un usuario CON TOTP ya enrolado pero sesión en aal1
    // (típico de volver de Google, que no tiene continuación del lado del
    // cliente) terminaba en `/backoffice/login`, una pantalla sin botón para
    // pedir el código: loop infinito. Si esta aserción alguna vez ve
    // `/backoffice/login` en vez de `/backoffice/mfa`, el bug volvió. La
    // decisión de qué mostrar DENTRO de `/backoffice/mfa` según haya o no
    // factor —la otra mitad del arreglo— se cubre en
    // backoffice-mfa-page.test.ts, que es donde esa lectura sí ocurre.
    requirePlatformAdminMock.mockRejectedValue(new Error('No tenés acceso al backoffice de la plataforma'))
    getCurrentUserMock.mockResolvedValue({ id: 'user-1', email: 'admin@plataforma.test' })

    const path = await redirectPathOf(() => requireBackofficeSession())

    expect(path).toBe('/backoffice/mfa')
  })

  it('con aal2 y fila en platform_admins devuelve el email y NO redirige', async () => {
    requirePlatformAdminMock.mockResolvedValue({ userId: 'user-1', email: 'admin@plataforma.test' })

    const identity = await requireBackofficeSession()

    expect(identity).toEqual({ email: 'admin@plataforma.test' })
    expect(getCurrentUserMock).not.toHaveBeenCalled() // ni hace falta: ya resolvió por la rama feliz
  })
})
