import 'server-only'

/**
 * Punto de extensión al software de gestión del local. Todavía no sabemos
 * qué usan, así que nada del core se acopla a uno: cada cambio de estado
 * inserta una fila en `order_events` (outbox) y esto la entrega.
 */

export type PosEvent = {
  id: number
  type: string
  orderId: number
  storeId: number
  payload: Record<string, unknown>
  /** Cuándo pasó el hecho de negocio (`order_events.created_at`), no cuándo se lo entregamos al POS. */
  createdAt: string
}

export interface PosAdapter {
  readonly kind: string
  /**
   * `deliveryId` identifica el DESTINO (este endpoint, para este evento), no
   * el evento en sí: una tienda puede tener dos endpoints suscriptos al mismo
   * `event`, y cada uno necesita su propio id estable para que el POS pueda
   * deduplicar reintentos sin confundirlos entre sí. Viene de
   * `order_event_deliveries.id` vía `claim_event_deliveries`.
   */
  deliver(
    endpoint: { id: number; url: string; secret: string },
    event: PosEvent,
    deliveryId: string,
  ): Promise<{ ok: boolean; externalRef?: string; error?: string }>
}
