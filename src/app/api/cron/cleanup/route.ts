import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/lib/env.server'
import { toApiError } from '@/lib/errors'
import { log } from '@/lib/log'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearReceiptRefs, listPurgeableReceipts, purgeReceiptObjects } from '@/models/order.model'

/**
 * Retención (A-11): purga `order_events` ya entregados y `platform_audit_log`
 * viejo vía `cleanup_old_records`. Corre una vez al día (`vercel.json`);
 * Vercel Cron invoca con GET. Mismo esquema de auth que `/api/cron/reconcile`
 * — comparación de `CRON_SECRET` en tiempo constante.
 *
 * Suma también la purga de comprobantes de transferencia (00-architecture.md
 * §5.8), y NO por dentro de `cleanup_old_records`: esa RPC borra FILAS con
 * SQL, y borrar una fila de `storage.objects` no borra el archivo del backend
 * de objetos. La única forma correcta es la API de Storage, que es
 * TypeScript — por eso este paso vive acá y no en la migración.
 */

const EVENT_RETENTION_DAYS = 30
const AUDIT_RETENTION_DAYS = 365

/** D5, decidido 2026-08-31: 24 h después de `paid_at`, no 48 y no al instante. */
const RECEIPT_PAID_RETENTION_HOURS = 24
/** Casos sin confirmar (cancelado, o `pending` eterno con comprobante): 7 días desde que se subió. */
const RECEIPT_STALE_RETENTION_DAYS = 7

/**
 * Orden estricto, y va comentado porque invertirlo es el bug: nulear la fila
 * ANTES de borrar el objeto deja el archivo huérfano en Storage para siempre
 * (nada vuelve a apuntarlo, así que ningún barrido futuro lo encuentra). Se
 * borra primero, y solo se nuclea la referencia de los que el borrado
 * confirmó — si `purgeReceiptObjects` no pudo con alguno, su fila sigue
 * apuntando y el próximo tick reintenta.
 */
async function purgeTransferReceipts(): Promise<number> {
  const purgeable = await listPurgeableReceipts({
    paidHours: RECEIPT_PAID_RETENTION_HOURS,
    staleDays: RECEIPT_STALE_RETENTION_DAYS,
  })
  if (purgeable.length === 0) return 0

  const purgedPaths = await purgeReceiptObjects(purgeable.map((r) => r.path))
  if (purgedPaths.length === 0) return 0

  const purgedPathSet = new Set(purgedPaths)
  const purgedOrderIds = purgeable.filter((r) => purgedPathSet.has(r.path)).map((r) => r.orderId)

  await clearReceiptRefs(purgedOrderIds)
  return purgedOrderIds.length
}

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

    // Un fallo acá no puede tumbar la limpieza de arriba, que ya corrió: se
    // loguea y el conteo queda en 0, el próximo tick reintenta solo.
    let receiptsPurged = 0
    try {
      receiptsPurged = await purgeTransferReceipts()
    } catch (err) {
      log.error('cron.cleanup', 'no se pudieron purgar comprobantes de transferencia', err)
    }

    const summary = (data ?? {}) as Record<string, unknown>
    return NextResponse.json({ ...summary, receiptsPurged })
  } catch (err) {
    const { body, status } = toApiError(err, 'cron.cleanup')
    return NextResponse.json(body, { status })
  }
}
