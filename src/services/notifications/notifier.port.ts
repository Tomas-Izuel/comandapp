import 'server-only'

/**
 * Contrato de notificaciones. Todavía no sabemos si el aviso de "pedido
 * listo" arranca manual (link `wa.me` que el mostrador toca) o automático
 * (Cloud API de Meta, sujeta a que aprueben las plantillas) — por eso dos
 * adapters detrás de la misma interfaz, elegidos por `WHATSAPP_PROVIDER`.
 */

export type NotificationTemplate = 'order_confirmed' | 'order_ready' | 'order_cancelled'

export type NotificationResult = {
  status: 'sent' | 'queued' | 'failed' | 'skipped'
  providerRef?: string
  /** Solo para el adapter `link`: el wa.me que el mostrador toca. */
  actionUrl?: string
  error?: string
}

export type NotificationVars = {
  customerName: string
  storeName: string
  shortCode: string
  trackingUrl: string
  etaMinutes?: number
  /**
   * Solo la lee `order_cancelled`. Si el pedido tenía un pago `approved`,
   * el monto (en centavos) y moneda que se le devuelven al cliente — así el
   * mensaje puede decir qué pasa con la plata en vez de dejarlo en el aire.
   * Ausente cuando no hubo cobro (pago en el local, o el pago online nunca
   * llegó a `approved`): ahí no hay nada que devolver y el mensaje no habla
   * de plata.
   */
  refund?: { amountCents: number; currency: string }
}

export interface Notifier {
  readonly kind: 'link' | 'cloud'
  notify(p: {
    /** Para correlacionar logs y para `countFailedNotifications` (ver `log.ts`). */
    storeId: number
    orderId: number
    toPhoneE164: string
    template: NotificationTemplate
    vars: NotificationVars
  }): Promise<NotificationResult>
}
