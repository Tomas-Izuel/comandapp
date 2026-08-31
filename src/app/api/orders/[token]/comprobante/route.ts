import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getOrderStatus } from '@/controllers/checkout.controller'
import { RateLimitError, toApiError } from '@/lib/errors'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { storeTransferReceipt } from '@/models/order.model'
import { MAX_RECEIPT_BYTES, orderTokenSchema, receiptUploadSchema } from '@/models/schemas/order.schema'

/**
 * Sube el comprobante de un pedido por transferencia. Quien manda esto NO
 * está logueado: la URL entera —el `token`— es la única credencial, igual que
 * en `/api/orders/[token]`. **Nunca se loguea el token.**
 *
 * Un solo `POST multipart/form-data`, campo `file`. La opción alternativa
 * (signed upload URL, browser → Storage directo) queda descartada a
 * propósito (00-architecture.md §5.7): con esa opción el servidor nunca ve
 * los bytes, así que ni el MIME real ni el SHA-256 se pueden verificar acá —
 * y el pedido explícito del dueño es "MIME y tamaño validados en el
 * servidor, no confíes en el `Content-Type` que manda el browser".
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * Los dos primeros bytes/prefijo REALES del archivo, nunca el `Content-Type`
 * que manda el browser. `%PDF-` y `FF D8 FF` son las únicas dos firmas que
 * importan: el bucket (`allowed_mime_types`) ya angosta a JPEG/PDF, así que
 * cualquier otra cosa es 400 antes de gastar una llamada a Storage.
 */
function sniffMime(bytes: Buffer): 'image/jpeg' | 'application/pdf' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  return null
}

/**
 * Los dos baldes de este endpoint, en orden. Los dos FAIL-OPEN (default de
 * `consumeRateLimit`): protegen storage, no plata — si Postgres no responde,
 * negar la subida no protege nada y el pedido ya está roto igual
 * (00-architecture.md §5.7).
 *
 * `receipt:order` es la ventana anti-abuso que pidió el dueño (1 intento cada
 * 8 h), NO lo que garantiza "un comprobante por pedido": eso lo sostienen el
 * trigger de Postgres y el CAS de `storeTransferReceipt`. El *subject* es el
 * TOKEN crudo — `consumeRateLimit` lo firma con HMAC antes de tocar la tabla,
 * nunca llega en claro a `rate_limits`.
 */
async function enforceReceiptRateLimits(token: string, ip: string): Promise<void> {
  const ipPolicy = RATE_LIMIT_POLICY['receipt:ip']
  const ipDecision = await consumeRateLimit({
    bucket: 'receipt:ip',
    subject: ip,
    limit: ipPolicy.limit,
    windowSeconds: ipPolicy.windowSeconds,
  })
  if (!ipDecision.allowed) {
    throw new RateLimitError('Estás probando subir comprobantes muy seguido. Esperá un rato y volvé a intentar.', ipDecision.retryAfterSeconds)
  }

  const orderPolicy = RATE_LIMIT_POLICY['receipt:order']
  const orderDecision = await consumeRateLimit({
    bucket: 'receipt:order',
    subject: token,
    limit: orderPolicy.limit,
    windowSeconds: orderPolicy.windowSeconds,
  })
  if (!orderDecision.allowed) {
    throw new RateLimitError(
      'Ya se registró un intento de subida para este pedido. Si necesitás corregirlo, escribinos por WhatsApp.',
      orderDecision.retryAfterSeconds,
    )
  }
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/orders/[token]/comprobante'>) {
  const { token } = await ctx.params

  const parsedToken = orderTokenSchema.safeParse(token)
  if (!parsedToken.success) {
    // Nunca el token en el log: es la única credencial del pedido.
    return NextResponse.json({ error: 'No encontramos ese pedido' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  try {
    await enforceReceiptRateLimits(parsedToken.data, clientIp(request))

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: 'El comprobante llegó con un formato inválido' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo del comprobante' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    // Antes de leer los bytes: un archivo de más de 4 MB no vale la pena
    // bajarlo a memoria para después rechazarlo. El `size` de un `File` de
    // `FormData` es el tamaño real del blob, no algo que el cliente declare.
    if (file.size > MAX_RECEIPT_BYTES) {
      return NextResponse.json(
        { error: 'El comprobante pesa más de 4 MB. Probá con una foto o un PDF más liviano.' },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())

    // El `Content-Type` que mandó el browser se IGNORA por completo: se
    // sniffea la firma real de los bytes. Es exactamente lo que pidió el
    // dueño del producto y lo que un signed upload URL no permite verificar.
    const mime = sniffMime(bytes)
    if (!mime) {
      return NextResponse.json(
        { error: 'El archivo tiene que ser una foto (JPEG) o un PDF del comprobante' },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }

    const parsedUpload = receiptUploadSchema.safeParse({ mime, sizeBytes: bytes.length })
    if (!parsedUpload.success) {
      return NextResponse.json({ error: 'El comprobante no es válido' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex')

    await storeTransferReceipt({ token: parsedToken.data, bytes, mime, sha256 })

    // Se releen los datos ya persistidos (`getOrderStatus`, memoizado por
    // request) en vez de armar la respuesta a mano: es la misma vista que
    // `/pedido/[token]` ya pinta, así que el browser no tiene que reconciliar
    // dos formas distintas del mismo pedido.
    const order = await getOrderStatus(parsedToken.data)
    return NextResponse.json({ order }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    const { body, status, headers } = toApiError(err, 'POST /api/orders/[token]/comprobante')
    return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } })
  }
}
