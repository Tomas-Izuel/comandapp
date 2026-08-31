import { describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `storeTransferReceipt` (`order.model.ts`, T2.2) — el camino de subida del
 * comprobante. Es el único lugar donde "un comprobante por pedido" se cierra
 * del lado de la aplicación (Postgres lo cierra también, ver
 * `tests/db/transfer-receipt-immutable.test.ts`), y el orden de operaciones
 * es la parte que importa: subir ANTES de escribir la fila, y si el CAS
 * pierde DESPUÉS de subir, borrar el objeto recién subido.
 *
 * Hallazgo del `code-reviewer` que este archivo cubre explícitamente: qué
 * pasa cuando el objeto ya está en Storage y el UPDATE-con-CAS después
 * pierde la carrera (otra request ganó, o el pedido cambió de estado entre
 * medio). Es un test de comportamiento: si el código no limpiara el objeto
 * huérfano, este archivo lo diría con un assert que falla, no con una
 * opinión.
 */
const VALID_TOKEN = '23456789abcdefghjkmnpqrs' // 24 chars, alfabeto de 31 de orderTokenSchema (sin 0/1/i/l/o)
const ORDER_ID = 555
const STORE_ID = 7
const EXPECTED_PATH = `${STORE_ID}/${ORDER_ID}/comprobante`

function orderRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    store_id: STORE_ID,
    status: 'pending',
    payment_method: 'transfer',
    payment_status: 'pending',
    transfer_receipt_uploaded_at: null,
    ...overrides,
  }
}

type AdminMockOpts = {
  orderRow: Record<string, unknown> | null
  uploadError?: { message: string } | null
  /** Filas que devuelve el UPDATE-con-CAS + `.select('id')`. `[]` = el CAS perdió. */
  updateRows?: { id: number }[] | null
  updateError?: { message: string } | null
}

function buildAdminMock(opts: AdminMockOpts) {
  const uploadMock = vi.fn(async () => ({ error: opts.uploadError ?? null }))
  const removeMock = vi.fn(async () => ({ error: null }))
  const updateArgsCaptured: Record<string, unknown>[] = []

  const admin = {
    from: (table: string) => {
      if (table !== 'orders') throw new Error(`tabla admin inesperada en el test: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.orderRow, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          updateArgsCaptured.push(patch)
          return {
            eq: () => ({
              is: () => ({
                select: async () => ({ data: opts.updateRows ?? [], error: opts.updateError ?? null }),
              }),
            }),
          }
        },
      }
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'order-receipts') throw new Error(`bucket inesperado en el test: ${bucket}`)
        return { upload: uploadMock, remove: removeMock }
      },
    },
  }

  return { admin, uploadMock, removeMock, updateArgsCaptured }
}

let currentMock: ReturnType<typeof buildAdminMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => currentMock.admin,
}))

const { storeTransferReceipt } = await import('@/models/order.model')

function uploadInput(overrides: Partial<{ token: string; mime: 'image/jpeg' | 'application/pdf' }> = {}) {
  return {
    token: VALID_TOKEN,
    bytes: Buffer.from('fake-image-bytes'),
    mime: 'image/jpeg' as const,
    sha256: 'a'.repeat(64),
    ...overrides,
  }
}

describe('storeTransferReceipt — validación del pedido ANTES de tocar Storage', () => {
  it('token con forma inválida ⇒ 404, nunca llega a leer la base', async () => {
    currentMock = buildAdminMock({ orderRow: orderRowFixture() })
    await expect(storeTransferReceipt(uploadInput({ token: 'demasiado-corto' }))).rejects.toMatchObject({
      status: 404,
    })
    expect(currentMock.uploadMock).not.toHaveBeenCalled()
  })

  it('pedido inexistente ⇒ 404', async () => {
    currentMock = buildAdminMock({ orderRow: null })
    await expect(storeTransferReceipt(uploadInput())).rejects.toMatchObject({ status: 404 })
    expect(currentMock.uploadMock).not.toHaveBeenCalled()
  })

  it('pedido que NO es de transferencia ⇒ rechaza, no sube nada', async () => {
    currentMock = buildAdminMock({ orderRow: orderRowFixture({ payment_method: 'online' }) })
    await expect(storeTransferReceipt(uploadInput())).rejects.toThrow('no es de pago por transferencia')
    expect(currentMock.uploadMock).not.toHaveBeenCalled()
  })

  it('pedido en estado terminal (delivered/cancelled) ⇒ rechaza, no sube nada', async () => {
    currentMock = buildAdminMock({ orderRow: orderRowFixture({ status: 'cancelled' }) })
    await expect(storeTransferReceipt(uploadInput())).rejects.toThrow('ya no admite un comprobante')
    expect(currentMock.uploadMock).not.toHaveBeenCalled()
  })

  it('pedido con payment_status distinto de pending (ya se confirmó o rechazó) ⇒ rechaza, no sube nada', async () => {
    currentMock = buildAdminMock({ orderRow: orderRowFixture({ payment_status: 'approved' }) })
    await expect(storeTransferReceipt(uploadInput())).rejects.toThrow('ya no está esperando el pago')
    expect(currentMock.uploadMock).not.toHaveBeenCalled()
  })

  it('pedido que YA tiene un comprobante subido ⇒ 409, no sube nada — el "un solo tiro" evaluado ANTES de subir', async () => {
    currentMock = buildAdminMock({
      orderRow: orderRowFixture({ transfer_receipt_uploaded_at: '2026-08-31T00:00:00.000Z' }),
    })
    await expect(storeTransferReceipt(uploadInput())).rejects.toMatchObject({ status: 409 })
    expect(currentMock.uploadMock).not.toHaveBeenCalled()
  })
})

describe('storeTransferReceipt — camino feliz', () => {
  it('sube al path determinístico {storeId}/{orderId}/comprobante y actualiza la fila con CAS', async () => {
    currentMock = buildAdminMock({ orderRow: orderRowFixture(), updateRows: [{ id: ORDER_ID }] })

    const result = await storeTransferReceipt(uploadInput())

    expect(result).toEqual({ orderId: ORDER_ID, storeId: STORE_ID })
    expect(currentMock.uploadMock).toHaveBeenCalledWith(
      EXPECTED_PATH,
      expect.anything(),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    )
    expect(currentMock.removeMock).not.toHaveBeenCalled()
  })
})

describe('storeTransferReceipt — el CAS pierde DESPUÉS de subir (hallazgo del code-reviewer)', () => {
  it('el objeto recién subido se borra (best-effort) y se devuelve 409 — nunca queda un huérfano silencioso', async () => {
    // updateRows: [] simula la carrera real: otra request (u otro cambio de
    // estado) ganó el UPDATE entre que ESTA request validó el pedido y subió
    // el archivo.
    currentMock = buildAdminMock({ orderRow: orderRowFixture(), updateRows: [] })

    await expect(storeTransferReceipt(uploadInput())).rejects.toMatchObject({ status: 409 })

    // La aserción central: el objeto que se acaba de subir NO puede quedar
    // huérfano en el bucket. Si esto fallara, sería un hallazgo real para
    // reportar — no algo que este test deba "aceptar".
    expect(currentMock.removeMock).toHaveBeenCalledWith([EXPECTED_PATH])
  })

  it('si además el borrado del objeto huérfano falla, igual se propaga el 409 (best-effort: no tapa el error real)', async () => {
    currentMock = buildAdminMock({ orderRow: orderRowFixture(), updateRows: [] })
    currentMock.removeMock.mockRejectedValueOnce(new Error('storage caído'))

    await expect(storeTransferReceipt(uploadInput())).rejects.toMatchObject({ status: 409 })
  })

  it('un error de Postgres en el UPDATE (no la carrera del CAS) también intenta limpiar el objeto y propaga un error real, no un 409 de dominio', async () => {
    currentMock = buildAdminMock({
      orderRow: orderRowFixture(),
      updateError: { message: 'connection reset' },
    })

    await expect(storeTransferReceipt(uploadInput())).rejects.toThrow(/No se pudo registrar el comprobante/)
    expect(currentMock.removeMock).toHaveBeenCalledWith([EXPECTED_PATH])
  })
})

describe('storeTransferReceipt — Storage caído al subir', () => {
  it('un error de upload propaga un error real y NUNCA llega a tocar la fila del pedido', async () => {
    currentMock = buildAdminMock({ orderRow: orderRowFixture(), uploadError: { message: 'bucket unreachable' } })

    await expect(storeTransferReceipt(uploadInput())).rejects.toThrow(/No se pudo subir el comprobante/)
    expect(currentMock.updateArgsCaptured).toHaveLength(0)
  })
})
