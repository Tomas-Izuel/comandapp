import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `POST /api/orders/[token]/comprobante` (T2.4) — el único camino de subida
 * del comprobante. Se mockean los bordes de I/O (`consumeRateLimit`,
 * `storeTransferReceipt`, `getOrderStatus`) para poder probar la lógica de
 * validación del route handler en aislamiento: sniff de magic bytes,
 * tamaño, y el orden exacto rate-limit → forma → magic bytes → modelo.
 *
 * La aserción que más importa: **el `Content-Type` que declara el request
 * se IGNORA por completo.** Es el pedido explícito del dueño del producto y
 * lo que distingue esta ruta de un signed-upload-URL (que no podría
 * verificarlo). Un archivo declarado `image/jpeg` con bytes de cualquier
 * otra cosa tiene que rebotar iguales que uno sin declarar nada.
 */
const { consumeRateLimitMock, storeTransferReceiptMock, getOrderStatusMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  storeTransferReceiptMock: vi.fn(),
  getOrderStatusMock: vi.fn(),
}))

vi.mock('@/models/rate-limit.model', () => ({ consumeRateLimit: consumeRateLimitMock }))
vi.mock('@/models/order.model', () => ({ storeTransferReceipt: storeTransferReceiptMock }))
vi.mock('@/controllers/checkout.controller', () => ({ getOrderStatus: getOrderStatusMock }))

const { POST } = await import('@/app/api/orders/[token]/comprobante/route')
const { DomainError } = await import('@/lib/errors')

const VALID_TOKEN = '23456789abcdefghjkmnpqrs' // 24 chars, alfabeto de 31 de orderTokenSchema

/**
 * `new Uint8Array(size)` sola es `Uint8Array<ArrayBufferLike>` para TS, que
 * `BlobPart` (el `File` constructor) no acepta sin un cast — de ahí pasar
 * siempre por un `ArrayBuffer` explícito, nunca `SharedArrayBuffer`.
 */
function bytesOf(size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(size))
}

function jpegBytes(size = 100): Uint8Array<ArrayBuffer> {
  const bytes = bytesOf(size)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  return bytes
}

function pdfBytes(size = 100): Uint8Array<ArrayBuffer> {
  const bytes = bytesOf(size)
  const header = Buffer.from('%PDF-')
  bytes.set(header, 0)
  return bytes
}

function garbageBytes(size = 100): Uint8Array<ArrayBuffer> {
  return bytesOf(size).fill(0x41) // 'AAAA...', ni JPEG ni PDF
}

function buildRequest(opts: { token?: string; file?: File; noFile?: boolean; badFormData?: boolean }): Request {
  const token = opts.token ?? VALID_TOKEN
  const url = `https://burgershop.test/api/orders/${token}/comprobante`

  if (opts.badFormData) {
    // multipart declarado pero body que no parsea como FormData real.
    return new Request(url, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'no-es-multipart' })
  }

  const form = new FormData()
  if (!opts.noFile) {
    form.set('file', opts.file ?? new File([jpegBytes()], 'comprobante.jpg', { type: 'image/jpeg' }))
  }
  return new Request(url, { method: 'POST', body: form })
}

function ctxFor(token: string) {
  return { params: Promise.resolve({ token }) } as never
}

function allow() {
  return Promise.resolve({ allowed: true, remaining: 99, retryAfterSeconds: 0 })
}
function deny(retryAfterSeconds = 60) {
  return Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds })
}

beforeEach(() => {
  consumeRateLimitMock.mockReset().mockImplementation(allow)
  storeTransferReceiptMock.mockReset().mockResolvedValue({ orderId: 1, storeId: 7 })
  getOrderStatusMock.mockReset().mockResolvedValue({ id: 1, transferReceiptUploadedAt: '2026-08-31T00:00:00.000Z' })
})

describe('POST /api/orders/[token]/comprobante — token', () => {
  it('token con forma inválida → 404, nunca consume el balde ni llama al modelo', async () => {
    const res = await POST(buildRequest({ token: 'demasiado-corto' }) as never, ctxFor('demasiado-corto'))
    expect(res.status).toBe(404)
    expect(consumeRateLimitMock).not.toHaveBeenCalled()
    expect(storeTransferReceiptMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/orders/[token]/comprobante — rate limit, ANTES de leer el archivo', () => {
  it('receipt:ip agotado → 429, nunca lee el FormData ni llama al modelo', async () => {
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) => (bucket === 'receipt:ip' ? deny() : allow()))

    const res = await POST(buildRequest({}) as never, ctxFor(VALID_TOKEN))

    expect(res.status).toBe(429)
    expect(storeTransferReceiptMock).not.toHaveBeenCalled()
  })

  it('receipt:order agotado → 429 con el texto de "ya se registró un intento"', async () => {
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) => (bucket === 'receipt:order' ? deny() : allow()))

    const res = await POST(buildRequest({}) as never, ctxFor(VALID_TOKEN))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(429)
    expect(body.error).toMatch(/Ya se registró un intento/)
    expect(storeTransferReceiptMock).not.toHaveBeenCalled()
  })

  it('consume receipt:ip con el subject = IP y receipt:order con el subject = TOKEN CRUDO (no hasheado acá: lo firma consumeRateLimit)', async () => {
    await POST(
      new Request(`https://burgershop.test/api/orders/${VALID_TOKEN}/comprobante`, {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        body: (() => {
          const form = new FormData()
          form.set('file', new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' }))
          return form
        })(),
      }) as never,
      ctxFor(VALID_TOKEN),
    )

    const calls = consumeRateLimitMock.mock.calls.map((c) => c[0] as { bucket: string; subject: string })
    expect(calls[0]).toMatchObject({ bucket: 'receipt:ip', subject: '203.0.113.9' })
    expect(calls[1]).toMatchObject({ bucket: 'receipt:order', subject: VALID_TOKEN })
  })
})

describe('POST /api/orders/[token]/comprobante — forma del archivo', () => {
  it('FormData que no parsea → 400', async () => {
    const res = await POST(buildRequest({ badFormData: true }) as never, ctxFor(VALID_TOKEN))
    expect(res.status).toBe(400)
    expect(storeTransferReceiptMock).not.toHaveBeenCalled()
  })

  it('sin el campo "file" → 400', async () => {
    const res = await POST(buildRequest({ noFile: true }) as never, ctxFor(VALID_TOKEN))
    const body = (await res.json()) as { error: string }
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/Falta el archivo/)
  })

  it('archivo de más de 4 MB → 400, NUNCA llega a leer los bytes ni a sniffear', async () => {
    const bigFile = new File([bytesOf(4 * 1024 * 1024 + 1)], 'grande.jpg', { type: 'image/jpeg' })
    const res = await POST(buildRequest({ file: bigFile }) as never, ctxFor(VALID_TOKEN))
    const body = (await res.json()) as { error: string }
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/4 MB/)
    expect(storeTransferReceiptMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/orders/[token]/comprobante — el Content-Type del browser se IGNORA: manda el sniff de bytes', () => {
  it('bytes JPEG reales (FF D8 FF), declarado image/jpeg → acepta', async () => {
    const res = await POST(
      buildRequest({ file: new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' }) }) as never,
      ctxFor(VALID_TOKEN),
    )
    expect(res.status).toBe(200)
    expect(storeTransferReceiptMock).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/jpeg' }))
  })

  it('bytes PDF reales (%PDF-), declarado application/pdf → acepta', async () => {
    const res = await POST(
      buildRequest({ file: new File([pdfBytes()], 'x.pdf', { type: 'application/pdf' }) }) as never,
      ctxFor(VALID_TOKEN),
    )
    expect(res.status).toBe(200)
    expect(storeTransferReceiptMock).toHaveBeenCalledWith(expect.objectContaining({ mime: 'application/pdf' }))
  })

  /**
   * LA aserción central de este archivo: un `Content-Type: image/jpeg`
   * declarado por el browser con bytes que NO son JPEG (ni PDF) tiene que
   * rebotar igual que un archivo sin declarar nada — el sniff manda siempre,
   * el header no se mira ni una vez.
   */
  it('Content-Type: image/jpeg declarado, pero los bytes NO son un JPEG real → 400, el header se ignora', async () => {
    const spoofed = new File([garbageBytes()], 'x.jpg', { type: 'image/jpeg' })
    const res = await POST(buildRequest({ file: spoofed }) as never, ctxFor(VALID_TOKEN))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/foto \(JPEG\) o un PDF/)
    expect(storeTransferReceiptMock).not.toHaveBeenCalled()
  })

  it('Content-Type: application/pdf declarado, pero los bytes son JPEG real → el sniff manda: se acepta como JPEG, no como PDF', async () => {
    const mislabeled = new File([jpegBytes()], 'x.pdf', { type: 'application/pdf' })
    const res = await POST(buildRequest({ file: mislabeled }) as never, ctxFor(VALID_TOKEN))

    expect(res.status).toBe(200)
    expect(storeTransferReceiptMock).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/jpeg' }))
  })

  it('bytes que no son ni JPEG ni PDF, sin importar el Content-Type declarado → 400', async () => {
    const res = await POST(
      buildRequest({ file: new File([garbageBytes()], 'x.bin', { type: 'application/octet-stream' }) }) as never,
      ctxFor(VALID_TOKEN),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/orders/[token]/comprobante — camino feliz y errores del modelo', () => {
  it('éxito: llama a storeTransferReceipt con el sha256 correcto y devuelve el pedido actualizado con Cache-Control: private, no-store', async () => {
    const bytes = jpegBytes()
    const res = await POST(
      buildRequest({ file: new File([bytes], 'x.jpg', { type: 'image/jpeg' }) }) as never,
      ctxFor(VALID_TOKEN),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const call = storeTransferReceiptMock.mock.calls[0][0] as { token: string; sha256: string; mime: string }
    expect(call.token).toBe(VALID_TOKEN)
    expect(call.mime).toBe('image/jpeg')
    expect(call.sha256).toMatch(/^[a-f0-9]{64}$/)

    const body = (await res.json()) as { order: unknown }
    expect(body.order).toBeDefined()
  })

  it('segunda subida al mismo pedido (storeTransferReceipt tira 409) → el route handler propaga 409, no 500', async () => {
    storeTransferReceiptMock.mockRejectedValue(
      new DomainError('Este pedido ya tiene un comprobante subido. Si necesitás corregirlo, escribinos por WhatsApp.', {
        status: 409,
      }),
    )

    const res = await POST(buildRequest({}) as never, ctxFor(VALID_TOKEN))
    expect(res.status).toBe(409)
  })

  it('token inexistente (storeTransferReceipt tira 404) → el route handler propaga 404', async () => {
    storeTransferReceiptMock.mockRejectedValue(new DomainError('No encontramos ese pedido', { status: 404 }))

    const res = await POST(buildRequest({}) as never, ctxFor(VALID_TOKEN))
    expect(res.status).toBe(404)
  })

  it('un fallo real (Storage/Postgres caído) devuelve un error genérico, nunca el mensaje crudo', async () => {
    storeTransferReceiptMock.mockRejectedValue(new Error('connection reset by peer'))

    const res = await POST(buildRequest({}) as never, ctxFor(VALID_TOKEN))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(body.error).not.toMatch(/connection reset/)
  })
})
