import { NextResponse } from 'next/server'
import { getOrderStatus } from '@/controllers/checkout.controller'
import { toApiError } from '@/lib/errors'

/**
 * `token` es la ÚNICA credencial del pedido: la URL entera es la contraseña.
 * Sin `Cache-Control` explícito, un proxy o el browser podrían guardar la
 * respuesta y servírsela a quien comparta o reutilice esa URL más tarde.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

/** Seguimiento público por token. Lo consulta tanto /pedido/[token] (polling cada 5s) como "reiterar". */
export async function GET(_request: Request, ctx: RouteContext<'/api/orders/[token]'>) {
  const { token } = await ctx.params

  try {
    const order = await getOrderStatus(token)
    if (!order) {
      return NextResponse.json({ error: 'No encontramos ese pedido' }, { status: 404, headers: NO_STORE_HEADERS })
    }
    return NextResponse.json({ order }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    const { body, status } = toApiError(err, 'GET /api/orders/[token]')
    return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
  }
}
