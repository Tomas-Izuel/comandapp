import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveryFeeFor, deliveryMinutesFor } from '@/lib/delivery'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { formatCentsCompact, scaleUpInt, sumCents } from '@/lib/money'
import { ORDER_RECEIPTS_BUCKET, orderReceiptPath, productImageUrl } from '@/lib/storage'
import { canCollectPayment } from '@/lib/store-availability'
import { getPublicBankAccount } from '@/models/store-bank-account.model'
import {
  commercialNightOf,
  isOpenAt,
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_LEAD_MINUTES,
  SCHEDULE_STEP_MINUTES,
} from '@/lib/store-hours'
import { getCourierAvailability } from '@/models/courier.model'
import { toStore, type StoreRow } from '@/models/mappers/store.mapper'
import {
  ACTIVE_STATUSES,
  COOKING_STATUSES,
  IDEMPOTENCY_INDEX,
  ONE_APPROVED_PAYMENT_INDEX,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_PROVIDER,
  createOrderSchema,
  orderStatusSchema,
  canTransition,
  isTerminalStatus,
  isUniqueViolationOn,
  orderTokenSchema,
  type CartItem,
  type CreateOrderInput,
  type OrderStatus,
  type PaymentMethod,
  type PaymentRecordStatus,
  type PaymentStatus,
} from '@/models/schemas/order.schema'
import type {
  DeliveryMethod,
  EtaEstimate,
  Order,
  OrderDeliveryAddress,
  OrderItem,
  OrderItemOption,
  OrderPublicView,
  PricedCart,
  PricedItem,
  SalesPoint,
  ScheduledNightSummary,
  Store,
  StoreDashboard,
  StoreDashboardRpc,
  StoreHoursOverride,
  StoreHoursRange,
  StoreSchedule,
  TopProduct,
} from '@/models/types'
import type { Database, Json } from '@/lib/supabase/database.types'

const CTX = 'order.model'

type OrderRow = Database['public']['Tables']['orders']['Row']
type OrderItemRow = Database['public']['Tables']['order_items']['Row']
type OrderItemOptionRow = Database['public']['Tables']['order_item_options']['Row']

type OrderItemWithOptions = OrderItemRow & { order_item_options: OrderItemOptionRow[] }
/** Alias del embed a `store_members` vía `courier_id`. Opcional: no todos los selects lo piden. */
type CourierEmbed = { display_name: string } | null
type OrderWithItems = OrderRow & { order_items: OrderItemWithOptions[]; courier?: CourierEmbed }
type OrderWithItemsAndStore = OrderWithItems & {
  stores: StoreRow | null
  // Alias del embed a `store_members` vía `courier_id`. Solo se pide donde hace
  // falta (seguimiento público) para no ensanchar el select de todos lados.
  courier: { display_name: string } | null
}

type ProductForPricing = {
  id: number
  name: string
  image_path: string | null
  price_cents: number
  prep_minutes: number
  is_available: boolean
  option_groups: {
    id: number
    name: string
    min_select: number
    max_select: number
    options: { id: number; name: string; price_delta_cents: number; is_available: boolean }[]
  }[]
}

// ---------------------------------------------------------------------------
// mappers privados — snake_case (Postgres) → camelCase (dominio)
// ---------------------------------------------------------------------------

function toOrderItemOption(row: OrderItemOptionRow): OrderItemOption {
  return {
    id: row.id,
    optionId: row.option_id,
    nameSnapshot: row.name_snapshot,
    groupSnapshot: row.group_snapshot,
    priceDeltaCents: row.price_delta_cents,
  }
}

function toOrderItem(row: OrderItemWithOptions): OrderItem {
  return {
    id: row.id,
    productId: row.product_id,
    nameSnapshot: row.name_snapshot,
    unitPriceCents: row.unit_price_cents,
    quantity: row.quantity,
    totalCents: row.total_cents,
    prepMinutes: row.prep_minutes,
    notes: row.notes,
    options: (row.order_item_options ?? []).map(toOrderItemOption),
  }
}

function toOrder(row: OrderRow & { courier?: CourierEmbed }, items: OrderItem[]): Order {
  return {
    id: row.id,
    storeId: row.store_id,
    // NOT NULL desde 20260826120000_hardening.sql: ya no hace falta `?? ''`.
    shortCode: row.short_code,
    publicToken: row.public_token,
    status: row.status as OrderStatus,
    customerName: row.customer_name,
    customerPhoneE164: row.customer_phone_e164,
    customerEmail: row.customer_email,
    notes: row.notes,
    currency: row.currency,
    subtotalCents: row.subtotal_cents,
    totalCents: row.total_cents,
    basePrepMinutes: row.base_prep_minutes,
    demandMultiplier: row.demand_multiplier == null ? null : Number(row.demand_multiplier),
    etaMinutes: row.eta_minutes,
    etaAt: row.eta_at,
    paymentMethod: row.payment_method as PaymentMethod,
    paymentStatus: row.payment_status as PaymentStatus,
    preferenceId: row.preference_id,
    preferenceExpiresAt: row.preference_expires_at,
    paymentRef: row.payment_ref,
    externalRef: row.external_ref,
    confirmedAt: row.confirmed_at,
    paidAt: row.paid_at,
    readyAt: row.ready_at,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    needsRefundAt: row.needs_refund_at,
    refundReason: row.refund_reason,
    refundedAt: row.refunded_at,
    createdAt: row.created_at,
    items,

    transferReceiptPath: row.transfer_receipt_path,
    transferReceiptUploadedAt: row.transfer_receipt_uploaded_at,
    transferReceiptMime: row.transfer_receipt_mime,
    transferReceiptSizeBytes: row.transfer_receipt_size,
    transferReceiptSha256: row.transfer_receipt_sha256,

    deliveryMethod: row.delivery_method as DeliveryMethod,
    deliveryFeeCents: row.delivery_fee_cents,
    deliveryAddress: toDeliveryAddress(row),
    deliveryMinutes: row.delivery_minutes,
    courierId: row.courier_id,
    // Sale del embed, no de una columna de `orders`. Un select que no lo pida
    // deja esto en null, que es correcto: significa "no lo sé", no "no tiene".
    courierName: row.courier?.display_name ?? null,
    assignedAt: row.assigned_at,
    onTheWayAt: row.on_the_way_at,

    scheduledFor: row.scheduled_for,
    fireAt: row.fire_at,
    scheduledNight: row.scheduled_night,
  }
}

/**
 * Las cuatro columnas de dirección se colapsan en un objeto o en `null`.
 *
 * Un CHECK garantiza que un pedido `delivery` siempre tiene `line`, así que el
 * null acá significa exactamente "es un retiro" y no "le falta un dato".
 */
function toDeliveryAddress(row: {
  delivery_method: string
  delivery_address_line: string | null
  delivery_address_unit: string | null
  delivery_address_between: string | null
  delivery_address_notes: string | null
}): OrderDeliveryAddress | null {
  if (row.delivery_method !== 'delivery' || !row.delivery_address_line) return null
  return {
    line: row.delivery_address_line,
    unit: row.delivery_address_unit,
    between: row.delivery_address_between,
    notes: row.delivery_address_notes,
  }
}

function toOrderPublicView(row: OrderWithItemsAndStore): OrderPublicView {
  const status = row.status as OrderStatus
  const paymentMethod = row.payment_method as PaymentMethod
  const paymentStatus = row.payment_status as PaymentStatus

  // Solo el nombre de pila, y solo mientras el pedido está EN LA CALLE: esta
  // vista la ve cualquiera con el token, y el dato es de un empleado. Antes o
  // después de `on_the_way` (asignado pero todavía en el local, o ya
  // entregado) no aporta nada y sí expone de más.
  const courierFirstName =
    status === 'on_the_way' && row.courier?.display_name ? row.courier.display_name.split(' ')[0] : null

  return {
    shortCode: row.short_code,
    publicToken: row.public_token,
    status,
    customerName: row.customer_name,
    currency: row.currency,
    subtotalCents: row.subtotal_cents,
    totalCents: row.total_cents,
    etaMinutes: row.eta_minutes,
    etaAt: row.eta_at,
    paymentMethod,
    paymentStatus,
    paidAt: row.paid_at,
    readyAt: row.ready_at,
    createdAt: row.created_at,
    items: (row.order_items ?? []).map(toOrderItem),
    deliveryMethod: row.delivery_method as DeliveryMethod,
    deliveryFeeCents: row.delivery_fee_cents,
    deliveryAddress: toDeliveryAddress(row),
    scheduledFor: row.scheduled_for,
    transferReceiptUploadedAt: row.transfer_receipt_uploaded_at,
    // Se puebla aparte, en `getOrderByToken`: este mapper es sincrónico y
    // `getPublicBankAccount` no lo es. `null` acá es el default correcto para
    // cualquier caller que no lo resuelva (p. ej. `getOrdersByTokens`, que
    // lista pedidos viejos y no necesita reabrir el flujo de pago).
    bankAccount: null,
    courierFirstName,
    storeName: row.stores?.name ?? '',
    storeSlug: row.stores?.slug ?? '',
    // La URL de pago no viaja acá (se pide con `resumePaymentAction`): esto es
    // solo la señal de si vale la pena mostrar el botón "Ir a pagar".
    canResumePayment: paymentMethod === 'online' && paymentStatus === 'pending' && !isTerminalStatus(status),
  }
}

// El embed del repartidor va también acá, no solo en el select con `stores`:
// de este sale `getActiveOrders`, que es lo ÚNICO que alimenta el tablero de
// cocina (carga inicial, poll de 30s y refetch de Realtime). Sin él, el chip
// con el nombre del repartidor solo vivía en el parche optimista del cliente y
// el primer refetch lo borraba — el encargado tenía que abrir el selector de
// cada tarjeta para saber quién lleva qué.
const ORDER_WITH_ITEMS_SELECT =
  '*, courier:store_members!orders_courier_id_fkey ( display_name ), order_items ( *, order_item_options (*) )'
// `courier:store_members!orders_courier_id_fkey` es un embed aparte del de
// `stores`: hay una sola FK de `orders` a `store_members` (courier_id), así
// que el hint del constraint alcanza y no hace ambiguo el embed de `stores`
// del que dependen el seguimiento público y el webhook de Mercado Pago.
const ORDER_WITH_ITEMS_AND_STORE_SELECT =
  '*, stores ( * ), courier:store_members!orders_courier_id_fkey ( display_name ), order_items ( *, order_item_options (*) )'

/** Lectura completa de un pedido por id, para devolver en los outcomes de pago. */
async function fetchFullOrder(orderId: number): Promise<Order | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('orders').select(ORDER_WITH_ITEMS_SELECT).eq('id', orderId).maybeSingle()
  if (error) {
    log.error(CTX, 'no se pudo leer el pedido', error, { orderId })
    throw new Error(`No se pudo leer el pedido: ${error.message}`)
  }
  if (!data) return null
  const row = data as unknown as OrderWithItems
  return toOrder(row, row.order_items.map(toOrderItem))
}

/** `raw` es la respuesta cruda del proveedor: de ahí sale `live_mode` cuando el caller no lo manda aparte. */
function extractLiveMode(raw: unknown): boolean | null {
  if (raw && typeof raw === 'object' && 'live_mode' in raw) {
    const value = (raw as Record<string, unknown>).live_mode
    return typeof value === 'boolean' ? value : null
  }
  return null
}

// ---------------------------------------------------------------------------
// 1. priceCart — la función más importante del repo. Nunca confía en lo que
//    manda el browser: recalcula todo contra la base con el cliente admin,
//    porque quien arma el carrito casi siempre no está logueado.
//
//    Recibe el `Store` ya resuelto: antes volvía a leer `stores` por cada
//    llamada (un carrito de 4 líneas eran 20 queries entre priceCart/estimateEta
//    llamados en cascada); el caller ya lo tiene desde que resolvió el slug.
// ---------------------------------------------------------------------------

export async function priceCart(store: Store, items: CartItem[]): Promise<PricedCart> {
  if (items.length === 0) throw new DomainError('El carrito está vacío')

  const admin = createAdminClient()
  const productIds = [...new Set(items.map((i) => i.productId))]

  const { data: products, error } = await admin
    .from('products')
    .select(
      `id, name, image_path, price_cents, prep_minutes, is_available,
       option_groups ( id, name, min_select, max_select,
         options ( id, name, price_delta_cents, is_available ) )`,
    )
    // Nunca confiar en que el product_id que mandó el cliente es de esta tienda.
    .eq('store_id', store.id)
    .in('id', productIds)

  if (error) {
    log.error(CTX, 'no se pudo calcular el precio del carrito', error, { storeId: store.id })
    throw new Error(`No se pudo calcular el precio: ${error.message}`)
  }

  const productMap = new Map<number, ProductForPricing>(
    ((products ?? []) as unknown as ProductForPricing[]).map((p) => [p.id, p]),
  )

  const pricedItems: PricedItem[] = items.map((item) => {
    const product = productMap.get(item.productId)
    if (!product) throw new DomainError(`Uno de los productos del carrito ya no existe en esta tienda`)
    if (!product.is_available) throw new DomainError(`"${product.name}" no está disponible en este momento`)

    const optionIndex = new Map<
      number,
      { group: ProductForPricing['option_groups'][number]; option: ProductForPricing['option_groups'][number]['options'][number] }
    >()
    for (const group of product.option_groups) {
      for (const option of group.options) {
        optionIndex.set(option.id, { group, option })
      }
    }

    const chosenByGroup = new Map<number, number>()
    const chosenOptions: PricedItem['options'] = []

    for (const optionId of item.optionIds) {
      const found = optionIndex.get(optionId)
      if (!found) throw new DomainError(`Una de las opciones elegidas no pertenece a "${product.name}"`)
      if (!found.option.is_available) throw new DomainError(`"${found.option.name}" no está disponible`)

      chosenByGroup.set(found.group.id, (chosenByGroup.get(found.group.id) ?? 0) + 1)
      chosenOptions.push({
        optionId: found.option.id,
        name: found.option.name,
        groupName: found.group.name,
        priceDeltaCents: found.option.price_delta_cents,
      })
    }

    for (const group of product.option_groups) {
      const count = chosenByGroup.get(group.id) ?? 0
      if (count < group.min_select) {
        throw new DomainError(`Elegí al menos ${group.min_select} opción(es) de "${group.name}" para "${product.name}"`)
      }
      if (count > group.max_select) {
        throw new DomainError(`Elegí como máximo ${group.max_select} opción(es) de "${group.name}" para "${product.name}"`)
      }
    }

    // Los deltas de opciones pueden ser negativos ("sin cebolla" con descuento),
    // así que se suman con un reduce plano: sumCents() exige no-negativos y
    // rechazaría un delta válido acá. `cartItemSchema` ya rechaza optionIds
    // repetidos, así que no hace falta deduplicar acá.
    const optionsDeltaCents = chosenOptions.reduce((sum, o) => sum + o.priceDeltaCents, 0)
    const unitPriceCents = Math.max(0, product.price_cents + optionsDeltaCents)
    const totalCents = unitPriceCents * item.quantity

    return {
      productId: product.id,
      name: product.name,
      imageUrl: productImageUrl(product.image_path),
      quantity: item.quantity,
      unitPriceCents,
      totalCents,
      prepMinutes: product.prep_minutes,
      notes: item.notes ?? null,
      options: chosenOptions,
    }
  })

  const subtotalCents = sumCents(pricedItems.map((i) => i.totalCents))
  const basePrepMinutes = Math.max(...pricedItems.map((i) => i.prepMinutes))

  return {
    items: pricedItems,
    subtotalCents,
    totalCents: subtotalCents,
    basePrepMinutes,
  }
}

// ---------------------------------------------------------------------------
// 2. estimateEta — private.estimate_eta() no es callable desde PostgREST a
//    propósito, así que el cálculo vive acá, contando pedidos "en la plancha".
//    También recibe el `Store` ya resuelto: el multiplicador y el umbral son
//    columnas de la tienda que el caller ya tiene.
// ---------------------------------------------------------------------------

export async function estimateEta(store: Store, baseMinutes: number, deliveryMinutes = 0): Promise<EtaEstimate> {
  const admin = createAdminClient()

  const { count, error } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', store.id)
    .in('status', [...COOKING_STATUSES])
    // Un programado que todavía no disparó está parado esperando su hora, no
    // en la plancha: contarlo infla el ETA de todos los pedidos inmediatos del
    // medio. Espejo de `private.active_order_count` en Postgres (§5.3) — los
    // dos lados tienen que excluirlo, uno en TS y otro en la base.
    .or(`fire_at.is.null,fire_at.lte.${new Date().toISOString()}`)

  if (error) {
    log.error(CTX, 'no se pudo estimar el tiempo de espera', error, { storeId: store.id })
    throw new Error(`No se pudo estimar el tiempo: ${error.message}`)
  }

  const activeOrders = count ?? 0
  const isBusy = activeOrders >= store.demandThresholdOrders
  const multiplier = isBusy ? store.demandMultiplier : 1

  // scaleUpInt opera en puntos base enteros: Math.ceil(20 * 1.1) daba 23 por
  // el float 22.000000000000004. El viaje se SUMA después de multiplicar, no
  // se multiplica: el multiplicador de demanda es de la cocina, no de la moto.
  const cookMinutes = scaleUpInt(baseMinutes, multiplier)

  return {
    baseMinutes,
    multiplier,
    deliveryMinutes,
    etaMinutes: cookMinutes + deliveryMinutes,
    activeOrders,
    isBusy,
  }
}

// ---------------------------------------------------------------------------
// 3. createOrder — vía la RPC `create_order`: cabecera + ítems + opciones en
//    UNA transacción. Antes eran inserts en loop con un `delete` compensatorio
//    si algo fallaba a mitad de camino; con Supabase caído entre el insert de
//    la cabecera y el delete, quedaba un pedido `confirmed` sin ítems visible
//    en el KDS. La función SQL ya es idempotente por (store_id, idempotency_key).
// ---------------------------------------------------------------------------

/**
 * Lee el calendario del local con una query propia del admin client.
 *
 * No pasa por `store-hours.model.ts` (T1): ese archivo lee con el cliente de
 * SESIÓN porque lo llama el staff logueado desde Ajustes. Acá el checkout es
 * anónimo — no hay sesión de la que las RLS puedan tirar — así que es el
 * mismo patrón que `priceCart`/`estimateEta`: admin client, y la tabla ya
 * tiene lectura pública igual (`store_hours_public_read`).
 *
 * Sin filtro de fecha en los overrides a propósito: la tabla es chica (un
 * feriado por vez, no un calendario completo) y filtrar acá duplicaría en
 * TypeScript el mismo cálculo de ventana que ya hace `isOpenAt`/
 * `commercialNightOf` puro.
 */
async function getStoreScheduleForOrder(storeId: number): Promise<StoreSchedule> {
  const admin = createAdminClient()

  const [weeklyResult, overridesResult] = await Promise.all([
    admin.from('store_hours').select('day_of_week, opens_at_minute, duration_minutes').eq('store_id', storeId),
    admin
      .from('store_hours_overrides')
      .select('on_date, is_closed, opens_at_minute, duration_minutes')
      .eq('store_id', storeId),
  ])

  if (weeklyResult.error || overridesResult.error) {
    log.error(CTX, 'no se pudo leer el calendario de la tienda', weeklyResult.error ?? overridesResult.error, { storeId })
    throw new Error(`No se pudo leer el horario de la tienda: ${(weeklyResult.error ?? overridesResult.error)?.message}`)
  }

  const weekly: StoreHoursRange[] = (weeklyResult.data ?? []).map((row) => ({
    dayOfWeek: row.day_of_week,
    opensAtMinute: row.opens_at_minute,
    durationMinutes: row.duration_minutes,
  }))

  // Varias filas por fecha (un override abierto puede tener varios rangos):
  // se agrupan por `on_date` antes de devolver la forma que espera la lib.
  const overridesByDate = new Map<string, StoreHoursOverride>()
  for (const row of overridesResult.data ?? []) {
    if (row.is_closed) {
      overridesByDate.set(row.on_date, { date: row.on_date, isClosed: true, ranges: [] })
      continue
    }
    const existing = overridesByDate.get(row.on_date)
    const ranges = existing?.ranges ?? []
    // Un override sin `is_closed` siempre tiene rango (lo garantiza el CHECK
    // de la tabla): el `!` es seguro acá y no en el shape general de la fila.
    ranges.push({ opensAtMinute: row.opens_at_minute!, durationMinutes: row.duration_minutes! })
    overridesByDate.set(row.on_date, { date: row.on_date, isClosed: false, ranges })
  }

  return { weekly, overrides: [...overridesByDate.values()] }
}

/**
 * `create_order` marca el tope de la noche lleno con un mensaje que arranca
 * con este texto (ver la migración de pedidos programados) — es lo que
 * distingue "la noche está completa" de cualquier otro error de la RPC.
 */
const SCHEDULED_NIGHT_FULL_MARKER = 'scheduled_night_full'

function isScheduledNightFull(err: { message?: string } | null | undefined): boolean {
  return (err?.message ?? '').includes(SCHEDULED_NIGHT_FULL_MARKER)
}

async function findOrderIdByIdempotencyKey(storeId: number, key: string): Promise<number | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select('id')
    .eq('store_id', storeId)
    .eq('idempotency_key', key)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo verificar la idempotencia del pedido', error, { storeId })
    throw new Error(`No se pudo verificar la idempotencia: ${error.message}`)
  }
  return data?.id ?? null
}

export async function createOrder(input: CreateOrderInput): Promise<{ order: Order; store: Store }> {
  const parsed = createOrderSchema.parse(input)
  const admin = createAdminClient()

  const { data: storeRow, error: storeError } = await admin
    .from('stores')
    .select('*')
    .eq('slug', parsed.storeSlug)
    .maybeSingle()
  if (storeError) {
    log.error(CTX, 'no se pudo leer la tienda para crear el pedido', storeError, { storeSlug: parsed.storeSlug })
    throw new Error(`No se pudo crear el pedido: ${storeError.message}`)
  }
  if (!storeRow || storeRow.status !== 'active') throw new DomainError('Esta tienda no está disponible')
  if (!storeRow.accepting_orders) throw new DomainError('La tienda no está aceptando pedidos en este momento')

  const store = toStore(storeRow)

  // Antes esto se enteraba recién en el adapter de Mercado Pago
  // (`requireAccessToken`), después de que el cliente ya había armado el
  // carrito y dejado nombre y teléfono: un 409 tardío. Sin NINGÚN medio de
  // pago conectado el pedido no puede existir, así que corta acá.
  if (!canCollectPayment(store)) {
    throw new DomainError('Este local todavía no tiene un medio de pago activo')
  }
  if (parsed.paymentMethod === 'online' && !store.onlinePaymentEnabled) {
    throw new DomainError('Este local no está cobrando online por ahora')
  }
  if (parsed.paymentMethod === 'in_store' && !store.inStorePaymentEnabled) {
    throw new DomainError('Esta tienda no acepta pago al retirar')
  }
  if (parsed.paymentMethod === 'transfer' && !store.transferPaymentEnabled) {
    throw new DomainError('Este local no está aceptando transferencias por ahora')
  }

  // El cliente manda UN INSTANTE (o nada); todo lo demás —granularidad, lead,
  // horizonte, si cae dentro de horario, la noche comercial— lo deriva el
  // servidor, igual que los precios. `fire_at` y el tope de la noche los
  // calcula la RPC, nunca acá.
  const schedule = await getStoreScheduleForOrder(store.id)
  const now = new Date()
  const isScheduled = parsed.scheduledFor != null
  let scheduledForDate: Date | null = null
  let scheduledNight: string | null = null

  if (!isScheduled) {
    // Guarda nueva: antes una tienda cerrada por horario (sin `accepting_orders`
    // en juego, que ya se chequeó arriba) dejaba pedir igual porque el horario
    // ni existía como concepto.
    if (!isOpenAt(schedule, now, store.timezone)) {
      throw new DomainError('La cocina está cerrada. Podés programar un pedido para cuando abra.')
    }
  } else {
    scheduledForDate = new Date(parsed.scheduledFor!)

    // Múltiplo exacto de 15 minutos: la lista de turnos que vio el cliente es
    // canónica, así que cualquier otro instante es o un bug del cliente o
    // alguien pegándole al endpoint a mano.
    if (
      scheduledForDate.getUTCSeconds() !== 0 ||
      scheduledForDate.getUTCMilliseconds() !== 0 ||
      scheduledForDate.getUTCMinutes() % SCHEDULE_STEP_MINUTES !== 0
    ) {
      throw new DomainError('Elegí un horario de la lista de turnos disponibles')
    }

    const minutesUntilScheduled = (scheduledForDate.getTime() - now.getTime()) / 60_000

    // LEAD MÍNIMO: 60 MINUTOS PLANOS, SIN FÓRMULA. Decisión del dueño del
    // producto tomada viendo la aritmética (2026-08-29): un carrito pesado con
    // envío puede necesitar más de 60 minutos de cocción + viaje, y en ese caso
    // `fire_at` (que calcula `create_order` restando cocción+viaje+margen del
    // instante pactado) queda EN EL PASADO. Eso no es un bug: el pedido entra
    // al KDS en el próximo poll, que es la recuperación correcta ("ya vas
    // tarde, arrancá"). NO "arreglar" esto clampeando a `now()` ni subiendo el
    // piso por una fórmula con prep/delivery — ya se evaluó y se descartó.
    if (minutesUntilScheduled < SCHEDULE_LEAD_MINUTES) {
      throw new DomainError(`Programá tu pedido con al menos ${SCHEDULE_LEAD_MINUTES} minutos de anticipación`)
    }

    const horizonMinutes = SCHEDULE_HORIZON_DAYS * 24 * 60
    if (minutesUntilScheduled > horizonMinutes) {
      throw new DomainError(`Solo podés programar pedidos hasta ${SCHEDULE_HORIZON_DAYS} días por adelantado`)
    }

    // Misma lib que usó el browser para pintar el selector de turnos: si acá
    // dijera otra cosa, el cliente vería "cerrado" después de haber elegido un
    // horario que la pantalla anterior le ofreció como válido.
    if (!isOpenAt(schedule, scheduledForDate, store.timezone)) {
      throw new DomainError('Ese horario ya no está disponible. Elegí otro turno.')
    }

    scheduledNight = commercialNightOf(schedule, scheduledForDate, store.timezone)
  }

  const priced = await priceCart(store, parsed.items)

  // El mínimo general se evalúa sobre el SUBTOTAL, no sobre el total con
  // envío: un mínimo que se alcanza cobrando el delivery no es un mínimo.
  if (priced.subtotalCents < store.minOrderCents) {
    throw new DomainError(`El pedido mínimo es de ${formatCentsCompact(store.minOrderCents, store.currency)}`)
  }

  // El envío se recalcula desde cero, igual que los ítems: el browser manda
  // el MÉTODO y la dirección, nunca el monto del envío.
  const isDelivery = parsed.deliveryMethod === 'delivery'
  let deliveryFeeCents = 0
  let deliveryMinutes: number | null = null

  if (isDelivery) {
    if (!store.delivery.enabled) throw new DomainError('Este local no hace envíos a domicilio')

    if (priced.subtotalCents < store.delivery.minOrderCents) {
      const missingCents = store.delivery.minOrderCents - priced.subtotalCents
      throw new DomainError(
        `Para pedir con envío el mínimo es ${formatCentsCompact(store.delivery.minOrderCents, store.currency)}. Te faltan ${formatCentsCompact(missingCents, store.currency)}.`,
      )
    }

    deliveryFeeCents = deliveryFeeFor(store.delivery, priced.subtotalCents)

    if (isScheduled) {
      // Q2: política del dueño (¿se puede programar CON envío?) + realidad
      // (¿hay alguien que lo lleve?) — mismo par que `acceptingOrders` +
      // `canCollectPayment`. Si el repartidor se desactiva DESPUÉS de creado
      // el pedido no pasa nada especial: el pedido queda y se ve en la bandeja.
      if (!store.scheduling.deliveryEnabled) {
        throw new DomainError('Este local no permite programar pedidos con envío')
      }
      const availability = await getCourierAvailability(store.id)
      if (availability.activeCouriers < 1) {
        throw new DomainError('No hay repartidores disponibles para programar un envío')
      }
      // PLANO, nunca `busyMinutes`: la ocupación de la flota AHORA no describe
      // la de la noche programada (§6 de la arquitectura).
      deliveryMinutes = store.delivery.minutes
    } else {
      const availability = await getCourierAvailability(store.id)
      deliveryMinutes = deliveryMinutesFor(store.delivery, availability.freeCouriers)
    }
  }

  // El multiplicador de demanda medido AHORA no dice nada de la plancha a la
  // hora pactada: un programado no mide nada de eso, y "en X minutos" no
  // aplica cuando la promesa es una hora de pared. La tabla completa está en
  // 00-architecture.md §6.
  let demandMultiplier: number | null
  let etaMinutes: number | null
  let etaAt: string

  if (isScheduled) {
    demandMultiplier = null
    etaMinutes = null
    // La promesa ES el ETA.
    etaAt = scheduledForDate!.toISOString()
  } else {
    const eta = await estimateEta(store, priced.basePrepMinutes, deliveryMinutes ?? 0)
    demandMultiplier = eta.multiplier
    etaMinutes = eta.etaMinutes
    etaAt = new Date(Date.now() + eta.etaMinutes * 60_000).toISOString()
  }

  // Enumerando el método BUENO (pago presencial) en vez de los malos, un
  // cuarto método de pago nace inseguro por omisión y no al revés: es la misma
  // trampa que `create_order`/`store_couriers`/`platform_stores` documentan
  // para las columnas enumeradas a mano, acá aplicada al estado inicial. Es el
  // mismo criterio invertido que el trigger `enforce_order_rules`.
  const initialStatus: OrderStatus = parsed.paymentMethod === 'in_store' ? 'confirmed' : 'pending'

  // `orders_total_is_subtotal_plus_delivery_check` es la red de seguridad: si
  // acá se rompe la suma, el insert rebota con 23514 en vez de guardar un
  // envío regalado en silencio.
  const totalCents = priced.subtotalCents + deliveryFeeCents

  const p_order = {
    store_id: store.id,
    status: initialStatus,
    customer_name: parsed.customerName,
    customer_phone_e164: parsed.customerPhone,
    customer_email: parsed.customerEmail ?? null,
    idempotency_key: parsed.idempotencyKey,
    notes: parsed.notes ?? null,
    currency: store.currency,
    subtotal_cents: priced.subtotalCents,
    total_cents: totalCents,
    base_prep_minutes: priced.basePrepMinutes,
    demand_multiplier: demandMultiplier,
    eta_minutes: etaMinutes,
    eta_at: etaAt,
    payment_method: parsed.paymentMethod,
    payment_status: 'pending',
    delivery_method: parsed.deliveryMethod,
    delivery_fee_cents: deliveryFeeCents,
    delivery_minutes: deliveryMinutes,
    // Solo se guarda la dirección cuando es delivery: para un retiro no hay
    // ningún dato del cliente que valga la pena persistir acá.
    delivery_address_line: isDelivery ? (parsed.deliveryAddressLine ?? null) : null,
    delivery_address_unit: isDelivery ? (parsed.deliveryAddressUnit ?? null) : null,
    delivery_address_between: isDelivery ? (parsed.deliveryAddressBetween ?? null) : null,
    delivery_address_notes: isDelivery ? (parsed.deliveryAddressNotes ?? null) : null,
    // `fire_at` NO viaja acá: lo calcula la RPC, dentro de la transacción, con
    // los minutos de cocción y viaje que ya le mandamos arriba. El tope por
    // noche también lo arbitra la RPC (advisory lock + conteo): un `if` acá
    // pierde la carrera cuando dos clientes agarran el último lugar juntos.
    scheduled_for: isScheduled ? scheduledForDate!.toISOString() : null,
    scheduled_night: scheduledNight,
    night_capacity: isScheduled ? store.scheduling.capacityPerNight : null,
  }

  const p_items = priced.items.map((item) => ({
    product_id: item.productId,
    name_snapshot: item.name,
    unit_price_cents: item.unitPriceCents,
    quantity: item.quantity,
    total_cents: item.totalCents,
    prep_minutes: item.prepMinutes,
    notes: item.notes,
    options: item.options.map((option) => ({
      option_id: option.optionId,
      name_snapshot: option.name,
      group_snapshot: option.groupName,
      price_delta_cents: option.priceDeltaCents,
    })),
  }))

  const { data: rpcOrderId, error: rpcError } = await admin.rpc('create_order', {
    p_order: p_order as unknown as Json,
    p_items: p_items as unknown as Json,
  })

  let orderId = rpcOrderId ?? null

  if (rpcError || orderId == null) {
    // El tope por noche lo arbitra la RPC, en la misma transacción que cuenta
    // (advisory lock + count): acá solo se TRADUCE su rechazo a un mensaje de
    // interfaz. El marcador estable evita confundirlo con cualquier otro error
    // de la función — nunca llega crudo al browser.
    if (isScheduledNightFull(rpcError)) {
      throw new DomainError('Esa noche ya está completa. Elegí otro día.')
    }
    // La función ya resuelve la carrera de idempotencia sola (select antes del
    // insert, y de nuevo si el índice rebota con 23505); si igual llega acá con
    // el índice de idempotencia en el mensaje, es defensivo. Cualquier otro
    // 23505 es una colisión real (short_code no es atómico) y no un reintento.
    if (isUniqueViolationOn(rpcError, IDEMPOTENCY_INDEX)) {
      orderId = await findOrderIdByIdempotencyKey(store.id, parsed.idempotencyKey)
    }
    if (orderId == null) {
      log.error(CTX, 'no se pudo crear el pedido', rpcError, { storeId: store.id })
      throw new Error(`No se pudo crear el pedido: ${rpcError?.message ?? 'error desconocido'}`)
    }
  }

  const { data: orderRow, error: readError } = await admin
    .from('orders')
    .select(ORDER_WITH_ITEMS_SELECT)
    .eq('id', orderId)
    .single()

  if (readError || !orderRow) {
    log.error(CTX, 'no se pudo leer el pedido recién creado', readError, { storeId: store.id, orderId })
    throw new Error(`No se pudo leer el pedido creado: ${readError?.message ?? 'error desconocido'}`)
  }

  const row = orderRow as unknown as OrderWithItems
  return { order: toOrder(row, row.order_items.map(toOrderItem)), store }
}

// ---------------------------------------------------------------------------
// 4-5. Seguimiento público por token — admin porque el cliente no está logueado.
// ---------------------------------------------------------------------------

export async function getOrderByToken(token: string): Promise<OrderPublicView | null> {
  const parsed = orderTokenSchema.safeParse(token)
  if (!parsed.success) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select(ORDER_WITH_ITEMS_AND_STORE_SELECT)
    .eq('public_token', parsed.data)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo leer el pedido por token', error)
    throw new Error(`No se pudo leer el pedido: ${error.message}`)
  }
  if (!data) return null

  const row = data as unknown as OrderWithItemsAndStore
  const view = toOrderPublicView(row)

  // Único camino por el que el CBU llega al cliente: solo para transferencia,
  // y solo mientras el pedido no esté cancelado (un pedido cancelado ya no
  // tiene nada que transferir). `bankAccount` puede seguir en `null` si el
  // dueño desactivó o borró la cuenta después de crear el pedido — el panel
  // del cliente lo trata como "no hay a dónde transferir", nunca como un CBU
  // vacío inventado.
  if (view.paymentMethod === 'transfer' && view.status !== 'cancelled') {
    view.bankAccount = await getPublicBankAccount(row.store_id)
  }

  return view
}

/**
 * Solo el id interno, a partir del token público.
 *
 * Existe porque `OrderPublicView` omite el id a propósito: el cliente nunca
 * necesita el número de fila. Pero el webhook de Mercado Pago llega con el
 * `external_reference` (que es el token) y necesita el id para `markOrderPaid`.
 *
 * A propósito NO filtra por tienda acá: la verificación de que el pago
 * corresponde a la tienda correcta vive en `markOrderPaid` (P-01), que además
 * compara monto y moneda antes de tocar el pedido.
 */
export async function getOrderIdByToken(token: string): Promise<number | null> {
  const parsed = orderTokenSchema.safeParse(token)
  if (!parsed.success) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select('id')
    .eq('public_token', parsed.data)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo resolver el pedido por token', error)
    throw new Error(`No se pudo resolver el pedido: ${error.message}`)
  }
  return data?.id ?? null
}

/**
 * El pedido COMPLETO (con `customerEmail`) más su tienda entera.
 *
 * Existe aparte de `getOrderByToken` porque esa devuelve `OrderPublicView`, que
 * omite el email a propósito: es la vista que viaja al cliente. Esto en cambio
 * lo consumen el webhook de Mercado Pago y el panel de cocina para armar el
 * mail o el checkout, así que necesitan el dato real y la tienda completa.
 */
export async function getOrderWithStoreById(orderId: number): Promise<{ order: Order; store: Store } | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select(ORDER_WITH_ITEMS_AND_STORE_SELECT)
    .eq('id', orderId)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo leer el pedido con su tienda', error, { orderId })
    throw new Error(`No se pudo leer el pedido ${orderId}: ${error.message}`)
  }
  if (!data) return null

  const row = data as unknown as OrderWithItemsAndStore
  const items = (row.order_items ?? []).map(toOrderItem)

  // `orders.store_id` es NOT NULL con `on delete restrict`, así que la tienda
  // siempre está. Los tipos generados marcan el embed como nullable de todas
  // formas, y acá conviene fallar ruidoso antes que mandar un mail sin remitente.
  if (!row.stores) {
    throw new Error(`El pedido ${orderId} no tiene tienda asociada`)
  }

  return {
    order: toOrder(row, items),
    store: toStore(row.stores),
  }
}

export async function getOrdersByTokens(tokens: string[]): Promise<OrderPublicView[]> {
  const validTokens = tokens.filter((t) => orderTokenSchema.safeParse(t).success)
  if (validTokens.length === 0) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select(ORDER_WITH_ITEMS_AND_STORE_SELECT)
    .in('public_token', validTokens)
    .order('created_at', { ascending: false })

  if (error) {
    log.error(CTX, 'no se pudieron leer los pedidos por token', error)
    throw new Error(`No se pudieron leer los pedidos: ${error.message}`)
  }
  return ((data ?? []) as unknown as OrderWithItemsAndStore[]).map(toOrderPublicView)
}

// ---------------------------------------------------------------------------
// 6-7. Panel de cocina — staff logueado, RLS filtra por tienda.
// ---------------------------------------------------------------------------

export async function getActiveOrders(storeId: number): Promise<Order[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_WITH_ITEMS_SELECT)
    .eq('store_id', storeId)
    .in('status', [...ACTIVE_STATUSES])
    // ES el criterio del feature: un programado en espera (fire_at en el
    // futuro) no es trabajo de cocina todavía. Esta query es el ÚNICO origen
    // del tablero del KDS (carga inicial, poll de 30s y refetch de Realtime),
    // así que filtrar acá filtra el tablero entero, campana incluida.
    .or(`fire_at.is.null,fire_at.lte.${new Date().toISOString()}`)
    .order('created_at', { ascending: true })

  if (error) {
    log.error(CTX, 'no se pudieron leer los pedidos activos', error, { storeId })
    throw new Error(`No se pudieron leer los pedidos activos: ${error.message}`)
  }
  return ((data ?? []) as unknown as OrderWithItems[]).map((row) => toOrder(row, row.order_items.map(toOrderItem)))
}

export async function getOrderHistory(
  storeId: number,
  opts?: { limit?: number; from?: string; to?: string },
): Promise<Order[]> {
  const supabase = await createClient()
  let query = supabase
    .from('orders')
    .select(ORDER_WITH_ITEMS_SELECT)
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  if (opts?.from) query = query.gte('created_at', opts.from)
  if (opts?.to) query = query.lte('created_at', opts.to)
  query = query.limit(opts?.limit ?? 50)

  const { data, error } = await query
  if (error) {
    log.error(CTX, 'no se pudo leer el historial de pedidos', error, { storeId })
    throw new Error(`No se pudo leer el historial: ${error.message}`)
  }
  return ((data ?? []) as unknown as OrderWithItems[]).map((row) => toOrder(row, row.order_items.map(toOrderItem)))
}

// ---------------------------------------------------------------------------
// Programados — la bandeja de /admin/pedidos y el apagado destructivo.
// ---------------------------------------------------------------------------

/**
 * Programados vivos, para la bandeja "Programados" de `/admin/pedidos`.
 *
 * Ordenado por `scheduled_for`, NUNCA por `created_at`: el historial de
 * pedidos acota por fecha de creación, y un programado para dentro de 3 días
 * se creó HOY — con `created_at` caería "bajo hoy" en cualquier filtro que
 * asuma que reciente = próximo a pasar. La ventana de 1 hora hacia atrás deja
 * ver un rato el que acaba de disparar, en vez de desaparecer de la bandeja
 * en el instante exacto en que entra al KDS.
 */
export async function getScheduledOrders(storeId: number): Promise<Order[]> {
  const supabase = await createClient()
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString()

  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_WITH_ITEMS_SELECT)
    .eq('store_id', storeId)
    .not('scheduled_for', 'is', null)
    .in('status', ['pending', 'confirmed'])
    .gte('scheduled_for', cutoff)
    .order('scheduled_for', { ascending: true })

  if (error) {
    log.error(CTX, 'no se pudieron leer los pedidos programados', error, { storeId })
    throw new Error(`No se pudieron leer los pedidos programados: ${error.message}`)
  }
  return ((data ?? []) as unknown as OrderWithItems[]).map((row) => toOrder(row, row.order_items.map(toOrderItem)))
}

/**
 * La vista previa del diálogo destructivo (Q4/Q9): cuántos programados de
 * `night` todavía no dispararon, cuántos de esos están pagos, y cuánta plata
 * hay que devolver a mano si se confirma.
 *
 * ES UNA FOTO, no la cancelación: usa el MISMO predicado que
 * `cancel_scheduled_orders` (`fire_at > now()`, status vivo) para que el
 * número que ve el dueño coincida con lo que la RPC va a tocar — pero entre
 * que se pinta el diálogo y se confirma, un pedido puede disparar y salir del
 * conteo. Es esperado (00-architecture.md §7.8.1): "el diálogo puede decir 6
 * y cancelarse 5 porque uno disparó en el medio — correcto".
 *
 * `status in ('pending','confirmed')` acá es CORRECTO y NO es el mismo caso
 * que `countScheduledByNight` (más abajo): esto pregunta "¿qué va a cancelar
 * `cancel_scheduled_orders` si confirmo?", y esa RPC solo toca pedidos vivos
 * — un `delivered` no se cancela nunca, así que no tiene que aparecer en este
 * conteo. `countScheduledByNight` pregunta otra cosa ("¿cuánto lugar de la
 * noche ya está ocupado?") y por eso cuenta distinto (`status <>
 * 'cancelled'`, `delivered` incluido). Ver el comentario de esa función antes
 * de "alinear" esta también — no hay que hacerlo, las dos preguntas son
 * distintas a propósito (03-review.md §B2).
 */
export async function getScheduledNightSummary(storeId: number, night: string): Promise<ScheduledNightSummary> {
  const supabase = await createClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('orders')
    .select('total_cents, payment_status')
    .eq('store_id', storeId)
    .eq('scheduled_night', night)
    .gt('fire_at', nowIso)
    .in('status', ['pending', 'confirmed'])

  if (error) {
    log.error(CTX, 'no se pudo previsualizar la cancelación de la noche', error, { storeId, night })
    throw new Error(`No se pudo previsualizar la cancelación: ${error.message}`)
  }

  const rows = data ?? []
  const paidRows = rows.filter((r) => r.payment_status === 'approved')

  return {
    night,
    count: rows.length,
    paidCount: paidRows.length,
    paidTotalCents: sumCents(paidRows.map((r) => r.total_cents)),
  }
}

/**
 * Conteo de programados por noche, para la capa UX del tope (§7.3.1): cuántos
 * lugares ya están tomados en cada noche del horizonte, para que el checkout
 * (anónimo, admin client) pueda decidir qué noches ocultar del selector ANTES
 * de que el cliente elija un turno que la transacción va a rechazar.
 *
 * **`status <> 'cancelled'`, NO `in ('pending','confirmed')`** — y esto es
 * contraintuitivo a propósito, no un descuido: tiene que decir EXACTAMENTE lo
 * mismo que cuenta `create_order` dentro de la transacción (migración de
 * pedidos programados, cálculo de `v_taken`), porque es el árbitro real y esta
 * función es solo la foto que evita ofrecer un turno que la RPC va a rechazar.
 * Un pedido que ya disparó y avanzó (`preparing`/`ready`/`on_the_way`/
 * `delivered`) SIGUE ocupando su lugar de esa noche: la cocina ya lo hizo, y
 * si el conteo bajara al avanzar el estado se liberarían lugares que no
 * existen — justo en la avalancha del viernes a las 21:00, cuando ya hay
 * pedidos entregándose y otros entrando, que es el escenario que el tope
 * existe para atender. Filtrar por `pending`/`confirmed` (como hace
 * `getScheduledNightSummary`, más abajo, para el diálogo de cancelación —
 * y ahí SÍ es correcto, porque esa función refleja qué va a cancelar
 * `cancel_scheduled_orders`, no cuánto lugar queda) hace que la noche se
 * muestre "con lugar" en el browser mientras el servidor la sigue rechazando,
 * cada vez más a medida que avanza la noche. Verificado en vivo contra
 * Postgres (`03-review.md` §B2): con capacidad 1 y un pedido ya `delivered`,
 * el conteo viejo daba 0 ("hay lugar") y `create_order` rechazaba con
 * `scheduled_night_full` igual.
 */
export async function countScheduledByNight(storeId: number, nights: string[]): Promise<Record<string, number>> {
  if (nights.length === 0) return {}

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select('scheduled_night')
    .eq('store_id', storeId)
    .in('scheduled_night', nights)
    .neq('status', 'cancelled')

  if (error) {
    log.error(CTX, 'no se pudo contar los programados por noche', error, { storeId, nights })
    throw new Error(`No se pudo contar los programados por noche: ${error.message}`)
  }

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    if (!row.scheduled_night) continue
    counts[row.scheduled_night] = (counts[row.scheduled_night] ?? 0) + 1
  }
  return counts
}

/** Lo que devuelve de verdad `cancel_scheduled_orders` — ver el JSDoc de `cancelScheduledNight`. */
export type CancelScheduledNightResult = {
  /** Ids cancelados, para que el caller les dispare `order_cancelled` uno por uno. */
  cancelledIds: number[]
  cancelledCount: number
  /** Lo que el local tiene que devolver A MANO por Mercado Pago (Q8: sin auto-refund). */
  paidCents: number
}

/**
 * El apagado destructivo (Q4/Q9) y el cierre de una fecha con programados
 * adentro (Q14) comparten esta función: los dos cancelan `scheduled_night =
 * night AND fire_at > now() AND status in ('pending','confirmed')` de la
 * tienda, vía la RPC `cancel_scheduled_orders` — SECURITY DEFINER, cliente de
 * SESIÓN (verifica `is_store_member` en el cuerpo; con el admin client
 * `auth.uid()` no existe y la RPC rechaza siempre, mismo patrón que
 * `store_couriers`).
 *
 * **Desviación documentada de la firma que trae `01-tasks.md`.** El borrador
 * del plan proponía `{ cancelledIds, count, paidCount, paidTotalCents }`, pero
 * la migración YA ESCRITA (`cancel_scheduled_orders`, ground truth de
 * Postgres) devuelve `{ cancelledIds, cancelled, paidCents }` — sin
 * `paidCount`, porque contarlo exigiría una segunda query dentro de la misma
 * transacción que nadie pidió. `paidCount` ya lo tiene quien llamó
 * `getScheduledNightSummary` para pintar el diálogo ANTES de confirmar; no
 * hace falta repetirlo en el resultado de la cancelación.
 *
 * **`opts.pause` — la RPC hace MÁS que cancelar.** `cancel_scheduled_orders`
 * acepta `p_pause` y, si es `true`, apaga `stores.accepting_orders` DENTRO DE
 * LA MISMA TRANSACCIÓN que cancela — es justamente la atomicidad que
 * `00-architecture.md §7.8.1` pedía lograr con dos pasos ("cerrar la puerta
 * antes de barrer"; "si la RPC falla después del toggle, la puerta quedó
 * cerrada"). Con `p_pause` ya no hace falta el paso separado: quien orqueste
 * "pausar pedidos" (T1, `pauseScheduledNightAction`) tiene que llamar
 * `cancelScheduledNight(storeId, night, { pause: true })` y NO togglear
 * `accepting_orders` aparte — hacerlo aparte reintroduce la ventana de falla
 * parcial que la RPC ya cerró. Para el cierre de una fecha (Q14), que no toca
 * `accepting_orders`, se llama sin `opts` (`pause` default `false`).
 */
export async function cancelScheduledNight(
  storeId: number,
  night: string,
  opts?: { pause?: boolean },
): Promise<CancelScheduledNightResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_scheduled_orders', {
    p_store_id: storeId,
    p_night: night,
    p_pause: opts?.pause ?? false,
  })

  if (error) {
    log.error(CTX, 'no se pudo cancelar los programados de la noche', error, { storeId, night })
    throw new Error(`No se pudo cancelar los programados de la noche: ${error.message}`)
  }

  const result = (data ?? {}) as { cancelledIds?: number[]; cancelled?: number; paidCents?: number }
  return {
    cancelledIds: result.cancelledIds ?? [],
    cancelledCount: result.cancelled ?? 0,
    paidCents: result.paidCents ?? 0,
  }
}

/**
 * Cambia el estado de cocina, validando que la TRANSICIÓN sea legal.
 *
 * El trigger `orders_enforce_rules` de Postgres ya valida esto para TODOS los
 * roles (P-03), pero repetirlo acá deja que la UI muestre un error legible en
 * vez de un 500 con el texto de una excepción de Postgres.
 *
 * El update lleva `.eq('status', current)` a propósito: si otro operario cambió
 * el estado entre nuestra lectura y nuestra escritura, el update no afecta
 * ninguna fila y avisamos, en vez de pisar su cambio en silencio.
 */
export async function updateOrderStatus(orderId: number, status: OrderStatus): Promise<void> {
  const target = orderStatusSchema.parse(status)
  const supabase = await createClient()

  const { data: current, error: readError } = await supabase
    .from('orders')
    .select('status, payment_status, payment_method')
    .eq('id', orderId)
    .maybeSingle()

  if (readError) {
    log.error(CTX, 'no se pudo leer el pedido para cambiar su estado', readError, { orderId })
    throw new Error(`No se pudo leer el pedido: ${readError.message}`)
  }
  if (!current) throw new DomainError('No se encontró el pedido o no tenés permiso para modificarlo', { status: 404 })

  const from = current.status as OrderStatus
  if (from === target) return

  if (!canTransition(from, target)) {
    throw new DomainError(
      `Un pedido ${ORDER_STATUS_LABELS[from].toLowerCase()} no puede pasar a ${ORDER_STATUS_LABELS[target].toLowerCase()}`,
    )
  }

  // Regla de negocio, no de estado: la comida no sale sin plata asegurada. El
  // único método que confirma sin pago aprobado es el pago EN EL LOCAL, porque
  // ahí el cobro es presencial. Enumerar ese único método bueno (en vez de
  // listar los malos) es lo que hace que un tercer/cuarto medio de pago nazca
  // seguro por default — espejo exacto del predicado de
  // `private.enforce_order_rules`.
  if (
    target === 'confirmed' &&
    current.payment_method !== 'in_store' &&
    current.payment_status !== 'approved'
  ) {
    throw new DomainError('Este pedido todavía no está pago')
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status: target })
    .eq('id', orderId)
    .eq('status', from)
    .select('id')

  if (error) {
    log.error(CTX, 'no se pudo actualizar el estado del pedido', error, { orderId, from, target })
    throw new Error(`No se pudo actualizar el estado del pedido: ${error.message}`)
  }
  if (!data || data.length === 0) {
    throw new DomainError('El pedido cambió de estado mientras lo editabas. Refrescá y volvé a intentar.', {
      status: 409,
    })
  }
}

/**
 * El mostrador cobró en efectivo/posnet: cierra el ciclo del dinero a mano.
 *
 * Va con `createAdminClient()` porque `payment_status` está revocado por
 * columna para `authenticated` (20260826120000_hardening.sql): ni con RLS a
 * favor puede escribirlo un token de staff. La verificación de que quien llama
 * es efectivamente miembro de `storeId` es responsabilidad del caller (la
 * Server Action ya resolvió sesión y permiso antes de llegar acá).
 */
export async function markPaidInStore(storeId: number, orderId: number): Promise<void> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .update({ payment_status: 'approved', payment_ref: 'in_store' })
    .eq('id', orderId)
    .eq('store_id', storeId)
    .eq('payment_method', 'in_store')
    .eq('payment_status', 'pending')
    .select('id')

  if (error) {
    log.error(CTX, 'no se pudo marcar el pedido como pagado en el local', error, { storeId, orderId })
    throw new Error(`No se pudo marcar el pedido como pagado: ${error.message}`)
  }
  if (!data || data.length === 0) {
    throw new DomainError('No se encontró el pedido, no tenés permiso, o ya no está pendiente de pago en el local')
  }
}

// ---------------------------------------------------------------------------
// Mercado Pago — el pedido nace de alguien no logueado, así que admin.
// ---------------------------------------------------------------------------

/**
 * Asocia la preferencia de pago vigente al pedido.
 *
 * `expiresAt` no tiene columna propia todavía (ver el reporte final de este
 * slice): se loguea para observabilidad, pero la fuente de verdad de si un
 * link sigue vivo es `getCheckoutSession` contra Mercado Pago, no esta fila.
 */
export async function attachPreference(orderId: number, preferenceId: string, expiresAt: string | null): Promise<void> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    // Se persiste el vencimiento para poder decidir si el link todavía sirve
    // sin salir a preguntarle a Mercado Pago. Importa en el camino del botón
    // "Ir a pagar": el cliente ya tuvo un problema, no le agregues un round
    // trip a un tercero para descubrir que la preferencia venció.
    .update({ preference_id: preferenceId, preference_expires_at: expiresAt })
    .eq('id', orderId)
    .eq('payment_method', 'online')
    .select('id')

  if (error) {
    log.error(CTX, 'no se pudo asociar la preferencia de pago', error, { orderId })
    throw new Error(`No se pudo asociar la preferencia de pago: ${error.message}`)
  }
  if (!data || data.length === 0) throw new DomainError('No se encontró el pedido o no es de pago online')
}

/**
 * Verifica tienda + monto + moneda ANTES de tocar el pedido (P-01).
 *
 * Después de esas validaciones, el pago se registra SIEMPRE (la plata ya entró
 * de verdad); lo que puede variar es si el pedido puede recibirlo:
 *
 *  - Pedido cancelado/entregado, o la tienda ya no acepta pedidos → el pago
 *    queda aprobado pero el pedido no se toca: se encola para reembolso (P-03).
 *  - Ya había otro pago aprobado con OTRO `provider_payment_id` → doble cobro:
 *    se encola para reembolso (P-06).
 *  - Mismo `provider_payment_id` que el pago ya aprobado → reintento del mismo
 *    webhook, no hay nada nuevo que hacer.
 *  - Caso feliz → confirma el pedido, con `.eq('status', 'pending')` para no
 *    pisar una cancelación concurrente.
 */
export async function markOrderPaid(p: {
  storeId: number
  orderId: number
  paymentRef: string
  amountCents: number
  currency: string | null
  providerStatus: string | null
  raw: unknown
}): Promise<MarkPaidOutcome> {
  const admin = createAdminClient()
  const fields = { storeId: p.storeId, orderId: p.orderId, paymentRef: p.paymentRef }

  const order = await fetchFullOrder(p.orderId)
  if (!order) throw new DomainError('El pedido no existe')

  const mismatchReason =
    order.storeId !== p.storeId
      ? 'La tienda del pago no coincide con la del pedido'
      : order.paymentMethod !== 'online'
        ? 'El pedido no es de pago online'
        : p.amountCents < order.totalCents
          ? 'El monto pagado no cubre el total del pedido'
          : p.currency && p.currency !== order.currency
            ? 'La moneda del pago no coincide con la del pedido'
            : null

  if (mismatchReason) {
    const { error } = await admin.from('payments').insert({
      order_id: p.orderId,
      // El store_id del PAGO, no el del pedido: son justo los que no coinciden.
      store_id: p.storeId,
      provider: PAYMENT_PROVIDER,
      provider_payment_id: p.paymentRef,
      status: 'mismatch' satisfies PaymentRecordStatus,
      amount_cents: p.amountCents,
      currency: p.currency,
      live_mode: extractLiveMode(p.raw),
      raw: (p.raw ?? {}) as Json,
    })
    if (error && error.code !== '23505') {
      log.error(CTX, 'no se pudo registrar un pago con mismatch', error, fields)
    }
    log.error(CTX, `pago rechazado por mismatch: ${mismatchReason}`, undefined, fields)
    return { outcome: 'mismatch', reason: mismatchReason }
  }

  // De acá en más, tienda/monto/moneda/método ya coinciden con el pedido.

  const insertApproved = () =>
    admin.from('payments').insert({
      order_id: p.orderId,
      store_id: p.storeId,
      provider: PAYMENT_PROVIDER,
      provider_payment_id: p.paymentRef,
      status: 'approved' satisfies PaymentRecordStatus,
      amount_cents: p.amountCents,
      currency: p.currency,
      live_mode: extractLiveMode(p.raw),
      raw: (p.raw ?? {}) as Json,
    })

  const { error: paymentError } = await insertApproved()

  if (paymentError) {
    if (isUniqueViolationOn(paymentError, ONE_APPROVED_PAYMENT_INDEX)) {
      // Ya había OTRO pago aprobado para este pedido: doble cobro (P-06).
      const { error: dupError } = await admin.from('payments').insert({
        order_id: p.orderId,
        store_id: p.storeId,
        provider: PAYMENT_PROVIDER,
        provider_payment_id: p.paymentRef,
        status: 'duplicate' satisfies PaymentRecordStatus,
        amount_cents: p.amountCents,
        currency: p.currency,
        live_mode: extractLiveMode(p.raw),
        raw: (p.raw ?? {}) as Json,
      })
      // 23505 acá = el mismo webhook duplicado reintentando; ya quedó registrado.
      if (dupError && dupError.code !== '23505') {
        log.error(CTX, 'no se pudo registrar el pago duplicado', dupError, fields)
      }
      await flagRefundNeeded(p.orderId, 'Segundo pago aprobado para un pedido que ya tenía uno')
      log.error(CTX, 'pago duplicado: el pedido ya tenía un pago aprobado', undefined, fields)
      const refreshed = await fetchFullOrder(p.orderId)
      return { outcome: 'duplicate', order: refreshed ?? order }
    }

    if (paymentError.code === '23505') {
      // Mismo (provider, provider_payment_id): MP reintentó la misma entrega.
      log.info(CTX, 'webhook repetido: el pago ya estaba aplicado', fields)
      return { outcome: 'already_applied', order }
    }

    log.error(CTX, 'no se pudo registrar el pago', paymentError, fields)
    throw new Error(`No se pudo registrar el pago: ${paymentError.message}`)
  }

  // El pago quedó aprobado. Si el pedido ya no puede recibirlo (terminal, o la
  // tienda dejó de aceptar pedidos), la plata entró igual: cola de reembolso.
  const { data: storeRow, error: storeError } = await admin
    .from('stores')
    .select('accepting_orders, status')
    .eq('id', order.storeId)
    .maybeSingle()
  if (storeError) {
    log.error(CTX, 'no se pudo leer el estado de la tienda al aplicar el pago', storeError, fields)
    throw new Error(`No se pudo verificar la tienda: ${storeError.message}`)
  }
  const storeAcceptingOrders = storeRow?.accepting_orders === true && storeRow?.status === 'active'

  if (isTerminalStatus(order.status) || !storeAcceptingOrders) {
    const reason = isTerminalStatus(order.status)
      ? `El pedido ya estaba "${ORDER_STATUS_LABELS[order.status].toLowerCase()}" cuando llegó el pago`
      : 'La tienda dejó de aceptar pedidos antes de que el pago se confirmara'

    const { error: updateError } = await admin
      .from('orders')
      .update({ payment_status: 'approved', payment_ref: p.paymentRef })
      .eq('id', p.orderId)
    if (updateError) {
      log.error(CTX, 'no se pudo marcar como pagado un pedido que necesita reembolso', updateError, fields)
      throw new Error(`No se pudo actualizar el pedido: ${updateError.message}`)
    }

    await flagRefundNeeded(p.orderId, reason)
    log.error(CTX, `pago aprobado en un pedido que ya no puede recibirlo: ${reason}`, undefined, fields)
    const refreshed = await fetchFullOrder(p.orderId)
    return { outcome: 'needs_refund', order: refreshed ?? order, reason }
  }

  // Camino feliz: pedido `pending`, tienda activa. El predicado de estado evita
  // pisar una cancelación que haya ganado la carrera justo acá (el trigger de
  // Postgres rechazaría `confirmed` sobre un pedido no-pending; esto evita
  // provocar esa excepción en vez de depender de que pase).
  const { data: updated, error: updateError } = await admin
    .from('orders')
    .update({ payment_status: 'approved', payment_ref: p.paymentRef, status: 'confirmed' })
    .eq('id', p.orderId)
    .eq('status', 'pending')
    .select(ORDER_WITH_ITEMS_SELECT)
    .maybeSingle()

  if (updateError) {
    log.error(CTX, 'no se pudo confirmar el pedido pago', updateError, fields)
    throw new Error(`No se pudo actualizar el pedido: ${updateError.message}`)
  }

  if (!updated) {
    // Carrera: cancelaron el pedido entre el insert del pago y este update.
    const reason = 'El pedido cambió de estado justo cuando el pago se confirmó'
    await flagRefundNeeded(p.orderId, reason)
    log.error(CTX, reason, undefined, fields)
    const refreshed = await fetchFullOrder(p.orderId)
    return { outcome: 'needs_refund', order: refreshed ?? order, reason }
  }

  // El componente de viaje del ETA depende de si hay motos libres EN ESTE
  // MOMENTO, y entre crear el pedido y que el pago se confirme puede pasar
  // media hora. Log-y-seguir: `refreshFrozenEta` no tira, y aunque tirara, un
  // fallo acá no puede tumbar la confirmación de un pago que ya se aplicó.
  await refreshFrozenEta(p.orderId).catch((err) => {
    log.error(CTX, 'no se pudo recalcular el ETA tras aprobar el pago', err, fields)
  })

  const row = updated as unknown as OrderWithItems
  return { outcome: 'applied', order: toOrder(row, row.order_items.map(toOrderItem)) }
}

/**
 * Recalcula el ETA congelado de un pedido ya `confirmed`.
 *
 * Se llama SOLO desde el camino feliz de `markOrderPaid`: nunca sobre un
 * pedido `mismatch` o `needs_refund`, eso recalcularía el ETA de un pedido
 * que no va a cocina. Con delivery importa el doble, porque el viaje depende
 * de la disponibilidad de repartidores en el instante en que se aprueba el
 * pago, no en el que se creó el pedido.
 *
 * Nunca tira: cualquier fallo se loguea y se descarta, para no arriesgar la
 * confirmación de un pago ya aplicado por un problema de recálculo.
 */
export async function refreshFrozenEta(orderId: number): Promise<void> {
  const admin = createAdminClient()

  const { data: orderRow, error: orderError } = await admin
    .from('orders')
    .select('store_id, base_prep_minutes, delivery_method, scheduled_for')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !orderRow || orderRow.base_prep_minutes == null) {
    log.error(CTX, 'no se pudo releer el pedido para recalcular el ETA', orderError ?? undefined, { orderId })
    return
  }

  // Un programado NO recalcula: `eta_at = scheduled_for` es la promesa, y un
  // pago que se aprueba media hora después no puede correrla. Además
  // `demand_multiplier`/`eta_minutes` quedan `null` a propósito (§6) — pisarlos
  // acá con un multiplicador medido ahora sería reintroducir exactamente lo
  // que ese `null` viene a evitar.
  if (orderRow.scheduled_for != null) return

  const { data: storeRow, error: storeError } = await admin
    .from('stores')
    .select('*')
    .eq('id', orderRow.store_id)
    .maybeSingle()

  if (storeError || !storeRow) {
    log.error(CTX, 'no se pudo releer la tienda para recalcular el ETA', storeError ?? undefined, { orderId })
    return
  }

  const store = toStore(storeRow)
  const isDelivery = orderRow.delivery_method === 'delivery'
  let deliveryMinutes = 0

  if (isDelivery) {
    const availability = await getCourierAvailability(store.id)
    deliveryMinutes = deliveryMinutesFor(store.delivery, availability.freeCouriers)
  }

  const eta = await estimateEta(store, orderRow.base_prep_minutes, deliveryMinutes)
  const etaAt = new Date(Date.now() + eta.etaMinutes * 60_000).toISOString()

  const { error: updateError } = await admin
    .from('orders')
    .update({
      demand_multiplier: eta.multiplier,
      delivery_minutes: isDelivery ? deliveryMinutes : null,
      eta_minutes: eta.etaMinutes,
      eta_at: etaAt,
    })
    .eq('id', orderId)
    // Entre la lectura de arriba y esta escritura la cocina pudo cancelar el
    // pedido. Recalcularle el ETA a un pedido cancelado no rompe nada, pero
    // deja una fila que dice que algo llega en 45 minutos y no va a llegar.
    .not('status', 'in', '("delivered","cancelled")')

  if (updateError) {
    log.error(CTX, 'no se pudo escribir el ETA recalculado', updateError, { orderId })
  }
}

export type MarkPaidOutcome =
  | { outcome: 'applied'; order: Order }
  | { outcome: 'already_applied'; order: Order }
  | { outcome: 'mismatch'; reason: string }
  | { outcome: 'duplicate'; order: Order }
  | { outcome: 'needs_refund'; order: Order; reason: string }

/**
 * Reembolsos y contracargos (P-02): registra el pago con su estado real y, si
 * corresponde, actualiza `orders.payment_status`. El trigger de Postgres ya
 * emite el evento de outbox cuando `payment_status` cambia.
 */
export async function recordPaymentStatusChange(p: {
  storeId: number
  orderId: number
  paymentRef: string
  status: PaymentRecordStatus
  amountCents: number
  currency: string | null
  providerStatus: string | null
  raw: unknown
}): Promise<void> {
  const admin = createAdminClient()
  const fields = { storeId: p.storeId, orderId: p.orderId, paymentRef: p.paymentRef, status: p.status }

  const { error: paymentError } = await admin.from('payments').insert({
    order_id: p.orderId,
    store_id: p.storeId,
    provider: PAYMENT_PROVIDER,
    provider_payment_id: p.paymentRef,
    status: p.status,
    amount_cents: p.amountCents,
    currency: p.currency,
    live_mode: extractLiveMode(p.raw),
    raw: (p.raw ?? {}) as Json,
  })
  // 23505 = MP reintentó la misma notificación; ya quedó registrada la primera vez.
  if (paymentError && paymentError.code !== '23505') {
    log.error(CTX, 'no se pudo registrar el cambio de estado del pago', paymentError, fields)
    throw new Error(`No se pudo registrar el pago: ${paymentError.message}`)
  }

  const nextPaymentStatus: PaymentStatus | null =
    p.status === 'refunded' || p.status === 'charged_back' ? 'refunded' : p.status === 'rejected' ? 'rejected' : null

  if (!nextPaymentStatus) return

  const { error: updateError } = await admin
    .from('orders')
    .update({ payment_status: nextPaymentStatus })
    .eq('id', p.orderId)
    .eq('store_id', p.storeId)

  if (updateError) {
    log.error(CTX, 'no se pudo actualizar payment_status del pedido', updateError, { ...fields, nextPaymentStatus })
    throw new Error(`No se pudo actualizar el pedido: ${updateError.message}`)
  }

  log.warn(CTX, `payment_status del pedido pasó a "${nextPaymentStatus}" por un ${p.status}`, {
    ...fields,
    providerStatus: p.providerStatus,
  })
}

/** Encola el pedido en "plata que hay que devolver". Idempotente: no pisa el primer timestamp/motivo. */
export async function flagRefundNeeded(orderId: number, reason: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('orders')
    .update({ needs_refund_at: new Date().toISOString(), refund_reason: reason })
    .eq('id', orderId)
    .is('needs_refund_at', null)

  if (error) {
    log.error(CTX, 'no se pudo encolar el pedido para reembolso', error, { orderId, reason })
    throw new Error(`No se pudo marcar el pedido para reembolso: ${error.message}`)
  }
}

/** Cierra la cola de reembolso una vez que la plata realmente volvió. */
export async function markRefunded(orderId: number): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('orders')
    .update({ refunded_at: new Date().toISOString(), payment_status: 'refunded' })
    .eq('id', orderId)

  if (error) {
    log.error(CTX, 'no se pudo marcar el pedido como reembolsado', error, { orderId })
    throw new Error(`No se pudo marcar el pedido como reembolsado: ${error.message}`)
  }
}

/**
 * Pedidos online que quedaron esperando el webhook (P-05): para el cron de
 * conciliación, que los vuelve a consultar contra Mercado Pago.
 */
export async function listOrdersForReconciliation(
  olderThanMinutes: number,
): Promise<{ id: number; storeId: number; publicToken: string; preferenceId: string | null; totalCents: number }[]> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()

  const { data, error } = await admin
    .from('orders')
    .select('id, store_id, public_token, preference_id, total_cents')
    .eq('payment_method', 'online')
    .eq('payment_status', 'pending')
    .eq('status', 'pending')
    .not('preference_id', 'is', null)
    .lt('created_at', cutoff)

  if (error) {
    log.error(CTX, 'no se pudo listar pedidos para conciliación', error, { olderThanMinutes })
    throw new Error(`No se pudo listar pedidos para conciliación: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    storeId: row.store_id,
    publicToken: row.public_token,
    preferenceId: row.preference_id,
    totalCents: row.total_cents,
  }))
}

// ---------------------------------------------------------------------------
// 7.5 Transferencia bancaria — el pedido lo confirma un HUMANO, no un webhook.
//     Ver 00-architecture.md §5.5-§5.9: el comprobante es un solo tiro, "marcar
//     pagado" NO depende de que exista, y la purga de verdad vive en el cron
//     de cleanup (borrar de Storage no es SQL, así que acá solo se lee y se
//     nulea la referencia — el borrado del objeto lo orquesta el caller).
// ---------------------------------------------------------------------------

/**
 * El staff (cualquier miembro, no solo el dueño — ver `kitchen.actions.ts`)
 * confirma que la plata entró A SU CUENTA. NO exige que exista comprobante: si
 * la resolución fue por WhatsApp, se confirma igual (00-architecture.md §5.9,
 * decisión del dueño del producto, no se re-abre).
 *
 * CAS calcado de `markPaidInStore`: `.eq('payment_method','transfer').eq('payment_status','pending')`.
 * Cero filas ⇒ otro operario ya lo confirmó, o el pedido no es lo que se pensaba ⇒ 409.
 *
 * A diferencia de `markPaidInStore`, esto SÍ inserta en `payments`: acá hay
 * número de operación y es plata que se movió por afuera de la plataforma, así
 * que merece libro mayor (00-architecture.md §5.6). El índice único
 * `payments_one_approved_per_order_idx` es la segunda red — el CAS de arriba
 * ya cierra casi toda la carrera, pero un 23505 acá se traduce a 409 en vez de
 * a un 500.
 */
export async function markPaidByTransfer(p: {
  storeId: number
  orderId: number
  reference: string | null
  confirmedBy: string
}): Promise<Order> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('orders')
    .update({ payment_status: 'approved', payment_ref: p.reference ?? 'transfer', paid_at: new Date().toISOString() })
    .eq('id', p.orderId)
    .eq('store_id', p.storeId)
    .eq('payment_method', 'transfer')
    .eq('payment_status', 'pending')
    .select(ORDER_WITH_ITEMS_SELECT)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo marcar la transferencia como pagada', error, { storeId: p.storeId, orderId: p.orderId })
    throw new Error(`No se pudo marcar la transferencia como pagada: ${error.message}`)
  }
  if (!data) {
    throw new DomainError('Este pedido no existe, no es de pago por transferencia, o ya no está pendiente de pago', {
      status: 409,
    })
  }

  const row = data as unknown as OrderWithItems
  const order = toOrder(row, row.order_items.map(toOrderItem))

  const { error: paymentError } = await admin.from('payments').insert({
    order_id: p.orderId,
    store_id: p.storeId,
    provider: 'transfer',
    provider_payment_id: `order:${p.orderId}`,
    status: 'approved' satisfies PaymentRecordStatus,
    amount_cents: order.totalCents,
    currency: order.currency,
    raw: {
      confirmedBy: p.confirmedBy,
      reference: p.reference,
      receiptSha256: order.transferReceiptSha256,
      receiptSizeBytes: order.transferReceiptSizeBytes,
      receiptMime: order.transferReceiptMime,
    } as Json,
  })

  if (paymentError) {
    if (isUniqueViolationOn(paymentError, ONE_APPROVED_PAYMENT_INDEX)) {
      throw new DomainError('Este pedido ya tiene un pago aprobado registrado', { status: 409 })
    }
    log.error(CTX, 'no se pudo registrar el pago de la transferencia', paymentError, {
      storeId: p.storeId,
      orderId: p.orderId,
    })
    throw new Error(`No se pudo registrar el pago: ${paymentError.message}`)
  }

  return order
}

/**
 * Sube el comprobante de un pedido por transferencia. Quien llama esto NO
 * está logueado: lo único que tiene es el `public_token`, así que todo va con
 * el cliente admin.
 *
 * ORDEN DE OPERACIONES, y el orden importa (00-architecture.md §5.7):
 *   1. Resolver y validar el pedido (token, método, estado, sin comprobante previo).
 *   2. Subir el objeto a Storage.
 *   3. UPDATE con CAS (`transfer_receipt_uploaded_at is null`).
 *   4. Si el CAS pierde, borrar el objeto recién subido (best-effort) y 409.
 *
 * Subir ANTES de escribir la fila, nunca al revés: un objeto huérfano lo barre
 * el cron de purga sin drama; una fila que dice "ya tiene comprobante" cuando
 * en realidad es el de otra request no se puede corregir sola.
 */
export async function storeTransferReceipt(p: {
  token: string
  bytes: Buffer
  mime: 'image/jpeg' | 'application/pdf'
  sha256: string
}): Promise<{ orderId: number; storeId: number }> {
  const parsedToken = orderTokenSchema.safeParse(p.token)
  if (!parsedToken.success) throw new DomainError('No encontramos ese pedido', { status: 404 })

  const admin = createAdminClient()

  const { data: orderRow, error: readError } = await admin
    .from('orders')
    .select('id, store_id, status, payment_method, payment_status, transfer_receipt_uploaded_at')
    .eq('public_token', parsedToken.data)
    .maybeSingle()

  if (readError) {
    log.error(CTX, 'no se pudo leer el pedido para subir el comprobante', readError)
    throw new Error(`No se pudo leer el pedido: ${readError.message}`)
  }
  if (!orderRow) throw new DomainError('No encontramos ese pedido', { status: 404 })
  if (orderRow.payment_method !== 'transfer') {
    throw new DomainError('Este pedido no es de pago por transferencia')
  }
  if (isTerminalStatus(orderRow.status as OrderStatus)) {
    throw new DomainError('Este pedido ya no admite un comprobante')
  }
  if (orderRow.payment_status !== 'pending') {
    throw new DomainError('Este pedido ya no está esperando el pago')
  }
  if (orderRow.transfer_receipt_uploaded_at != null) {
    throw new DomainError(
      'Este pedido ya tiene un comprobante subido. Si necesitás corregirlo, escribinos por WhatsApp.',
      { status: 409 },
    )
  }

  const orderId = orderRow.id
  const storeId = orderRow.store_id
  const path = orderReceiptPath(storeId, orderId)

  const { error: uploadError } = await admin.storage.from(ORDER_RECEIPTS_BUCKET).upload(path, p.bytes, {
    contentType: p.mime,
    upsert: false,
  })
  if (uploadError) {
    log.error(CTX, 'no se pudo subir el comprobante', uploadError, { orderId })
    throw new Error(`No se pudo subir el comprobante: ${uploadError.message}`)
  }

  const { data: updated, error: updateError } = await admin
    .from('orders')
    .update({
      transfer_receipt_path: path,
      transfer_receipt_uploaded_at: new Date().toISOString(),
      transfer_receipt_mime: p.mime,
      transfer_receipt_size: p.bytes.length,
      transfer_receipt_sha256: p.sha256,
    })
    .eq('id', orderId)
    .is('transfer_receipt_uploaded_at', null)
    .select('id')

  if (updateError) {
    // Esto NO es la carrera del CAS: es Postgres fallando después de que el
    // objeto ya subió. Se intenta limpiar el objeto huérfano (best-effort,
    // nunca tapa el error real) y se propaga la falla de verdad.
    await admin
      .storage
      .from(ORDER_RECEIPTS_BUCKET)
      .remove([path])
      .catch(() => undefined)
    log.error(CTX, 'no se pudo registrar el comprobante subido', updateError, { orderId })
    throw new Error(`No se pudo registrar el comprobante: ${updateError.message}`)
  }

  if (!updated || updated.length === 0) {
    // Otra request ganó la carrera entre la validación de arriba y este
    // update: hay un objeto de más. Se borra (best-effort) y se informa 409.
    await admin
      .storage
      .from(ORDER_RECEIPTS_BUCKET)
      .remove([path])
      .catch(() => undefined)
    throw new DomainError(
      'Este pedido ya tiene un comprobante subido. Si necesitás corregirlo, escribinos por WhatsApp.',
      { status: 409 },
    )
  }

  return { orderId, storeId }
}

/**
 * URL firmada de 5 minutos para que el staff mire el comprobante. `null` si el
 * pedido no tiene uno (nunca subió, o ya se purgó). El cliente anónimo NUNCA
 * recibe una URL de estas — la pantalla de seguimiento solo dice "comprobante
 * recibido".
 */
export async function getTransferReceiptSignedUrl(
  storeId: number,
  orderId: number,
): Promise<{ url: string; mime: string } | null> {
  const admin = createAdminClient()
  const { data: orderRow, error } = await admin
    .from('orders')
    .select('transfer_receipt_path, transfer_receipt_mime')
    .eq('id', orderId)
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo leer el comprobante del pedido', error, { storeId, orderId })
    throw new Error(`No se pudo leer el comprobante: ${error.message}`)
  }
  if (!orderRow?.transfer_receipt_path) return null

  const { data: signed, error: signError } = await admin.storage
    .from(ORDER_RECEIPTS_BUCKET)
    .createSignedUrl(orderRow.transfer_receipt_path, 300)

  if (signError || !signed) {
    log.error(CTX, 'no se pudo firmar la URL del comprobante', signError ?? undefined, { storeId, orderId })
    throw new Error(`No se pudo generar el link del comprobante: ${signError?.message ?? 'error desconocido'}`)
  }

  return { url: signed.signedUrl, mime: orderRow.transfer_receipt_mime ?? 'image/jpeg' }
}

/**
 * Pedidos por transferencia esperando una decisión, para la bandeja del KDS.
 *
 * Ordenados con los que YA subieron comprobante primero (`transfer_receipt_uploaded_at`
 * ascendente, nulls al final): son los que esperan que alguien mire la cuenta
 * y confirme, mientras que los que todavía no subieron nada solo están
 * esperando al cliente.
 */
export async function getPendingTransferOrders(storeId: number): Promise<Order[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_WITH_ITEMS_SELECT)
    .eq('store_id', storeId)
    .eq('payment_method', 'transfer')
    .eq('payment_status', 'pending')
    .eq('status', 'pending')
    .order('transfer_receipt_uploaded_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) {
    log.error(CTX, 'no se pudieron leer las transferencias pendientes', error, { storeId })
    throw new Error(`No se pudieron leer las transferencias pendientes: ${error.message}`)
  }
  return ((data ?? []) as unknown as OrderWithItems[]).map((row) => toOrder(row, row.order_items.map(toOrderItem)))
}

/**
 * Comprobantes que ya cumplieron su retención (00-architecture.md §5.8), para
 * el cron de `cleanup`. Es lectura pura: la purga de verdad (borrar el objeto
 * de Storage y RECIÉN DESPUÉS nulear la fila) la orquesta el caller, porque
 * acá no hay forma de borrar un archivo del backend de objetos con SQL.
 */
export async function listPurgeableReceipts(p: {
  paidHours: number
  staleDays: number
}): Promise<{ orderId: number; path: string }[]> {
  const admin = createAdminClient()
  const paidCutoff = new Date(Date.now() - p.paidHours * 60 * 60_000).toISOString()
  const staleCutoff = new Date(Date.now() - p.staleDays * 24 * 60 * 60_000).toISOString()

  const { data, error } = await admin
    .from('orders')
    .select('id, transfer_receipt_path, paid_at, transfer_receipt_uploaded_at')
    .eq('payment_method', 'transfer')
    .not('transfer_receipt_path', 'is', null)
    .or(
      `and(paid_at.not.is.null,paid_at.lte.${paidCutoff}),and(paid_at.is.null,transfer_receipt_uploaded_at.lte.${staleCutoff})`,
    )

  if (error) {
    log.error(CTX, 'no se pudieron listar los comprobantes para purgar', error)
    throw new Error(`No se pudieron listar los comprobantes: ${error.message}`)
  }

  return (data ?? [])
    .filter((row): row is typeof row & { transfer_receipt_path: string } => row.transfer_receipt_path != null)
    .map((row) => ({ orderId: row.id, path: row.transfer_receipt_path }))
}

/**
 * Borra objetos del bucket de comprobantes. Devuelve los paths que
 * EFECTIVAMENTE se borraron — nunca tira: un fallo acá no puede tumbar el
 * cron entero, el próximo tick reintenta lo que haya quedado.
 */
export async function purgeReceiptObjects(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return []
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(ORDER_RECEIPTS_BUCKET).remove(paths)

  if (error) {
    log.error(CTX, 'no se pudieron borrar comprobantes del storage', error, { count: paths.length })
    return []
  }

  // `remove()` devuelve el `name` de cada objeto que efectivamente borró, y
  // coincide con el path COMPLETO que mandamos (verificado a mano contra el
  // bucket real, no asumido de la doc): un path que ya no existía no aparece
  // acá, así que el filtro es correcto sin lógica extra.
  return (data ?? []).map((f) => f.name)
}

/**
 * Nulea la referencia al archivo YA borrado. Nunca toca
 * `transfer_receipt_uploaded_at`: es el registro durable de "este pedido ya
 * usó su oportunidad", y el trigger lo bloquearía igual si se intentara
 * (`check_violation`) — no hace falta un `if` acá, es una invariante de base.
 */
export async function clearReceiptRefs(orderIds: number[]): Promise<void> {
  if (orderIds.length === 0) return
  const admin = createAdminClient()
  const { error } = await admin
    .from('orders')
    .update({ transfer_receipt_path: null, transfer_receipt_mime: null })
    .in('id', orderIds)

  if (error) {
    log.error(CTX, 'no se pudo limpiar la referencia al comprobante purgado', error, { count: orderIds.length })
    throw new Error(`No se pudo limpiar la referencia al comprobante: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// 8. Dashboard del local — vía RPC `store_dashboard`. PostgREST corta
//    cualquier respuesta en `max_rows` (1000) sin avisar, así que agregar en
//    TypeScript truncaba la facturación en silencio para cualquier local con
//    más de ~33 pedidos/día. Ahora Postgres agrega y acá solo se completan con
//    cero los estados que la RPC no devolvió, para que ORDER_STATUSES siga
//    siendo la única fuente del enum completo.
// ---------------------------------------------------------------------------

export async function getStoreDashboard(storeId: number, days = 30): Promise<StoreDashboard> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('store_dashboard', { p_store_id: storeId, p_days: days })

  if (error) {
    log.error(CTX, 'no se pudo leer el dashboard del local', error, { storeId, days })
    throw new Error(`No se pudo leer el dashboard: ${error.message}`)
  }

  const rpc = data as unknown as StoreDashboardRpc

  const ordersByStatus = Object.fromEntries(
    ORDER_STATUSES.map((s) => [s, rpc.ordersByStatus[s] ?? 0]),
  ) as Record<OrderStatus, number>

  return {
    salesByDay: rpc.salesByDay as SalesPoint[],
    topProducts: rpc.topProducts as TopProduct[],
    ordersByStatus,
    averageTicketCents: rpc.averageTicketCents,
    prepAccuracy: rpc.prepAccuracy,
  }
}
