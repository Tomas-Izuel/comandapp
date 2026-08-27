import type { Store } from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

/**
 * snake_case (Postgres) → camelCase (dominio), en un solo lugar.
 *
 * Este mapper estaba copiado idéntico en `store.model.ts`, `platform.model.ts` y
 * `order.model.ts`. Agregar una columna a `stores` significaba acordarse de tres
 * archivos, y el que se olvidara devolvía un `Store` incompleto sin que
 * TypeScript dijera nada (los tres construían el objeto a mano).
 *
 * Solo tipos y transformación pura: no importa clientes de Supabase, así que lo
 * puede usar cualquier capa.
 */

export type StoreRow = Database['public']['Tables']['stores']['Row']

export function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    phoneE164: row.phone_e164,
    whatsappPhoneE164: row.whatsapp_phone_e164,
    address: row.address,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status as Store['status'],
    acceptingOrders: row.accepting_orders,
    inStorePaymentEnabled: row.in_store_payment_enabled,
    minOrderCents: row.min_order_cents,
    demandThresholdOrders: row.demand_threshold_orders,
    // numeric(4,2) llega como string por el driver: sin Number() el
    // multiplicador de demanda se concatena en vez de multiplicar.
    demandMultiplier: Number(row.demand_multiplier),
  }
}
