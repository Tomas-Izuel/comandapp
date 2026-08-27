import { NextResponse, type NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env.server'
import { log } from '@/lib/log'
import { toApiError } from '@/lib/errors'
import { timingSafeEqualString } from '@/services/crypto/hmac'
import { dispatchPendingEvents } from '@/services/pos/webhook.adapter'

/**
 * Despacha el outbox de `order_events` a los POS de cada tienda. Protegido
 * con `CRON_SECRET` en el header `Authorization: Bearer <secret>` — nada más
 * lo puede llamar, ni siquiera un staff logueado. Un secreto incorrecto
 * devuelve 401 sin detalle: ni confirma ni niega que el header tenía la forma
 * correcta. La comparación es en tiempo constante: un `!==` filtra, por
 * cuánto tarda en responder, en qué byte empezó a diferir el header recibido.
 *
 * Vercel Cron invoca con GET, no con POST — `vercel.json` declara este cron
 * cada 2 minutos y sin exportar `GET` nunca se ejecutaba. Se deja `POST`
 * también para poder dispararlo a mano.
 */
export async function GET(request: NextRequest) {
  return dispatch(request)
}

export async function POST(request: NextRequest) {
  return dispatch(request)
}

async function dispatch(request: NextRequest) {
  const { CRON_SECRET } = serverEnv()
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${CRON_SECRET}`

  if (!authHeader || !timingSafeEqualString(authHeader, expected)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const result = await dispatchPendingEvents()
    return NextResponse.json(result)
  } catch (err) {
    log.error('cron.outbox', 'Falló el despacho del outbox', err)
    const { body, status } = toApiError(err, 'cron.outbox')
    return NextResponse.json(body, { status })
  }
}
