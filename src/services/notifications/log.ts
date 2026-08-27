import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/log'
import type { NotificationResult, NotificationTemplate } from './notifier.port'
import type { EmailTemplate } from './email/email.port'

/**
 * A-07: esta función vivía copiada tres veces (`whatsapp-link.adapter.ts`,
 * `whatsapp-cloud.adapter.ts`, `email/log.ts`) con la misma forma y variantes
 * menores. Un solo lugar, parametrizado por canal — la tabla `notifications`
 * ya distingue el canal en una columna, el código ahora también.
 */
export type NotificationChannel = 'whatsapp' | 'email'

/**
 * Unión cerrada de plantillas: tiene que calzar con el CHECK de
 * `notifications.template` en `20260826120000_hardening.sql`
 * (`order_confirmed`, `order_ready`, `order_cancelled`, `order_receipt`).
 * Se arma sumando las plantillas de cada puerto de canal en vez de
 * redeclararse acá: si un canal agrega una plantilla que el otro no tiene,
 * el CHECK de Postgres es quien decide si existe de verdad.
 */
export type NotificationTemplateName = NotificationTemplate | EmailTemplate

/**
 * Registro auditable de que se INTENTÓ avisar, no de que se logró: si la
 * escritura en Postgres falla, se traga acá adentro y solo queda rastro en
 * el log estructurado. Un pedido ya pago no se puede romper porque la tabla
 * de auditoría de notificaciones tuvo un mal momento — mismo principio que
 * "sin RESEND_API_KEY el adapter devuelve skipped y nunca tira".
 */
export async function logNotification(p: {
  channel: NotificationChannel
  storeId: number
  orderId: number
  toAddress: string
  template: NotificationTemplateName
  result: NotificationResult
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('notifications').insert({
      order_id: p.orderId,
      channel: p.channel,
      to_address: p.toAddress,
      template: p.template,
      status: p.result.status,
      provider_ref: p.result.providerRef ?? null,
      error: p.result.error ?? null,
    })
    if (error) {
      log.error('notifications.log', 'no se pudo registrar el intento de notificación', error, {
        storeId: p.storeId,
        orderId: p.orderId,
        channel: p.channel,
        template: p.template,
      })
    }
  } catch (err) {
    log.error('notifications.log', 'no se pudo registrar el intento de notificación', err, {
      storeId: p.storeId,
      orderId: p.orderId,
      channel: p.channel,
      template: p.template,
    })
  }
}

/**
 * A-14: hasta ahora un envío fallido quedaba como `notifications.status =
 * 'failed'` y ninguna pantalla lo mostraba. Esta es la consulta que el
 * dashboard del local puede usar para mostrar "N notificaciones fallidas en
 * las últimas 24hs" — la vista en sí es de otro agente, esto es el dato.
 *
 * `notifications` no tiene columna `store_id` propia (el pedido sí, vía
 * `order_id`), así que el filtro por tienda es un join contra `orders`.
 * Usa `createAdminClient()` porque ese join no es trivial de expresar
 * respetando RLS con `count: 'exact', head: true`; el `storeId` NO viene del
 * browser sin validar, así que quien llame a esto tiene que haber verificado
 * ya el permiso sobre esa tienda (`requireStoreMembership` o el chequeo de
 * plataforma) — esta función cuenta, no autoriza.
 *
 * Nunca tira: un fallo acá no puede romper el dashboard por un problema en
 * la señal de fallos. Devuelve 0 y deja el detalle en el log — un 0 falso
 * es preferible a un dashboard caído, y la falla real igual queda buscable.
 */
export async function countFailedNotifications(storeId: number, sinceHours = 24): Promise<number> {
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString()
    const { count, error } = await admin
      .from('notifications')
      .select('id, orders!inner(store_id)', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', since)
      .eq('orders.store_id', storeId)

    if (error) {
      log.error('notifications.countFailed', 'no se pudo contar notificaciones fallidas', error, { storeId })
      return 0
    }
    return count ?? 0
  } catch (err) {
    log.error('notifications.countFailed', 'no se pudo contar notificaciones fallidas', err, { storeId })
    return 0
  }
}
