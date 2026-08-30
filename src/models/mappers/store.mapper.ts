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
    onlinePaymentEnabled: row.online_payment_enabled,
    minOrderCents: row.min_order_cents,
    demandThresholdOrders: row.demand_threshold_orders,
    // numeric(4,2) llega como string por el driver: sin Number() el
    // multiplicador de demanda se concatena en vez de multiplicar.
    demandMultiplier: Number(row.demand_multiplier),
    autoStartOrders: row.auto_start_orders,
    autoReadyOrders: row.auto_ready_orders,
    // numeric llega como string por el driver, igual que `demand_multiplier`.
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    links: {
      instagramHandle: row.instagram_handle,
      mapsUrl: row.maps_url,
      rappiUrl: row.rappi_url,
      pedidosYaUrl: row.pedidos_ya_url,
      uberEatsUrl: row.uber_eats_url,
    },
    // Todo entero: acá no hay ningún Number() porque ninguna de estas columnas
    // es `numeric`. Fue deliberado al diseñar el schema, justamente para no
    // repetir la trampa que `demand_multiplier` documenta dos veces arriba.
    delivery: {
      enabled: row.delivery_enabled,
      feeCents: row.delivery_fee_cents,
      freeFromCents: row.delivery_free_from_cents,
      minOrderCents: row.delivery_min_order_cents,
      minutes: row.delivery_minutes,
      busyMinutes: row.delivery_busy_minutes,
      courierCollects: row.courier_collects_payment,
    },
    scheduling: {
      deliveryEnabled: row.scheduled_delivery_enabled,
      capacityPerNight: row.scheduled_capacity_per_night,
    },
  }
}
