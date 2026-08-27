import { NextResponse } from 'next/server'
import { orderLookupSchema } from '@/models/schemas/order.schema'
import { lookupOrders } from '@/controllers/checkout.controller'
import { toApiError, zodToApiError } from '@/lib/errors'

/** "Mis pedidos": el browser manda los tokens que guardó en localStorage, en batch. */
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
    const orders = await lookupOrders(parsed.data.tokens)
    return NextResponse.json({ orders })
  } catch (err) {
    const { body: errorBody, status } = toApiError(err, 'POST /api/orders/lookup')
    return NextResponse.json(errorBody, { status })
  }
}
