import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveryFeeFor, deliveryMinutesFor } from '@/lib/delivery'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { formatCentsCompact, scaleUpInt, sumCents } from '@/lib/money'
import { productImageUrl } from '@/lib/storage'
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
  Store,
  StoreDashboard,
  StoreDashboardRpc,
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
  if (parsed.paymentMethod === 'in_store' && !storeRow.in_store_payment_enabled) {
    throw new DomainError('Esta tienda no acepta pago al retirar')
  }

  const store = toStore(storeRow)

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
    const availability = await getCourierAvailability(store.id)
    deliveryMinutes = deliveryMinutesFor(store.delivery, availability.freeCouriers)
  }

  const eta = await estimateEta(store, priced.basePrepMinutes, deliveryMinutes ?? 0)

  const isOnline = parsed.paymentMethod === 'online'
  const initialStatus: OrderStatus = isOnline ? 'pending' : 'confirmed'
  const etaAt = new Date(Date.now() + eta.etaMinutes * 60_000).toISOString()

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
    demand_multiplier: eta.multiplier,
    eta_minutes: eta.etaMinutes,
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

  return toOrderPublicView(data as unknown as OrderWithItemsAndStore)
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

  // Regla de negocio, no de estado: la comida no sale sin plata asegurada.
  // Un pedido online impago no puede entrar a la cocina; el de pago en el local
  // sí, porque ahí el compromiso de cobro es presencial.
  if (
    target === 'confirmed' &&
    current.payment_method === 'online' &&
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
    .select('store_id, base_prep_minutes, delivery_method')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !orderRow || orderRow.base_prep_minutes == null) {
    log.error(CTX, 'no se pudo releer el pedido para recalcular el ETA', orderError ?? undefined, { orderId })
    return
  }

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
