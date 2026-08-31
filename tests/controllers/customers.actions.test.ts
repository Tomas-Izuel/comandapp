import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { requireStoreMembershipMock, updateCustomerNotesMock, setCustomerOptOutMock, revalidatePathMock } = vi.hoisted(() => ({
  requireStoreMembershipMock: vi.fn(),
  updateCustomerNotesMock: vi.fn(),
  setCustomerOptOutMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/models/store.model', () => ({ requireStoreMembership: requireStoreMembershipMock }))
vi.mock('@/models/customer.model', () => ({
  updateCustomerNotes: updateCustomerNotesMock,
  setCustomerOptOut: setCustomerOptOutMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const { updateCustomerNotesAction, setCustomerOptOutAction } = await import('@/controllers/customers.actions')
const { DomainError } = await import('@/lib/errors')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('updateCustomerNotesAction', () => {
  it('un staff no-dueño recibe ActionResult<{ok:false}> con el mensaje de dominio, sin excepción sin capturar', async () => {
    requireStoreMembershipMock.mockRejectedValueOnce(new DomainError('Esta acción es solo para el dueño del local', { status: 403 }))

    const result = await updateCustomerNotesAction(STORE_ID, CUSTOMER_ID, 'una nota')

    expect(result).toMatchObject({ ok: false, error: 'Esta acción es solo para el dueño del local' })
    expect(updateCustomerNotesMock).not.toHaveBeenCalled()
  })

  it('un owner guarda la nota y revalida /admin/clientes', async () => {
    requireStoreMembershipMock.mockResolvedValueOnce({ userId: 'user-1', role: 'owner' })
    updateCustomerNotesMock.mockResolvedValueOnce(undefined)

    const result = await updateCustomerNotesAction(STORE_ID, CUSTOMER_ID, 'Pide sin cebolla')

    expect(result).toEqual({ ok: true, data: undefined })
    expect(updateCustomerNotesMock).toHaveBeenCalledWith(STORE_ID, CUSTOMER_ID, 'Pide sin cebolla')
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/clientes')
  })

  it('un storeId inválido (no positivo) rechaza en Zod antes de tocar el modelo', async () => {
    const result = await updateCustomerNotesAction(-1, CUSTOMER_ID, 'x')

    expect(result.ok).toBe(false)
    expect(requireStoreMembershipMock).not.toHaveBeenCalled()
  })

  it('una nota que excede el máximo de 2000 caracteres rechaza en Zod', async () => {
    requireStoreMembershipMock.mockResolvedValueOnce({ userId: 'user-1', role: 'owner' })

    const result = await updateCustomerNotesAction(STORE_ID, CUSTOMER_ID, 'a'.repeat(2001))

    expect(result.ok).toBe(false)
    expect(updateCustomerNotesMock).not.toHaveBeenCalled()
  })
})

describe('setCustomerOptOutAction', () => {
  it('un staff no-dueño no puede dar de baja/alta a un cliente', async () => {
    requireStoreMembershipMock.mockRejectedValueOnce(new DomainError('Esta acción es solo para el dueño del local', { status: 403 }))

    const result = await setCustomerOptOutAction(STORE_ID, CUSTOMER_ID, true)

    expect(result.ok).toBe(false)
    expect(setCustomerOptOutMock).not.toHaveBeenCalled()
  })

  it('un owner puede dar de baja a un cliente de promos y la página se revalida', async () => {
    requireStoreMembershipMock.mockResolvedValueOnce({ userId: 'user-1', role: 'owner' })
    setCustomerOptOutMock.mockResolvedValueOnce(undefined)

    const result = await setCustomerOptOutAction(STORE_ID, CUSTOMER_ID, true)

    expect(result).toEqual({ ok: true, data: undefined })
    expect(setCustomerOptOutMock).toHaveBeenCalledWith(STORE_ID, CUSTOMER_ID, true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/clientes')
  })

  it('un customerId que no existe en la tienda (404 del modelo) llega como ActionResult<{ok:false}>, no como 500', async () => {
    requireStoreMembershipMock.mockResolvedValueOnce({ userId: 'user-1', role: 'owner' })
    setCustomerOptOutMock.mockRejectedValueOnce(new DomainError('No se encontró ese cliente en esta tienda', { status: 404 }))

    const result = await setCustomerOptOutAction(STORE_ID, CUSTOMER_ID, false)

    expect(result).toMatchObject({ ok: false, error: 'No se encontró ese cliente en esta tienda' })
  })
})
