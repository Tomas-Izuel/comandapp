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

const { requireStoreMembershipMock, getCustomerDirectoryMock } = vi.hoisted(() => ({
  requireStoreMembershipMock: vi.fn(),
  getCustomerDirectoryMock: vi.fn(),
}))

vi.mock('@/models/store.model', () => ({ requireStoreMembership: requireStoreMembershipMock }))
vi.mock('@/models/customer.model', () => ({ getCustomerDirectory: getCustomerDirectoryMock }))

const { getCustomerDirectoryForStore } = await import('@/controllers/customers.controller')
const { DomainError } = await import('@/lib/errors')

/**
 * `getCustomerDirectoryForStore` — la lectura de `/admin/clientes`.
 *
 * El padrón muestra cuánto gastó cada cliente (información de caja, mismo
 * criterio que `store_couriers`), así que este controller repite
 * `requireStoreMembership(storeId, { role: 'owner' })` como defensa en
 * profundidad AUNQUE la page ya haya hecho su propio gate — es la tercera
 * capa antes de la RPC (`is_store_owner` en Postgres, cubierta en
 * `tests/db/store-customers.test.ts`). Sin este chequeo acá, la única
 * barrera entre un `staff` no-dueño y el padrón sería el redirect de la page.
 */
describe('getCustomerDirectoryForStore', () => {
  it('exige role: owner explícito ANTES de leer el padrón — un staff no-dueño nunca llega a getCustomerDirectory', async () => {
    requireStoreMembershipMock.mockRejectedValueOnce(new DomainError('Esta acción es solo para el dueño del local', { status: 403 }))

    await expect(getCustomerDirectoryForStore(STORE_ID)).rejects.toMatchObject({ status: 403 })
    expect(getCustomerDirectoryMock).not.toHaveBeenCalled()
  })

  it('un owner real recibe el padrón, y el storeId se pasa tal cual a las dos capas', async () => {
    requireStoreMembershipMock.mockResolvedValueOnce({ userId: 'user-1', role: 'owner' })
    const directory = { customers: [], totals: { customers: 0, withEmail: 0, inactive30: 0 } }
    getCustomerDirectoryMock.mockResolvedValueOnce(directory)

    const result = await getCustomerDirectoryForStore(STORE_ID)

    expect(requireStoreMembershipMock).toHaveBeenCalledWith(STORE_ID, { role: 'owner' })
    expect(getCustomerDirectoryMock).toHaveBeenCalledWith(STORE_ID)
    expect(result).toBe(directory)
  })
})
