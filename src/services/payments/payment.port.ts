import 'server-only'

import type { PaymentStatus } from '@/models/schemas/order.schema'

/**
 * Contrato de pagos. Hoy solo hay un adapter (Mercado Pago Checkout Pro),
 * pero nada del resto del sistema debería importar `mercadopago` directo:
 * todo pasa por esta interfaz para que cambiar de proveedor, o soportar dos
 * en simultáneo por tienda, no toque un controller.
 */

export type CheckoutSession = {
  preferenceId: string
  checkoutUrl: string
  /** Cuándo vence el link. Un pedido impago después de esto se cancela. */
  expiresAt: string | null
}

export type PaymentSnapshot = {
  providerPaymentId: string
  status: PaymentStatus
  /**
   * El estado tal cual lo dice el proveedor (`charged_back`, `in_process`, …).
   * `status` lo colapsa al vocabulario del dominio y eso pierde información que
   * el registro en `payments` sí tiene que guardar: un contracargo y un
   * reembolso no son lo mismo para el local aunque los dos saquen la plata.
   */
  providerStatus: string | null
  amountCents: number
  /** Reembolsado parcial o total. Mayor que cero significa que la plata volvió. */
  amountRefundedCents: number
  /** ISO 4217, para comparar contra `orders.currency`. */
  currency: string | null
  /**
   * `false` significa que el pago se hizo con credenciales de prueba. Una tienda
   * que carga un token `TEST-` en producción "cobra" con tarjetas de juguete.
   */
  liveMode: boolean | null
  /** El `public_token` del pedido, si el proveedor lo devuelve. */
  externalReference: string | null
  raw: unknown
}

export type RefundResult = {
  ok: boolean
  providerRefundId: string | null
  /** Motivo del fallo, para dejarlo en `payments`/`orders.refund_reason`. */
  error: string | null
}

export interface PaymentProvider {
  createCheckout(p: {
    storeId: number
    orderToken: string
    orderShortCode: string
    /** Nombre del local: es lo que el cliente reconoce en el resumen de la tarjeta. */
    storeName: string
    items: { name: string; quantity: number; unitPriceCents: number }[]
    payerName: string
    payerPhoneE164: string
    totalCents: number
    currency: string
    /**
     * Minutos hasta que el link deje de servir. Sin vencimiento, un pedido
     * impago vive para siempre: ocupa short_code, infla la facturación y puede
     * pagarse a las 3 de la mañana con el local cerrado.
     */
    expiresInMinutes: number
  }): Promise<CheckoutSession>

  /**
   * Recupera el link de una preferencia ya creada.
   *
   * Existe para que un reintento del checkout REUSE la preferencia en vez de
   * crear otra: cada preferencia nueva es un `init_point` distinto, y un cliente
   * con dos pestañas abiertas podía pagar dos veces el mismo pedido.
   *
   * Devuelve `null` si la preferencia ya no sirve (vencida o inexistente), y
   * entonces hay que generar una nueva.
   */
  getCheckoutSession(storeId: number, preferenceId: string): Promise<CheckoutSession | null>

  /**
   * Re-consulta el pago contra el proveedor. Nunca hay que confiar en el
   * body de un webhook como fuente de verdad: cualquiera puede pegarle un
   * POST a esa URL con un estado inventado.
   */
  fetchPayment(storeId: number, providerPaymentId: string): Promise<PaymentSnapshot>

  /**
   * Busca los pagos de un pedido por su referencia externa (el `public_token`).
   *
   * Es lo que hace posible la conciliación. `fetchPayment` exige un id de pago
   * que ya conocemos, y ese id llega por el webhook: si el webhook se perdió
   * —timeout, cold start, Postgres caído dos segundos— no hay ningún id que
   * consultar y el pedido queda `pending` para siempre con la plata ya cobrada.
   * Sin este método, la conciliación solo puede detectar el problema y avisar;
   * con él, lo arregla sola.
   *
   * Devuelve la lista vacía si el proveedor no conoce la referencia (lo normal
   * para un pedido que el cliente abandonó sin pagar).
   */
  findPaymentsByExternalReference(storeId: number, externalReference: string): Promise<PaymentSnapshot[]>

  /**
   * Devuelve la plata. Se llama cuando un pago sobrevive a su pedido: el cliente
   * pagó un pedido que la cocina ya había cancelado, o pagó dos veces.
   *
   * Nunca tira: un reembolso que falla se registra en `orders.needs_refund_at`
   * para que alguien lo haga a mano, porque perder el rastro de plata a devolver
   * es peor que un error en el log.
   */
  refundPayment(p: {
    storeId: number
    providerPaymentId: string
    amountCents?: number
  }): Promise<RefundResult>

  /**
   * Valida que un webhook realmente vino del proveedor antes de tocar la
   * base. Si la tienda no tiene secreto configurado, tiene que devolver
   * `false` — nunca `true` por defecto, porque eso equivale a aceptar
   * cualquier POST como si fuera un pago real.
   */
  verifyWebhookSignature(p: {
    storeId: number
    signatureHeader: string | null
    requestId: string | null
    dataId: string
  }): Promise<boolean>
}
