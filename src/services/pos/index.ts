import 'server-only'

import { webhookAdapter } from './webhook.adapter'
import type { PosAdapter } from './pos.port'

/**
 * Único adapter hoy: POST firmado genérico. Cuando aparezca un POS con API
 * propia, se agrega su adapter acá y se elige por config de la tienda —
 * el core (outbox, cron) no se toca.
 */
export function getPosAdapter(): PosAdapter {
  return webhookAdapter
}

export { dispatchPendingEvents } from './webhook.adapter'
export type { PosAdapter, PosEvent } from './pos.port'
