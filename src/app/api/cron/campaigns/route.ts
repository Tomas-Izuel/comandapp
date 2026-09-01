import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/lib/env.server'
import { toApiError } from '@/lib/errors'
import { log } from '@/lib/log'
import { drainCampaignQueue } from '@/services/notifications/email/campaign'

/**
 * Drenaje de campañas de cupón (§5.10.3 del plan de cupones y campañas).
 *
 * Disparado por **pg_cron**, no por Vercel Cron ni `vercel.json`: en Hobby,
 * un cron más frecuente que diario hace fallar el DEPLOY entero (ver
 * `CLAUDE.md`, sección de Crons). La migración `20260901130000_cupones.sql`
 * ya agenda `app-campaigns` cada 5 minutos contra este endpoint.
 *
 * Mismo esquema de auth que `/api/cron/reconcile` y `/api/cron/auto-advance`:
 * `CRON_SECRET` se compara en tiempo constante — un `!==` filtra, por cuánto
 * tarda en responder, en qué byte empezó a diferir el secreto recibido del
 * esperado.
 *
 * Un tick reclama COMO MUCHO un chunk (el cupo diario completo, ≤15 — nunca
 * más de un chunk por tick a propósito, para que dos ticks solapados nunca
 * compitan por el mismo trabajo más que en el `for update skip locked` de la
 * RPC). Toda la decisión de A QUIÉN, CUÁNTO y SI CORTAR vive en
 * `claim_campaign_recipients`; acá solo se dispara, se manda por Resend y se
 * cierra la fila.
 */
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
    const result = await drainCampaignQueue()
    return NextResponse.json(result)
  } catch (err) {
    log.error('cron.campaigns', 'Falló el drenaje de campañas', err)
    const { body, status } = toApiError(err, 'cron.campaigns')
    return NextResponse.json(body, { status })
  }
}
