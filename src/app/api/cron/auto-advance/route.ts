import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { serverEnv } from '@/lib/env.server'
import { toApiError } from '@/lib/errors'
import { log } from '@/lib/log'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchReadyNotification } from '@/controllers/kitchen.controller'

/**
 * Automatización de estados de cocina, opt-in por tienda.
 *
 * Vercel Cron invoca con GET (`vercel.json`, cada 2 min); `CRON_SECRET` se
 * compara en tiempo constante — un `!==` filtra, por cuánto tarda en
 * responder, en qué byte empezó a diferir el secreto recibido del esperado.
 *
 * Toda la decisión de QUÉ mover vive en `public.advance_auto_orders()`: qué
 * tiendas optaron, qué transiciones son legales y en qué orden se aplican. Acá
 * solo se dispara y se avisa. El aviso al cliente es lo único que Postgres no
 * puede hacer.
 */

/** Los IDs que la RPC marcó listos. El resto del jsonb no lo consume nadie acá. */
const sweepResultSchema = z.object({
  started: z.number().int().nonnegative(),
  readied: z.array(z.coerce.number().int().positive()),
})

function isAuthorized(request: NextRequest): boolean {
  const { CRON_SECRET } = serverEnv()
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`)
  const received = Buffer.from(request.headers.get('authorization') ?? '')
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('advance_auto_orders')
    if (error) throw new Error(`No se pudo avanzar los pedidos automáticos: ${error.message}`)

    const sweep = sweepResultSchema.parse(data)
    const summary = { started: sweep.started, readied: sweep.readied.length, notified: 0, failed: 0 }

    // El estado ya está persistido y el evento de outbox para el POS ya salió
    // por trigger. Lo que falta es el aviso al cliente, y una falla acá NO
    // puede deshacer nada: el pedido está listo igual. Por eso cada uno va en
    // su propio try — un WhatsApp que rebota no puede dejar sin avisar a los
    // otros catorce de un viernes a la noche.
    for (const orderId of sweep.readied) {
      try {
        await dispatchReadyNotification(orderId)
        summary.notified += 1
      } catch (err) {
        summary.failed += 1
        log.error('cron.autoAdvance', 'no se pudo avisar que el pedido está listo', err, { orderId })
      }
    }

    return NextResponse.json(summary)
  } catch (err) {
    const { body, status } = toApiError(err, 'cron.autoAdvance')
    return NextResponse.json(body, { status })
  }
}
