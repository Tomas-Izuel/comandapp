import 'server-only'

import type { NotificationResult } from '../notifier.port'

/**
 * Contrato del canal de email. Es adicional y opcional al de WhatsApp
 * (`notifier.port.ts`): `orders.customer_email` es nullable, así que este
 * servicio solo se invoca cuando el cliente dejó un mail en el checkout.
 *
 * Dos plantillas nada más — no hay lugar para "order_cancelled" acá porque
 * un pedido cancelado no genera comprobante ni "listo para retirar".
 */
export type EmailTemplate = 'order_receipt' | 'order_ready'

export type EmailVars = {
  customerName: string
  storeName: string
  storeSlug: string
  /** Dirección del LOCAL: todo pedido es retiro, así que el mail tiene que decir claramente adónde ir a buscarlo. */
  storeAddress: string | null
  shortCode: string
  trackingUrl: string
  etaMinutes?: number | null
  paymentMethod: 'online' | 'in_store'
  /** true = "pagás al retirar": el mail NO puede parecer un recibo de algo ya cobrado. */
  paymentPending: boolean
  currency: string
  items: { name: string; quantity: number; totalCents: number; options?: string[] }[]
  subtotalCents: number
  totalCents: number
}

export interface EmailSender {
  readonly kind: 'resend' | 'noop'
  send(p: {
    /** Para correlacionar logs y para `countFailedNotifications` (ver `services/notifications/log.ts`). */
    storeId: number
    orderId: number
    to: string
    template: EmailTemplate
    vars: EmailVars
  }): Promise<NotificationResult>
}
