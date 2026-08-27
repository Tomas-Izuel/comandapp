/**
 * Vocabulario compartido de todo el dominio.
 *
 * Solo tipos: ninguna función, ningún import de runtime. Es el contrato que
 * models, controllers y views usan para hablar entre sí. Si algo cambia de
 * forma, se cambia acá y TypeScript señala cada lugar que hay que tocar.
 *
 * Todos los montos son CENTAVOS enteros. Ver src/lib/money.ts.
 */

import type { Branding } from '@/models/schemas/branding.schema'
import type {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/models/schemas/order.schema'

// ---------------------------------------------------------------------------
// Tienda
// ---------------------------------------------------------------------------

/**
 * Re-export de los enums del dominio.
 *
 * `types.ts` es el vocabulario compartido, así que tiene que poder nombrar un
 * estado sin obligar a cada consumidor a saber en qué archivo de schema vive.
 */
export type { OrderStatus, PaymentMethod, PaymentStatus }

export type StoreStatus = 'active' | 'suspended'

export type Store = {
  id: number
  slug: string
  name: string
  description: string | null
  phoneE164: string | null
  whatsappPhoneE164: string | null
  /** Dirección del LOCAL. Es dónde el cliente va a retirar, así que no es opcional para él. */
  address: string | null
  timezone: string
  currency: string
  status: StoreStatus
  acceptingOrders: boolean
  inStorePaymentEnabled: boolean
  minOrderCents: number
  demandThresholdOrders: number
  demandMultiplier: number
}

export type StoreWithBranding = Store & { branding: Branding }

export type StoreMember = {
  id: number
  storeId: number
  userId: string
  role: 'owner' | 'staff'
  createdAt: string
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type MenuOption = {
  id: number
  name: string
  priceDeltaCents: number
  isAvailable: boolean
  position: number
}

export type MenuOptionGroup = {
  id: number
  name: string
  minSelect: number
  maxSelect: number
  position: number
  options: MenuOption[]
}

export type MenuProduct = {
  id: number
  categoryId: number | null
  name: string
  description: string | null
  imagePath: string | null
  imageUrl: string | null
  priceCents: number
  prepMinutes: number
  isAvailable: boolean
  position: number
  optionGroups: MenuOptionGroup[]
}

export type MenuCategory = {
  id: number
  name: string
  position: number
  isActive: boolean
  products: MenuProduct[]
}

export type Menu = {
  store: StoreWithBranding
  categories: MenuCategory[]
}

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

export type OrderItemOption = {
  id: number
  optionId: number | null
  nameSnapshot: string
  groupSnapshot: string | null
  priceDeltaCents: number
}

export type OrderItem = {
  id: number
  productId: number | null
  nameSnapshot: string
  unitPriceCents: number
  quantity: number
  totalCents: number
  prepMinutes: number
  notes: string | null
  options: OrderItemOption[]
}

export type Order = {
  id: number
  storeId: number
  shortCode: string
  publicToken: string
  status: OrderStatus
  customerName: string
  customerPhoneE164: string
  customerEmail: string | null
  notes: string | null
  currency: string
  subtotalCents: number
  totalCents: number
  basePrepMinutes: number | null
  demandMultiplier: number | null
  etaMinutes: number | null
  etaAt: string | null
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  preferenceId: string | null
  /** Cuándo deja de servir el link de pago. Lo devuelve Mercado Pago al crear la preferencia. */
  preferenceExpiresAt: string | null
  paymentRef: string | null
  externalRef: string | null
  confirmedAt: string | null
  paidAt: string | null
  readyAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  /** Cola de "plata que hay que devolver": se llena cuando el pago sobrevive al pedido. */
  needsRefundAt: string | null
  refundReason: string | null
  refundedAt: string | null
  createdAt: string
  items: OrderItem[]
}

/** Lo que ve el cliente en /pedido/[token] y en "mis pedidos". */
export type OrderPublicView = Pick<
  Order,
  | 'shortCode'
  | 'publicToken'
  | 'status'
  | 'customerName'
  | 'currency'
  | 'subtotalCents'
  | 'totalCents'
  | 'etaMinutes'
  | 'etaAt'
  | 'paymentMethod'
  | 'paymentStatus'
  | 'paidAt'
  | 'readyAt'
  | 'createdAt'
  | 'items'
> & {
  storeName: string
  storeSlug: string
  /**
   * Si el cliente todavia puede ir a pagar. La URL NO viaja acá a proposito: se
   * pide con `resumePaymentAction`, que la resuelve (o regenera la preferencia
   * si vencio) contra Mercado Pago en el momento. Un init_point guardado en la
   * vista publica se queda viejo justo cuando hace falta.
   */
  canResumePayment: boolean
}

/**
 * Resultado del cálculo de demora. `multiplier` es 1 cuando la cocina no está
 * saturada; cuando lo está, es el multiplicador configurado por la tienda.
 */
export type EtaEstimate = {
  baseMinutes: number
  multiplier: number
  etaMinutes: number
  activeOrders: number
  isBusy: boolean
}

/** Un ítem del carrito ya valorizado CONTRA LA BASE, nunca contra el cliente. */
export type PricedItem = {
  productId: number
  name: string
  /**
   * La foto de la línea del carrito. Viaja acá y no se resuelve en la vista
   * porque el carrito del browser guarda SOLO `{productId, quantity, optionIds,
   * notes}`: no tiene con qué armar la URL. Sin esto el carrito rediseñado
   * mostraba marcos de foto vacíos, que es exactamente lo que el rediseño
   * vino a sacar.
   */
  imageUrl: string | null
  quantity: number
  unitPriceCents: number
  totalCents: number
  prepMinutes: number
  notes: string | null
  options: { optionId: number; name: string; groupName: string; priceDeltaCents: number }[]
}

export type PricedCart = {
  items: PricedItem[]
  subtotalCents: number
  totalCents: number
  basePrepMinutes: number
}

// ---------------------------------------------------------------------------
// Plataforma (backoffice)
// ---------------------------------------------------------------------------

export type PlatformStoreRow = Store & {
  ownerEmail: string | null
  ordersLast30: number
  revenueLast30Cents: number
  createdAt: string
}

export type PlatformMetrics = {
  totalStores: number
  activeStores: number
  ordersLast30: number
  revenueLast30Cents: number
  ordersToday: number
}

export type AuditEntry = {
  id: number
  actorEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  payload: Record<string, unknown>
  ip: string | null
  userAgent: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Dashboard del local
// ---------------------------------------------------------------------------

export type SalesPoint = { date: string; orders: number; revenueCents: number }

export type TopProduct = { productId: number | null; name: string; quantity: number; revenueCents: number }

/**
 * Lo que devuelve `public.store_dashboard`. La agregacion vive en Postgres: en
 * TypeScript se topaba con `max_rows` de PostgREST (1000 filas) y truncaba la
 * facturacion en silencio. `ordersByStatus` llega solo con los estados
 * presentes; el enum completo con ceros lo completa el modelo, para que
 * ORDER_STATUSES siga siendo la unica fuente.
 */
export type StoreDashboardRpc = {
  salesByDay: SalesPoint[]
  topProducts: TopProduct[]
  ordersByStatus: Partial<Record<OrderStatus, number>>
  averageTicketCents: number
  prepAccuracy: { avgRealMinutes: number; avgEstimatedMinutes: number; sampleSize: number }
}

export type StoreDashboard = {
  salesByDay: SalesPoint[]
  topProducts: TopProduct[]
  ordersByStatus: Record<OrderStatus, number>
  averageTicketCents: number
  /** Minutos reales de preparación (paid_at → ready_at) vs lo que estimamos. */
  prepAccuracy: { avgRealMinutes: number; avgEstimatedMinutes: number; sampleSize: number }
}

// ---------------------------------------------------------------------------
// Resultado uniforme para Server Actions
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
