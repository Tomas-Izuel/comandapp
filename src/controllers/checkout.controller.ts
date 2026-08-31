import 'server-only'

import { cache } from 'react'
import { after } from 'next/server'
import { storeUrl } from '@/lib/urls'
import { buildDeliveryQuote } from '@/lib/delivery'
import { formatDateTime, zonedDay } from '@/lib/dates'
import { SCHEDULE_HORIZON_DAYS } from '@/lib/store-hours'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { getCourierAvailability } from '@/models/courier.model'
import { getStoreBySlug } from '@/models/store.model'
import {
  attachPreference,
  countScheduledByNight,
  createOrder,
  estimateEta,
  flagRefundNeeded,
  getOrderByToken,
  getOrderIdByToken,
  getOrderWithStoreById,
  getOrdersByTokens,
  markOrderPaid,
  markRefunded,
  priceCart,
  recordPaymentStatusChange,
  type MarkPaidOutcome,
} from '@/models/order.model'
import { isTerminalStatus, type PaymentRecordStatus } from '@/models/schemas/order.schema'
import { getPaymentProvider } from '@/services/payments'
import type { CheckoutSession, PaymentSnapshot } from '@/services/payments/payment.port'
import { getNotifier } from '@/services/notifications'
import { getEmailSender } from '@/services/notifications/email'
import type { CartItem, CreateOrderInput } from '@/models/schemas/order.schema'
import type { DeliveryQuote, EtaEstimate, Order, OrderPublicView, PricedCart, Store } from '@/models/types'
import type { EmailVars } from '@/services/notifications/email/email.port'

/**
 * Casos de uso del checkout: cotizar el carrito, crear el pedido (+
 * preferencia de Mercado Pago si corresponde), seguimiento por token, y la
 * confirmación de pago que dispara el webhook (y el cron de conciliación,
 * que usa exactamente el mismo despacho).
 *
 * El cliente nunca está logueado, así que todo acá termina llamando a las
 * funciones "admin" de `order.model.ts` — no hay sesión que las RLS puedan
 * usar para filtrar.
 */

const CHECKOUT_EXPIRES_MINUTES = 30

const isProduction = process.env.NODE_ENV === 'production'

/**
 * `fullNights` viaja SOLO cuando la tienda tiene tope configurado
 * (`scheduling.capacityPerNight`). Es una foto aproximada para que el
 * selector de turnos del browser no ofrezca una noche que ya sabe que va a
 * rebotar — el árbitro real es `create_order`, en la misma transacción que
 * cuenta y reserva el lugar (00-architecture.md §7.3.1). Puede quedar vieja
 * entre que se pintó y se confirmó: el rebote transaccional es el camino
 * normal, no un caso raro.
 */
export type PriceQuote = { store: Store; priced: PricedCart; eta: EtaEstimate; delivery: DeliveryQuote; fullNights: string[] }

// ---------------------------------------------------------------------------
// Notificaciones — nunca cambian el resultado de la operación que las dispara.
// Un mail o un WhatsApp que fallan no revierten un pago ni un pedido ya creado.
// ---------------------------------------------------------------------------


/**
 * Arma las variables del mail de comprobante a partir del pedido ya
 * persistido. `paymentPending` es `true` solo para pago al retirar (el
 * pedido nace confirmado, sin webhook que avise cuándo se cobra de verdad).
 *
 * Todo pedido es retiro en el local: el comprobante lleva `storeAddress`
 * (dirección del LOCAL, no del cliente) para que sepa adónde ir a buscarlo.
 */
function toReceiptEmailVars(
  order: Order,
  store: Pick<Store, 'name' | 'slug' | 'address' | 'timezone'>,
  paymentPending: boolean,
): EmailVars {
  return {
    customerName: order.customerName,
    storeName: store.name,
    storeSlug: store.slug,
    storeAddress: store.address,
    shortCode: order.shortCode,
    // El seguimiento vive en el SUBDOMINIO de la tienda del pedido: es donde
    // vive el carrito que `clearResolvedOrderCart` tiene que vaciar al volver
    // de pagar (00-architecture.md §2.2).
    trackingUrl: storeUrl(store.slug, `/pedido/${order.publicToken}`),
    etaMinutes: order.etaMinutes ?? undefined,
    // Formateado en la zona del LOCAL: la promesa se hizo en esa hora de pared.
    scheduledForLabel: order.scheduledFor ? formatDateTime(order.scheduledFor, store.timezone) : undefined,
    paymentMethod: order.paymentMethod,
    paymentPending,
    currency: order.currency,
    items: order.items.map((item) => ({
      name: item.nameSnapshot,
      quantity: item.quantity,
      totalCents: item.totalCents,
      options: item.options.length > 0 ? item.options.map((option) => option.nameSnapshot) : undefined,
    })),
    subtotalCents: order.subtotalCents,
    totalCents: order.totalCents,
  }
}

/**
 * Exportada (no solo usada acá adentro) porque `confirmTransferPayment`
 * (`kitchen.controller.ts`) manda el MISMO comprobante cuando el staff
 * confirma una transferencia — el pedido recién se confirma ahí, no al
 * crearse. Mismo criterio que `dispatchPaymentSnapshot`: un solo lugar manda
 * cada mensaje, para que dos copias no se desincronicen con el tiempo.
 */
export async function sendReceiptEmail(
  order: Order,
  store: Pick<Store, 'name' | 'slug' | 'address' | 'timezone'>,
  paymentPending: boolean,
): Promise<void> {
  if (!order.customerEmail) return
  try {
    await getEmailSender().send({
      storeId: order.storeId,
      orderId: order.id,
      to: order.customerEmail,
      template: 'order_receipt',
      vars: toReceiptEmailVars(order, store, paymentPending),
    })
  } catch (err) {
    log.error('checkout.email', 'no se pudo mandar el comprobante por mail', err, { orderId: order.id })
  }
}

/**
 * Confirmación por WhatsApp. Sin esto el cliente no recibía ningún aviso
 * fuera de la página de seguimiento: la plantilla `order_confirmed` existía
 * en el port desde el día uno y nadie la disparaba (P-18).
 */
export async function sendConfirmedWhatsapp(order: Order, store: Pick<Store, 'name' | 'slug' | 'timezone'>): Promise<void> {
  try {
    await getNotifier().notify({
      storeId: order.storeId,
      orderId: order.id,
      toPhoneE164: order.customerPhoneE164,
      template: 'order_confirmed',
      vars: {
        customerName: order.customerName,
        storeName: store.name,
        shortCode: order.shortCode,
        trackingUrl: storeUrl(store.slug, `/pedido/${order.publicToken}`),
        etaMinutes: order.etaMinutes ?? undefined,
        scheduledForLabel: order.scheduledFor ? formatDateTime(order.scheduledFor, store.timezone) : undefined,
      },
    })
  } catch (err) {
    log.error('checkout.whatsapp', 'no se pudo mandar la confirmación por WhatsApp', err, { orderId: order.id })
  }
}

// ---------------------------------------------------------------------------
// Cotización — la sirve tanto el carrito (precio por línea) como el checkout.
// ---------------------------------------------------------------------------

export async function priceCartForStore(storeSlug: string, items: CartItem[]): Promise<PriceQuote> {
  const store = await getStoreBySlug(storeSlug)
  if (!store) throw new DomainError('Esta tienda no está disponible')

  // `estimateEta` necesita `basePrepMinutes`, que sale de `priceCart`: no hay
  // forma de paralelizarlas acá, a diferencia de otros lugares que resuelven
  // Store y no dependen entre sí.
  const priced = await priceCart(store, items)

  // Salteamos la consulta de disponibilidad cuando el local no hace envíos:
  // es un query extra por cada cotización (rate limit 120/min/IP), y para
  // todo local que no usa la feature el costo tiene que ser exactamente cero.
  const availability = store.delivery.enabled
    ? await getCourierAvailability(store.id)
    : { activeCouriers: 0, freeCouriers: 0 }

  const delivery = buildDeliveryQuote({
    delivery: store.delivery,
    subtotalCents: priced.subtotalCents,
    availability,
    currency: store.currency,
  })

  const eta = await estimateEta(store, priced.basePrepMinutes, delivery.minutesToAdd)
  const fullNights = await fullNightsFor(store)

  return { store, priced, eta, delivery, fullNights }
}

/**
 * Noches del horizonte que ya llegaron al tope de la tienda, para que el
 * selector de turnos las oculte enteras (Q3: la noche llena se cierra
 * entera, no por franja). `[]` sin tope configurado — sin límite no hay
 * noche que ocultar, y consultar igual sería un round trip que no sirve para
 * nada.
 *
 * Las noches candidatas son los `SCHEDULE_HORIZON_DAYS + 1` días calendario
 * del LOCAL desde hoy: toda `scheduled_night` posible cae en uno de esos días
 * — es el mismo día que abre el rango, y el horizonte ya acota el `scheduledFor`
 * a esa ventana (00-architecture.md §7.3.1).
 */
async function fullNightsFor(store: Store): Promise<string[]> {
  const capacity = store.scheduling.capacityPerNight
  if (capacity == null) return []

  const nights: string[] = []
  for (let i = 0; i <= SCHEDULE_HORIZON_DAYS; i++) {
    nights.push(zonedDay(new Date(Date.now() + i * 24 * 60 * 60_000), store.timezone))
  }

  const counts = await countScheduledByNight(store.id, nights)
  return nights.filter((night) => (counts[night] ?? 0) >= capacity)
}

// ---------------------------------------------------------------------------
// Checkout de Mercado Pago — crear o REUSAR una preferencia (P-06).
// ---------------------------------------------------------------------------

async function createCheckoutForOrder(order: Order, store: Store): Promise<CheckoutSession> {
  const provider = getPaymentProvider()

  const items = order.items.map((item) => ({
    name: item.nameSnapshot,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  }))

  // Mercado Pago arma su propio total sumando `unit_price × quantity` de cada
  // item de la preferencia: si el envío no viaja como un item más, MP le cobra
  // al cliente solo el subtotal aunque `totalCents` incluya el fee. El webhook
  // llega después con un monto que no alcanza y `markOrderPaid` lo marca
  // `mismatch` para siempre — el cliente pagó, el pedido nunca se confirma.
  if (order.deliveryFeeCents > 0) {
    items.push({ name: 'Envío', quantity: 1, unitPriceCents: order.deliveryFeeCents })
  }

  const checkout = await provider.createCheckout({
    storeId: store.id,
    orderToken: order.publicToken,
    orderShortCode: order.shortCode,
    storeName: store.name,
    storeSlug: store.slug,
    items,
    payerName: order.customerName,
    payerPhoneE164: order.customerPhoneE164,
    totalCents: order.totalCents,
    currency: order.currency,
    expiresInMinutes: CHECKOUT_EXPIRES_MINUTES,
  })
  await attachPreference(order.id, checkout.preferenceId, checkout.expiresAt)
  return checkout
}

/**
 * Resuelve el link de pago vigente de un pedido online no terminal:
 * reusa la preferencia existente si todavía sirve, y solo genera una nueva si
 * venció o no existía. Cada preferencia nueva es un `init_point` distinto —
 * generar una en cada reintento es lo que permitía pagar dos veces el mismo
 * pedido con dos pestañas abiertas (P-06).
 *
 * La usan `submitOrder` (recién creado) y `resumePaymentAction` (seguimiento).
 */
export async function resolveCheckoutUrl(order: Order, store: Store): Promise<string> {
  if (isTerminalStatus(order.status)) {
    throw new DomainError('Este pedido ya no se puede pagar.')
  }

  if (order.preferenceId) {
    const provider = getPaymentProvider()
    const session = await provider.getCheckoutSession(store.id, order.preferenceId)
    if (session) return session.checkoutUrl
    // Preferencia vencida o inexistente en Mercado Pago: cae a generar una nueva.
  }

  const checkout = await createCheckoutForOrder(order, store)
  return checkout.checkoutUrl
}

// ---------------------------------------------------------------------------
// Crear pedido
// ---------------------------------------------------------------------------

export type SubmitOrderResult = {
  token: string
  shortCode: string
  storeSlug: string
  /** A dónde mandar al cliente: el checkout de Mercado Pago, o directo al seguimiento si paga al retirar. */
  redirectUrl: string
}

export async function submitOrder(input: CreateOrderInput): Promise<SubmitOrderResult> {
  const { order, store } = await createOrder(input)

  if (order.paymentMethod === 'online') {
    const checkoutUrl = await resolveCheckoutUrl(order, store)
    return { token: order.publicToken, shortCode: order.shortCode, storeSlug: store.slug, redirectUrl: checkoutUrl }
  }

  if (order.paymentMethod === 'transfer') {
    // El pedido nace `pending`: no hay preferencia de Mercado Pago que crear
    // ni plata asegurada todavía. Ni el comprobante por mail ni el WhatsApp de
    // confirmación salen acá — sería confirmar algo que un humano todavía no
    // confirmó. Los dos disparan recién cuando el staff toca "Confirmar pago"
    // (`confirmTransferPayment`, kitchen.controller.ts).
    return {
      token: order.publicToken,
      shortCode: order.shortCode,
      storeSlug: store.slug,
      redirectUrl: `/pedido/${order.publicToken}`,
    }
  }

  // Pago al retirar: no hay webhook que confirme el pago después, el pedido
  // nace confirmado. Comprobante y WhatsApp de confirmación salen ya mismo,
  // pero no bloquean la respuesta: el cliente no tiene por qué esperar a Resend
  // o a wa.me para ver la pantalla de seguimiento.
  after(() => sendReceiptEmail(order, store, true))
  after(() => sendConfirmedWhatsapp(order, store))

  return {
    token: order.publicToken,
    shortCode: order.shortCode,
    storeSlug: store.slug,
    redirectUrl: `/pedido/${order.publicToken}`,
  }
}

// ---------------------------------------------------------------------------
// Seguimiento público
// ---------------------------------------------------------------------------

/**
 * Memoizado con `cache()` de React: `/pedido/[token]` lo llama DOS veces por
 * carga —una en `generateMetadata` y otra en la page— y sin esto son dos
 * queries idénticas a Postgres por cada apertura de un seguimiento.
 *
 * `cache()` deduplica dentro de un mismo render, que es exactamente el
 * alcance que hace falta acá: no cachea entre requests, así que el estado del
 * pedido sigue siendo tan fresco como antes. Importa porque el proyecto corre
 * en el free tier de Supabase, donde lo que se agota primero es la CPU de la
 * base, no el almacenamiento.
 */
export const getOrderStatus = cache(
  async (token: string): Promise<OrderPublicView | null> => getOrderByToken(token),
)

export async function lookupOrders(tokens: string[]): Promise<OrderPublicView[]> {
  return getOrdersByTokens(tokens)
}

// ---------------------------------------------------------------------------
// Despacho de un PaymentSnapshot — el corazón de P-01/P-02/P-03/P-06.
//
// Un solo lugar decide qué hacer con lo que dice Mercado Pago de un pago,
// para que el webhook (que confía en el snapshot re-consultado, nunca en el
// body) y el cron de conciliación (que re-consulta pagos que el webhook
// pudo haber perdido) hagan EXACTAMENTE lo mismo.
// ---------------------------------------------------------------------------

/**
 * `PaymentSnapshot.status` colapsa el vocabulario del proveedor al del
 * dominio (`refunded/charged_back → 'refunded'`); `providerStatus` guarda el
 * original. Para `payments` hace falta la distinción: un contracargo y un
 * reembolso no son lo mismo para el local aunque los dos saquen la plata.
 */
function toPaymentRecordStatus(snapshot: PaymentSnapshot): PaymentRecordStatus {
  if (snapshot.status === 'refunded' && snapshot.providerStatus === 'charged_back') return 'charged_back'
  return snapshot.status
}

/**
 * Reembolsa automáticamente un pago que sobrevivió a su pedido (duplicado, o
 * pedido cancelado antes de que llegara la confirmación). Si el reembolso
 * falla, NUNCA se pierde el rastro: `flagRefundNeeded` deja la cola de "plata
 * que hay que devolver" en el pedido y el log sale con severidad alta — es
 * plata de un cliente real.
 */
async function refundOrFlag(p: { storeId: number; orderId: number; providerPaymentId: string; amountCents: number; reason: string }): Promise<void> {
  const provider = getPaymentProvider()
  const result = await provider.refundPayment({
    storeId: p.storeId,
    providerPaymentId: p.providerPaymentId,
    amountCents: p.amountCents,
  })

  if (result.ok) {
    await markRefunded(p.orderId)
    log.warn('checkout.refund', 'reembolso automático aplicado', { storeId: p.storeId, orderId: p.orderId, reason: p.reason })
    return
  }

  await flagRefundNeeded(p.orderId, `${p.reason} — reembolso automático falló: ${result.error ?? 'sin detalle'}`)
  log.error('checkout.refund', 'reembolso automático falló, requiere intervención manual', undefined, {
    storeId: p.storeId,
    orderId: p.orderId,
    providerPaymentId: p.providerPaymentId,
    reason: p.reason,
  })
}

async function applyApprovedPayment(storeId: number, orderId: number, snapshot: PaymentSnapshot): Promise<MarkPaidOutcome['outcome']> {
  const outcome = await markOrderPaid({
    storeId,
    orderId,
    paymentRef: snapshot.providerPaymentId,
    amountCents: snapshot.amountCents,
    currency: snapshot.currency,
    providerStatus: snapshot.providerStatus,
    raw: snapshot.raw,
  })

  switch (outcome.outcome) {
    case 'applied': {
      const data = await getOrderWithStoreById(outcome.order.id)
      if (data) {
        after(() => sendReceiptEmail(data.order, data.store, false))
        after(() => sendConfirmedWhatsapp(data.order, data.store))
      }
      return outcome.outcome
    }
    case 'already_applied':
      // El webhook de Mercado Pago reintenta entregas: ya se aplicó antes, no hay nada más que hacer.
      return outcome.outcome
    case 'mismatch':
      // Tienda, monto o moneda no coinciden con el pedido: nunca se toca el
      // pedido ni se manda comprobante de algo que no se pagó de verdad.
      log.error('checkout.markOrderPaid', `pago rechazado por no coincidir con el pedido: ${outcome.reason}`, undefined, {
        storeId,
        orderId,
        providerPaymentId: snapshot.providerPaymentId,
      })
      return outcome.outcome
    case 'duplicate':
      await refundOrFlag({
        storeId,
        orderId,
        providerPaymentId: snapshot.providerPaymentId,
        amountCents: snapshot.amountCents,
        reason: 'pago duplicado: ya había un pago aprobado para este pedido',
      })
      return outcome.outcome
    case 'needs_refund':
      await refundOrFlag({
        storeId,
        orderId,
        providerPaymentId: snapshot.providerPaymentId,
        amountCents: snapshot.amountCents,
        reason: outcome.reason,
      })
      return outcome.outcome
  }
}

async function recordNonApprovedPayment(storeId: number, orderId: number, snapshot: PaymentSnapshot): Promise<void> {
  await recordPaymentStatusChange({
    storeId,
    orderId,
    paymentRef: snapshot.providerPaymentId,
    status: toPaymentRecordStatus(snapshot),
    amountCents: snapshot.amountCents,
    currency: snapshot.currency,
    providerStatus: snapshot.providerStatus,
    raw: snapshot.raw,
  })
}

/**
 * Despacha un snapshot ya re-consultado contra Mercado Pago. Exportada para
 * que `/api/cron/reconcile` aplique EXACTAMENTE esta misma lógica sobre los
 * pedidos que el webhook pudo haber perdido (P-05).
 */
export async function dispatchPaymentSnapshot(storeId: number, orderId: number, snapshot: PaymentSnapshot): Promise<void> {
  switch (snapshot.status) {
    case 'approved':
      await applyApprovedPayment(storeId, orderId, snapshot)
      return
    case 'refunded':
    case 'rejected':
      await recordNonApprovedPayment(storeId, orderId, snapshot)
      return
    case 'pending':
      // `in_process` u otro estado pendiente de Mercado Pago: todavía no hay
      // nada que registrar, se vuelve a consultar en el próximo webhook/cron.
      return
  }
}

/**
 * Confirmación de pago, llamada SOLO después de que el route handler del
 * webhook validó la firma con `verifyWebhookSignature`. Re-consulta el pago
 * contra Mercado Pago (nunca le cree al body del webhook) y recién ahí
 * despacha según lo que el proveedor dice de verdad.
 */
export async function confirmMercadoPagoPayment(p: { storeId: number; providerPaymentId: string }): Promise<void> {
  const provider = getPaymentProvider()
  const snapshot = await provider.fetchPayment(p.storeId, p.providerPaymentId)

  // Una tienda que carga un token TEST- en producción "cobra" con tarjetas de
  // juguete: `liveMode=false` en producción es un pago que nunca movió plata
  // de verdad, y confirmarlo le regala pedidos a quien lo dispare.
  if (isProduction && snapshot.liveMode === false) {
    log.error('checkout.confirmPayment', 'pago con liveMode=false recibido en producción, se ignora', undefined, {
      storeId: p.storeId,
      providerPaymentId: p.providerPaymentId,
    })
    return
  }

  if (!snapshot.externalReference) {
    log.warn('checkout.confirmPayment', 'pago sin external_reference, no se puede resolver el pedido', {
      storeId: p.storeId,
      providerPaymentId: p.providerPaymentId,
    })
    return
  }

  const orderId = await getOrderIdByToken(snapshot.externalReference)
  if (orderId == null) {
    log.warn('checkout.confirmPayment', 'external_reference no resuelve a ningún pedido', {
      storeId: p.storeId,
      providerPaymentId: p.providerPaymentId,
    })
    return
  }

  await dispatchPaymentSnapshot(p.storeId, orderId, snapshot)
}
