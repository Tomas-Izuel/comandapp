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
  /**
   * Presente solo en un pedido PROGRAMADO: la hora pactada, ya formateada en
   * la zona del local ("30/08, 21:30"). Cuando está, la plantilla la muestra
   * en vez de "Listo en ~X min" — la promesa ES el ETA, no hay minutos que
   * contar.
   */
  scheduledForLabel?: string
  /**
   * Los tres medios de cobro, no dos. Ninguna plantilla ramifica por esto hoy
   * (`paymentPending` es lo que decide si el mail puede parecer un recibo),
   * pero el tipo tiene que decir la verdad: mapear `transfer` a `'online'`
   * para que compile guarda un dato falso, y la primera plantilla que lea el
   * campo lo va a creer.
   */
  paymentMethod: 'online' | 'in_store' | 'transfer'
  /** true = "pagás al retirar": el mail NO puede parecer un recibo de algo ya cobrado. */
  paymentPending: boolean
  currency: string
  items: { name: string; quantity: number; totalCents: number; options?: string[] }[]
  subtotalCents: number
  totalCents: number
  /**
   * Solo presentes en un pedido con cupón aplicado, y solo `order_receipt` los
   * usa (`order_ready` no lleva importes). Opcionales porque la mayoría de los
   * pedidos no tiene cupón — la plantilla decide mostrar la línea con
   * `discountCents > 0`, nunca con la sola presencia del campo (CPN, §5.14.4).
   */
  discountCents?: number
  couponCode?: string
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
