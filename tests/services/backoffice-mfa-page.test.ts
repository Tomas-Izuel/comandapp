import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

// `mfa-challenge.tsx` y `mfa-enroll.tsx` importan `@/lib/supabase/client`, que
// valida las env públicas AL IMPORTAR el módulo (`src/lib/env.client.ts`). No
// se usan de verdad acá (no se renderiza ni se invoca el cliente), pero el
// import tiene que resolver.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'

/**
 * `src/app/backoffice/mfa/page.tsx` es la otra mitad del arreglo del loop:
 * decide, mirando `mfa.listFactors()`, si mostrar el desafío (factor
 * verificado) o el enrolamiento (sin factor). Elegir mal acá deja a alguien
 * con TOTP ya enrolado viendo el flujo de "escaneá este QR" de nuevo, o peor,
 * a alguien sin factor viendo un desafío que nunca va a poder pasar.
 *
 * No hay jsdom ni @testing-library en este repo (ver vitest.config.ts: "si
 * algún día hace falta testear un componente, se agrega un
 * environmentMatchGlobs") y no está en mi alcance instalar dependencias. Pero
 * `BackofficeMfaPage` es un Server Component async: llamarlo devuelve
 * directamente el árbol de elementos que arma el runtime JSX automático de
 * React (objetos planos `{ type, props }`, sin DOM de por medio). Eso
 * alcanza para verificar CUÁL componente se eligió y con QUÉ prop —que es
 * exactamente la decisión que hay que cubrir— sin renderizar nada de verdad.
 *
 * Se mockea el borde de sesión (`redirectIfAlreadyAuthorized`,
 * `requireAuthenticatedUser`, ambas ya cubiertas en
 * require-backoffice-session.test.ts) y el borde de I/O (`mfa.listFactors`
 * vía `@/lib/supabase/server`). `signOutAction` se mockea porque solo se pasa
 * como prop de un `<form action>`, nunca se invoca acá.
 */
const { redirectIfAlreadyAuthorizedMock, requireAuthenticatedUserMock, listFactorsMock } = vi.hoisted(() => ({
  redirectIfAlreadyAuthorizedMock: vi.fn(),
  requireAuthenticatedUserMock: vi.fn(),
  listFactorsMock: vi.fn(),
}))

vi.mock('@/controllers/platform.controller', () => ({
  redirectIfAlreadyAuthorized: redirectIfAlreadyAuthorizedMock,
  requireAuthenticatedUser: requireAuthenticatedUserMock,
}))

vi.mock('@/controllers/platform.actions', () => ({
  signOutAction: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { mfa: { listFactors: listFactorsMock } } }),
}))

const BackofficeMfaPage = (await import('@/app/backoffice/mfa/page')).default
const { BackofficeMfaChallenge } = await import('@/views/backoffice/mfa-challenge')
const { BackofficeMfaEnroll } = await import('@/views/backoffice/mfa-enroll')

beforeEach(() => {
  redirectIfAlreadyAuthorizedMock.mockReset().mockResolvedValue(undefined)
  requireAuthenticatedUserMock.mockReset().mockResolvedValue({ userId: 'user-1', email: 'admin@plataforma.test' })
  listFactorsMock.mockReset()
})

/**
 * Recorre el árbol de elementos JSX (objetos `{ type, props }` del runtime
 * automático, sin DOM) buscando el primero cuyo `type` sea el que se pasa.
 * No hace falta más que esto: no estamos renderizando, solo inspeccionando
 * qué componente decidió montar la page.
 */
function findElement(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type)
      if (found) return found
    }
    return null
  }
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === type) return el as { props: Record<string, unknown> }
  if (el.props && 'children' in el.props) return findElement(el.props.children, type)
  return null
}

describe('BackofficeMfaPage — qué mitad del segundo factor muestra', () => {
  it('con un factor TOTP verificado, renderiza BackofficeMfaChallenge con SU factorId (no BackofficeMfaEnroll)', async () => {
    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: 'factor-ya-verificado', factor_type: 'totp', status: 'verified' }], all: [] },
      error: null,
    })

    const tree = await BackofficeMfaPage()

    const challenge = findElement(tree, BackofficeMfaChallenge)
    expect(challenge).not.toBeNull()
    expect(challenge!.props.factorId).toBe('factor-ya-verificado')
    expect(findElement(tree, BackofficeMfaEnroll)).toBeNull()
  })

  it('sin ningún factor TOTP, renderiza BackofficeMfaEnroll (no BackofficeMfaChallenge)', async () => {
    listFactorsMock.mockResolvedValue({
      data: { totp: [], all: [] },
      error: null,
    })

    const tree = await BackofficeMfaPage()

    expect(findElement(tree, BackofficeMfaEnroll)).not.toBeNull()
    expect(findElement(tree, BackofficeMfaChallenge)).toBeNull()
  })
})
