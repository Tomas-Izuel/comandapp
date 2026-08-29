import { NextResponse } from 'next/server'
import { getOrderStatus } from '@/controllers/checkout.controller'
import { toApiError } from '@/lib/errors'
import { log } from '@/lib/log'

/**
 * `token` es la ÚNICA credencial del pedido: la URL entera es la contraseña.
 * Sin `Cache-Control` explícito, un proxy o el browser podrían guardar la
 * respuesta y servírsela a quien comparta o reutilice esa URL más tarde.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * Trunca la IP antes de loguearla: alcanza para ver de qué franja viene un
 * pico de 404 sin dejar un identificador de red completo en un log que Hobby
 * solo retiene una hora igual (00-architecture.md §5.7).
 */
function truncateIp(ip: string): string {
  if (ip.includes('.')) {
    const [a, b] = ip.split('.')
    return a && b ? `${a}.${b}.0.0` : 'unknown'
  }
  if (ip.includes(':')) {
    const [a, b] = ip.split(':')
    return a && b ? `${a}:${b}::` : 'unknown'
  }
  return 'unknown'
}

/**
 * Seguimiento público por token. Lo consulta tanto /pedido/[token] (polling
 * cada 5-60s) como "reiterar". SIN límite de aplicación, a propósito: es un
 * riesgo aceptado por escrito (00-architecture.md §5.7) — el espacio del
 * token (31^24) no es enumerable, y agregarle una query de rate limit a un
 * endpoint que el seguimiento poletea todo el tiempo sería peor que el
 * problema. El `log.warn` de acá es el disparador para revisar esa decisión
 * si empiezan a aparecer 404 masivos.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/orders/[token]'>) {
  const { token } = await ctx.params

  try {
    const order = await getOrderStatus(token)
    if (!order) {
      // Nunca el token acá: es la única credencial de acceso al pedido.
      log.warn('GET /api/orders/[token]', 'token inexistente', { ip: truncateIp(clientIp(request)) })
      return NextResponse.json({ error: 'No encontramos ese pedido' }, { status: 404, headers: NO_STORE_HEADERS })
    }
    return NextResponse.json({ order }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    const { body, status, headers } = toApiError(err, 'GET /api/orders/[token]')
    return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } })
  }
}
