import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { EmailTemplate } from './email.port'

/**
 * Idempotencia: el webhook de Mercado Pago reintenta, y nadie quiere tres
 * comprobantes del mismo pedido. Si ya hay una fila `sent` para este pedido +
 * plantilla, no se reenvía.
 *
 * La clave es `orderId + template`, y sigue teniendo sentido con el cambio
 * de S-04: antes el contenido del mail (`EmailVars`) lo armaba el browser, así
 * que "el primer envío gana" corría el riesgo de ganar con datos falsos. Con
 * la construcción de esas variables movida al servidor (a partir del pedido
 * ya persistido, no de lo que mande el cliente), el primer envío gana con
 * DATOS REALES siempre — el riesgo que motivaba desconfiar de esta clave ya
 * no aplica. Sigue sin incluir `template` != el mismo evento dos veces con
 * contenido distinto no es un caso real: un pedido tiene un solo total, un
 * solo código, una sola tienda.
 *
 * Si la consulta en sí falla, se prefiere arriesgar un mail duplicado antes
 * que no notificar nunca: un `false` acá no bloquea el resto del pipeline
 * porque Postgres tuvo un mal momento.
 */
export async function wasAlreadySent(orderId: number, template: EmailTemplate): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('notifications')
      .select('id')
      .eq('order_id', orderId)
      .eq('channel', 'email')
      .eq('template', template)
      .eq('status', 'sent')
      .limit(1)
      .maybeSingle()
    return data != null
  } catch {
    return false
  }
}
