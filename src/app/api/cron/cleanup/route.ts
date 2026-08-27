import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/lib/env.server'
import { toApiError } from '@/lib/errors'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Retención (A-11): purga `order_events` ya entregados y `platform_audit_log`
 * viejo vía `cleanup_old_records`. Corre una vez al día (`vercel.json`);
 * Vercel Cron invoca con GET. Mismo esquema de auth que `/api/cron/reconcile`
 * — comparación de `CRON_SECRET` en tiempo constante.
 */

const EVENT_RETENTION_DAYS = 30
const AUDIT_RETENTION_DAYS = 365

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
    const { data, error } = await admin.rpc('cleanup_old_records', {
      p_event_days: EVENT_RETENTION_DAYS,
      p_audit_days: AUDIT_RETENTION_DAYS,
    })
    if (error) throw new Error(`No se pudo limpiar registros viejos: ${error.message}`)

    return NextResponse.json(data ?? {})
  } catch (err) {
    const { body, status } = toApiError(err, 'cron.cleanup')
    return NextResponse.json(body, { status })
  }
}
