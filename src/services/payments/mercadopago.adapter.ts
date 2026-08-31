import 'server-only'

import { MercadoPagoConfig, MPNotFoundError, Payment, PaymentRefund, Preference } from 'mercadopago'
import { apexUrl, storeUrl } from '@/lib/urls'
import { createAdminClient } from '@/lib/supabase/admin'
import { centsToDecimal, decimalToCents, sumCents } from '@/lib/money'
import { decryptSecret } from '@/lib/crypto/secrets'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import type { PaymentStatus } from '@/models/schemas/order.schema'
import { verifyHmacSha256 } from '@/services/crypto/hmac'
import type { CheckoutSession, PaymentProvider, PaymentSnapshot, RefundResult } from './payment.port'

/**
 * Multi-tienda: cada local cobra con SU propia cuenta de Mercado Pago. El
 * access token vive en `store_payment_credentials` (tabla sin RLS: solo el
 * cliente admin la lee) y nunca en una variable de entorno global — eso
 * significaría cobrar el pedido de una hamburguesería con la cuenta de otra.
 *
 * Se guardan cifrados (`encryptSecret`/`decryptSecret`, ver S-08): esta tabla
 * es el activo más sensible del sistema, y un `pg_dump` o una secret key
 * filtrada no puede exponer el token de cobro de todos los locales en texto
 * plano. `decryptSecret` devuelve tal cual los valores de tiendas conectadas
 * antes de la migración, así que no rompe nada existente.
 */
async function getCredentialsRow(storeId: number): Promise<{ accessToken: string | null; webhookSecret: string | null }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_payment_credentials')
    .select('access_token, webhook_secret')
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) {
    throw new Error(`No se pudieron leer las credenciales de pago de la tienda ${storeId}: ${error.message}`)
  }
  if (!data) return { accessToken: null, webhookSecret: null }

  return {
    accessToken: decryptSecret(data.access_token),
    webhookSecret: decryptSecret(data.webhook_secret),
  }
}

async function requireAccessToken(storeId: number): Promise<string> {
  const { accessToken } = await getCredentialsRow(storeId)
  if (!accessToken) {
    // No es un fallo transitorio de Postgres: reintentar no lo arregla, hace
    // falta que el dueño conecte Mercado Pago desde el panel. Por eso es
    // DomainError y no un Error genérico — el webhook lo trata como
    // permanente (200, sin reintentos) en vez de una tormenta de reintentos
    // contra una tienda que nunca va a poder cobrar.
    throw new DomainError('Esta tienda todavía no conectó Mercado Pago.', { status: 409 })
  }
  return accessToken
}

function clientFor(accessToken: string) {
  return new MercadoPagoConfig({ accessToken })
}

/** MP → el vocabulario interno de `PaymentStatus`. */
function mapStatus(mpStatus: string | undefined): PaymentStatus {
  switch (mpStatus) {
    case 'approved':
      return 'approved'
    case 'rejected':
    case 'cancelled':
      return 'rejected'
    case 'refunded':
    case 'charged_back':
      return 'refunded'
    default:
      // pending, in_process, authorized, y cualquier estado nuevo que MP
      // sume sin avisar: tratarlo como pendiente es lo seguro. Nunca hay
      // que optimistamente asumir aprobado.
      return 'pending'
  }
}

/**
 * Fecha → ISO 8601 con offset explícito, el formato exacto que pide MP para
 * `expiration_date_from`/`expiration_date_to` (`…T…-04:00`, no `Z`).
 * `Date.toISOString()` ya calcula en UTC sin importar el TZ del runtime, así
 * que alcanza con reemplazar el sufijo por el offset cero equivalente.
 */
function toMpIso(date: Date): string {
  return date.toISOString().replace('Z', '+00:00')
}

/**
 * Shape mínima común entre `PaymentResponse` (`Payment.get`) y
 * `PaymentSearchResult` (`Payment.search`): el SDK las tipa por separado
 * —incluso con `id` como `number` en una y `string` en la otra— pero traen
 * los mismos campos que a nosotros nos importan, así que un solo mapeo a
 * `PaymentSnapshot` sirve para las dos.
 */
type PaymentLike = {
  id?: string | number
  status?: string
  status_detail?: string
  transaction_amount?: number
  transaction_amount_refunded?: number
  currency_id?: string
  date_approved?: string
  payment_method_id?: string
  payment_type_id?: string
  live_mode?: boolean
  external_reference?: string
}

/** Una tienda con un token `TEST-` en producción "cobra" con tarjetas de prueba (S-08). */
function isInvalidSandboxPayment(liveMode: boolean | undefined): boolean {
  return process.env.NODE_ENV === 'production' && liveMode === false
}

/**
 * MP rechaza la preferencia con `auto_return invalid. back_url.success must
 * be defined` cuando la back_url de éxito NO es una URL pública alcanzable
 * (el caso típico es `http://localhost:3000` en desarrollo) — pese a que el
 * campo está definido. Si alguien lee este mensaje dentro de seis meses va a
 * buscar un `back_urls.success` faltante y no lo va a encontrar: el error de
 * MP nombra el síntoma equivocado.
 *
 * Se decide sobre la URL concreta, no sobre `NODE_ENV`: el día que
 * `NEXT_PUBLIC_SITE_URL` en desarrollo apunte a un túnel HTTPS, `auto_return`
 * tiene que volver a funcionar solo, sin tocar código.
 */
function supportsAutoReturn(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Una URL que ni siquiera parsea no puede ser la que rompa el checkout:
    // se toma el camino seguro (sin auto_return) y que falle donde corresponda.
    return false
  }

  if (parsed.protocol !== 'https:') return false
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') return false
  // Sin punto en el hostname no hay dominio público que MP pueda resolver
  // (nombres de host internos, contenedores, `*.local`, etc).
  if (!parsed.hostname.includes('.')) return false

  return true
}

function toPaymentSnapshot(response: PaymentLike, fallbackId: string): PaymentSnapshot {
  return {
    providerPaymentId: String(response.id ?? fallbackId),
    status: mapStatus(response.status),
    providerStatus: response.status ?? null,
    amountCents: decimalToCents(response.transaction_amount ?? 0),
    amountRefundedCents: decimalToCents(response.transaction_amount_refunded ?? 0),
    currency: response.currency_id ?? null,
    liveMode: response.live_mode ?? null,
    externalReference: response.external_reference ?? null,
    // Nunca el payload completo: trae email y DNI del pagador y los primeros
    // seis / últimos cuatro de la tarjeta (Ley 25.326), y cualquier
    // `store_member` lee `payments.raw` por PostgREST (P-12). Se recorta acá,
    // en el borde con el proveedor, para que quien escriba la fila en
    // `payments` no tenga que acordarse de hacerlo.
    raw: {
      id: response.id ?? null,
      status: response.status ?? null,
      status_detail: response.status_detail ?? null,
      transaction_amount: response.transaction_amount ?? null,
      transaction_amount_refunded: response.transaction_amount_refunded ?? null,
      currency_id: response.currency_id ?? null,
      date_approved: response.date_approved ?? null,
      payment_method_id: response.payment_method_id ?? null,
      payment_type_id: response.payment_type_id ?? null,
      live_mode: response.live_mode ?? null,
      external_reference: response.external_reference ?? null,
    },
  }
}

export const mercadopagoAdapter: PaymentProvider = {
  async createCheckout({
    storeId,
    orderToken,
    orderShortCode,
    storeName,
    storeSlug,
    items,
    payerName,
    totalCents,
    currency,
    expiresInMinutes,
  }) {
    // MP arma su propio total sumando `unit_price * quantity` de cada item, así
    // que `checkout.controller.ts` agrega el envío como un item más ("Envío")
    // cuando corresponde — nunca viaja escondido dentro de `totalCents`. Acá
    // solo queda chequear una cota defensiva: el total del pedido nunca puede
    // ser MENOR que la suma de sus items. Si lo es, hay un bug de quien llamó
    // a este adapter (se olvidó de sumar el item del envío) y es mejor romper
    // acá que dejar que MP le cobre de menos al cliente.
    const itemsTotalCents = sumCents(items.map((item) => item.unitPriceCents * item.quantity))
    if (totalCents < itemsTotalCents) {
      throw new Error(`El total del pedido ${orderShortCode} (${totalCents}) es menor que la suma de sus items (${itemsTotalCents}).`)
    }

    const accessToken = await requireAccessToken(storeId)
    const preference = new Preference(clientFor(accessToken))

    // Al SUBDOMINIO de la tienda, no al apex: es el regreso del cliente
    // después de pagar, y ahí corre `clearResolvedOrderCart` (§2.2).
    const trackingUrl = storeUrl(storeSlug, `/pedido/${orderToken}`)
    const createdAt = new Date()
    const expiresAtDate = new Date(createdAt.getTime() + expiresInMinutes * 60_000)

    const response = await preference.create({
      body: {
        items: items.map((item, index) => ({
          id: String(index),
          title: item.name,
          quantity: item.quantity,
          currency_id: currency,
          unit_price: centsToDecimal(item.unitPriceCents),
        })),
        payer: { name: payerName },
        // Es cómo el webhook encuentra el pedido: nunca se manda el id
        // interno, que no dice nada fuera de nuestra base.
        external_reference: orderToken,
        back_urls: { success: trackingUrl, pending: trackingUrl, failure: trackingUrl },
        // `auto_return` exige que `back_urls.success` sea pública: en local
        // (`http://localhost:3000`) MP lo rechaza con un mensaje engañoso que
        // dice "must be defined" cuando el campo sí está (ver
        // `supportsAutoReturn`). Se omite la clave entera, nunca se manda
        // vacía o en `null`: el cliente vuelve del checkout con el botón
        // "Volver al sitio" de MP en vez de redirigir solo, y en producción
        // (`https://comandapp.ar`) no cambia nada.
        ...(supportsAutoReturn(trackingUrl) ? { auto_return: 'approved' as const } : {}),
        // store_id va en la query del webhook para que la ruta sepa con qué
        // credenciales validar la firma antes de tocar la base — el body de
        // la notificación de MP no trae la tienda. Al APEX, a propósito: es
        // server-to-server (nunca lo ve un browser) y queda fuera del
        // hostname del tenant, distinto del host de `back_urls`.
        notification_url: apexUrl(`/api/webhooks/mercadopago?store_id=${storeId}`),
        // El short_code ("A7K2") no le dice nada al cliente en el resumen de
        // la tarjeta y genera contracargos por "no reconozco este cargo": el
        // nombre del local sí. 22 chars es lo que MP trunca en el extracto.
        statement_descriptor: storeName.slice(0, 22),
        // Para conciliar un cobro desde el panel de MP sin cruzar a mano
        // contra `external_reference`.
        metadata: { store_id: storeId, order_token: orderToken },
        // Decisión explícita, no el default implícito: el sistema soporta
        // pagos `pending`/`in_process` resueltos después por webhook (la
        // máquina de estados de `orders.payment_status` tiene ese camino), así
        // que no hace falta forzar a MP a resolver todo en el momento del
        // checkout. Si algún día se necesita afirmar/rechazar sin estado
        // intermedio, esto pasa a `true`.
        binary_mode: false,
        // Un pedido `pending` sin vencimiento vive para siempre: ocupa
        // short_code, puede pagarse a las 3am con el local cerrado, e infla
        // la facturación de pedidos abandonados (P-04).
        expires: true,
        expiration_date_from: toMpIso(createdAt),
        expiration_date_to: toMpIso(expiresAtDate),
      },
    })

    if (!response.id || !response.init_point) {
      throw new Error(`Mercado Pago no devolvió una preferencia válida para el pedido ${orderShortCode}.`)
    }

    return {
      preferenceId: response.id,
      checkoutUrl: response.init_point,
      expiresAt: response.expiration_date_to ?? toMpIso(expiresAtDate),
    }
  },

  async getCheckoutSession(storeId, preferenceId): Promise<CheckoutSession | null> {
    try {
      const accessToken = await requireAccessToken(storeId)
      const preference = new Preference(clientFor(accessToken))
      const response = await preference.get({ preferenceId })

      if (!response.id || !response.init_point) return null

      // `expires` puede venir en `false` (preferencia vieja, de antes de
      // P-04) o en `true` con `expiration_date_to` ya pasado: en los dos
      // casos hay que decirle al que llama que genere una preferencia nueva.
      if (response.expires && response.expiration_date_to) {
        const expiresAtMs = Date.parse(response.expiration_date_to)
        if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
          return null
        }
      }

      return {
        preferenceId: response.id,
        checkoutUrl: response.init_point,
        expiresAt: response.expiration_date_to ?? null,
      }
    } catch (err) {
      if (err instanceof MPNotFoundError) return null
      log.error('payments.mercadopago', 'no se pudo recuperar la preferencia existente', err, { storeId, preferenceId })
      throw err
    }
  },

  async fetchPayment(storeId, providerPaymentId) {
    const accessToken = await requireAccessToken(storeId)
    const payment = new Payment(clientFor(accessToken))

    // El webhook solo avisa "mirá el pago X": nunca trae el monto ni el
    // estado como fuente de verdad, porque cualquiera puede pegarle un POST
    // a esa URL con un body inventado. Re-consultamos siempre con el access
    // token de la tienda, que es lo único que no se puede falsificar.
    const response = await payment.get({ id: providerPaymentId })

    if (isInvalidSandboxPayment(response.live_mode)) {
      // No hay reintento que arregle esto — hace falta que el dueño cargue el
      // token real — así que es DomainError (permanente) y no un Error
      // genérico: el webhook lo trata como definitivo, sin reintentos de MP.
      log.error('payments.mercadopago', 'pago en modo sandbox recibido en producción', undefined, {
        storeId,
        providerPaymentId,
      })
      throw new DomainError('El pago llegó en modo de prueba: no es válido en producción.', { status: 409 })
    }

    return toPaymentSnapshot(response, providerPaymentId)
  },

  async findPaymentsByExternalReference(storeId, externalReference): Promise<PaymentSnapshot[]> {
    const accessToken = await requireAccessToken(storeId)
    const payment = new Payment(clientFor(accessToken))

    let response
    try {
      response = await payment.search({
        options: {
          external_reference: externalReference,
          sort: 'date_created',
          criteria: 'asc',
          // Un pedido no puede tener docenas de pagos legítimos: si los
          // tiene, es exactamente el caso de doble cobro que P-06 busca
          // detectar, y ya se ve con los primeros resultados. No hace falta
          // paginar más allá de la primera página.
          limit: 20,
        },
      })
    } catch (err) {
      // "No existe la referencia" en Mercado Pago es un 200 con
      // `results: []`, no un error — así que lo único que cae acá es un
      // fallo real (token inválido, timeout, 5xx de MP). Eso el cron lo tiene
      // que poder distinguir de "no hay pagos" para decidir si reintenta.
      log.error('payments.mercadopago', 'no se pudo buscar pagos por external_reference', err, {
        storeId,
        externalReference,
      })
      throw err
    }

    const results = response.results ?? []
    const snapshots: PaymentSnapshot[] = []
    for (const result of results) {
      if (isInvalidSandboxPayment(result.live_mode)) {
        // A diferencia de `fetchPayment` (un solo pago conocido, se frena
        // todo), acá un resultado sandbox no invalida la búsqueda entera: se
        // excluye ese pago y se sigue con el resto de los resultados.
        log.error(
          'payments.mercadopago',
          'pago en modo sandbox recibido en producción, se excluye de la conciliación',
          undefined,
          { storeId, providerPaymentId: result.id },
        )
        continue
      }
      snapshots.push(toPaymentSnapshot(result, result.id ?? ''))
    }

    return snapshots
  },

  async refundPayment({ storeId, providerPaymentId, amountCents }): Promise<RefundResult> {
    // Nunca tira: perder el rastro de una plata que hay que devolver es peor
    // que un error en el log. Si algo falla, el llamador (order.model.ts)
    // marca `orders.needs_refund_at` para que alguien lo haga a mano.
    try {
      const accessToken = await requireAccessToken(storeId)
      const paymentRefund = new PaymentRefund(clientFor(accessToken))

      const response =
        amountCents != null
          ? await paymentRefund.create({ payment_id: providerPaymentId, body: { amount: centsToDecimal(amountCents) } })
          : await paymentRefund.total({ payment_id: providerPaymentId })

      return {
        ok: true,
        providerRefundId: response.id != null ? String(response.id) : null,
        error: null,
      }
    } catch (err) {
      log.error('payments.mercadopago', 'no se pudo reembolsar el pago', err, { storeId, providerPaymentId })
      return {
        ok: false,
        providerRefundId: null,
        error: err instanceof Error ? err.message : 'Error desconocido al reembolsar',
      }
    }
  },

  async verifyWebhookSignature({ storeId, signatureHeader, requestId, dataId }) {
    if (!signatureHeader) return false

    const { webhookSecret } = await getCredentialsRow(storeId)
    // Sin secreto configurado no hay forma de confiar en el webhook: nunca
    // se devuelve `true` por default, eso equivaldría a aceptar cualquier
    // POST como si fuera un pago real.
    if (!webhookSecret) return false

    // El header llega como "ts=...,v1=...". Se parsea a mano porque no es
    // JSON ni querystring estándar.
    const parts: Record<string, string> = {}
    for (const piece of signatureHeader.split(',')) {
      const [key, value] = piece.split('=')
      if (key && value) parts[key.trim()] = value.trim()
    }
    const ts = parts.ts
    const v1 = parts.v1
    if (!ts || !v1) return false

    // Ventana de replay: sin esto, un POST capturado (proxy, log, lo que sea)
    // sigue siendo una firma "válida" para siempre. 5 minutos es la
    // tolerancia de reloj entre servidores que documenta MP.
    const tsMs = Number(ts) * 1000
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      return false
    }

    // Manifest exacto que pide la doc oficial de MP. Tres detalles que
    // importan y que antes no se respetaban: el id alfanumérico va en
    // minúsculas, el segmento de `request-id` se OMITE por completo si el
    // header no vino (no se manda vacío), y el orden/los ";" finales no se
    // negocian — cambiarlos rompe la verificación en silencio (la firma
    // nunca matchea, sin ningún error visible).
    const segments = [`id:${dataId.toLowerCase()}`, requestId ? `request-id:${requestId}` : null, `ts:${ts}`].filter(
      (segment): segment is string => segment !== null,
    )
    const manifest = `${segments.join(';')};`

    return verifyHmacSha256(manifest, webhookSecret, v1)
  },
}
