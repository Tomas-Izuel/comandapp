import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `/api/cron/cleanup` — el paso de purga de comprobantes que suma T2.7. El
 * orden es la parte que importa y va comentado en el propio código: nulear
 * la fila ANTES de borrar el objeto de Storage dejaría un archivo huérfano
 * para siempre (nada volvería a apuntarlo). Este archivo prueba el orden
 * real: `listPurgeableReceipts` → `purgeReceiptObjects` → `clearReceiptRefs`,
 * y que `clearReceiptRefs` **solo** recibe los ids cuyo objeto se borró de
 * verdad — no todos los candidatos.
 */
const { rpcMock, listPurgeableReceiptsMock, purgeReceiptObjectsMock, clearReceiptRefsMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  listPurgeableReceiptsMock: vi.fn(),
  purgeReceiptObjectsMock: vi.fn(),
  clearReceiptRefsMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}))

vi.mock('@/models/order.model', () => ({
  listPurgeableReceipts: listPurgeableReceiptsMock,
  purgeReceiptObjects: purgeReceiptObjectsMock,
  clearReceiptRefs: clearReceiptRefsMock,
}))

const { GET } = await import('@/app/api/cron/cleanup/route')

function authorizedRequest(): Request {
  return new Request('https://burgershop.test/api/cron/cleanup', {
    headers: { authorization: 'Bearer cron-secret' },
  })
}

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ data: { eventsDeleted: 0, auditDeleted: 0 }, error: null })
  listPurgeableReceiptsMock.mockReset().mockResolvedValue([])
  purgeReceiptObjectsMock.mockReset().mockResolvedValue([])
  clearReceiptRefsMock.mockReset().mockResolvedValue(undefined)
})

describe('GET /api/cron/cleanup — auth', () => {
  it('sin el header Authorization correcto → 401, no corre nada', async () => {
    const res = await GET(new Request('https://burgershop.test/api/cron/cleanup') as never)
    expect(res.status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/cleanup — purga de comprobantes: orden y filtrado', () => {
  it('sin comprobantes purgables, no llama a purgeReceiptObjects ni a clearReceiptRefs, y responde receiptsPurged: 0', async () => {
    listPurgeableReceiptsMock.mockResolvedValue([])

    const res = await GET(authorizedRequest() as never)
    const body = (await res.json()) as { receiptsPurged: number }

    expect(body.receiptsPurged).toBe(0)
    expect(purgeReceiptObjectsMock).not.toHaveBeenCalled()
    expect(clearReceiptRefsMock).not.toHaveBeenCalled()
  })

  it('con comprobantes purgables, borra los objetos y DESPUÉS limpia la referencia — nunca al revés', async () => {
    listPurgeableReceiptsMock.mockResolvedValue([
      { orderId: 1, path: '7/1/comprobante' },
      { orderId: 2, path: '7/2/comprobante' },
    ])
    purgeReceiptObjectsMock.mockResolvedValue(['7/1/comprobante', '7/2/comprobante'])

    const callOrder: string[] = []
    purgeReceiptObjectsMock.mockImplementation(async (paths: string[]) => {
      callOrder.push('purge')
      return paths
    })
    clearReceiptRefsMock.mockImplementation(async () => {
      callOrder.push('clear')
    })

    const res = await GET(authorizedRequest() as never)
    const body = (await res.json()) as { receiptsPurged: number }

    expect(callOrder).toEqual(['purge', 'clear'])
    expect(clearReceiptRefsMock).toHaveBeenCalledWith([1, 2])
    expect(body.receiptsPurged).toBe(2)
  })

  it('si el borrado de Storage falla PARA ALGUNOS objetos, clearReceiptRefs solo recibe los ids de los que SÍ se borraron', async () => {
    listPurgeableReceiptsMock.mockResolvedValue([
      { orderId: 1, path: '7/1/comprobante' },
      { orderId: 2, path: '7/2/comprobante' },
      { orderId: 3, path: '7/3/comprobante' },
    ])
    // Solo el 1 y el 3 se borraron de verdad (purgeReceiptObjects nunca tira,
    // devuelve los que SÍ pudo borrar).
    purgeReceiptObjectsMock.mockResolvedValue(['7/1/comprobante', '7/3/comprobante'])

    const res = await GET(authorizedRequest() as never)
    const body = (await res.json()) as { receiptsPurged: number }

    expect(clearReceiptRefsMock).toHaveBeenCalledWith([1, 3])
    expect(body.receiptsPurged).toBe(2)
  })

  it('si el borrado de Storage falla para TODOS, no se llama clearReceiptRefs (ninguna fila queda huérfana ni se limpia de más)', async () => {
    listPurgeableReceiptsMock.mockResolvedValue([{ orderId: 1, path: '7/1/comprobante' }])
    purgeReceiptObjectsMock.mockResolvedValue([]) // ninguno se borró

    const res = await GET(authorizedRequest() as never)
    const body = (await res.json()) as { receiptsPurged: number }

    expect(clearReceiptRefsMock).not.toHaveBeenCalled()
    expect(body.receiptsPurged).toBe(0)
  })

  it('un fallo en la purga de comprobantes NO tumba la limpieza de cleanup_old_records, que ya corrió — responde 200 con receiptsPurged: 0', async () => {
    listPurgeableReceiptsMock.mockRejectedValue(new Error('storage caído'))

    const res = await GET(authorizedRequest() as never)
    const body = (await res.json()) as { receiptsPurged: number }

    expect(res.status).toBe(200)
    expect(body.receiptsPurged).toBe(0)
    expect(rpcMock).toHaveBeenCalledOnce() // cleanup_old_records sí corrió
  })

  it('un fallo en cleanup_old_records (el RPC) SÍ hace fallar la respuesta entera — no llega ni a intentar la purga de comprobantes', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection reset' } })

    const res = await GET(authorizedRequest() as never)

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(listPurgeableReceiptsMock).not.toHaveBeenCalled()
  })
})
