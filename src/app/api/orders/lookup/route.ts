import { NextResponse } from 'next/server'
import { orderLookupSchema } from '@/models/schemas/order.schema'
import { lookupOrders } from '@/controllers/checkout.controller'
import { RateLimitError, toApiError, zodToApiError } from '@/lib/errors'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * "Mis pedidos": el browser manda los tokens que guardó en localStorage, en
 * batch (hasta 50 por request). Es la única excepción del plan a "sin límite
 * de aplicación en lecturas": una query de rate limit que evita hasta 50
 * lookups de más por request es una ganancia neta, y en Hobby no hay una
 * regla de WAF libre para cubrir esto (una sola regla de rate limit por
 * proyecto, ya gastada en imágenes — 00-architecture.md §5.1/§5.3).
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Formato inválido' }, { status: 400 })
  }

  const parsed = orderLookupSchema.safeParse(body)
  if (!parsed.success) {
    const { body: errorBody, status } = zodToApiError(parsed.error)
    return NextResponse.json(errorBody, { status })
  }

  try {
    const policy = RATE_LIMIT_POLICY['lookup:ip']
    const decision = await consumeRateLimit({
      bucket: 'lookup:ip',
      subject: clientIp(request),
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    })
    if (!decision.allowed) {
      throw new RateLimitError(
        'Estás consultando tus pedidos muy seguido. Esperá un momento y volvé a intentar.',
        decision.retryAfterSeconds,
      )
    }

    const orders = await lookupOrders(parsed.data.tokens)
    return NextResponse.json({ orders })
  } catch (err) {
    const { body: errorBody, status, headers } = toApiError(err, 'POST /api/orders/lookup')
    return NextResponse.json(errorBody, { status, headers })
  }
}
