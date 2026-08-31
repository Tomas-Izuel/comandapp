import { redirect } from 'next/navigation'
import { resolveAdminSession, getPaymentConnectionStatus } from '@/controllers/admin.controller'
import { getActiveOrders, getPendingTransferOrders } from '@/models/order.model'
import { getAdminCatalog } from '@/models/catalog.model'
import { KdsBoard, type OnboardingStatus } from '@/views/admin/kds/board'

/**
 * `/admin` — panel de cocina. Es la pantalla por defecto del slice: todo lo
 * demás es secundario frente a esto durante la hora pico.
 */
export default async function AdminKitchenPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  // Corren en paralelo: son dos lecturas independientes del mismo store, y una
  // no depende del resultado de la otra.
  const [orders, transferOrders] = await Promise.all([
    getActiveOrders(session.store.id),
    getPendingTransferOrders(session.store.id),
  ])

  // El onboarding solo se calcula cuando hace falta: si ya hay pedidos activos,
  // el local claramente ya vende, y las dos consultas extra son trabajo tirado.
  let onboarding: OnboardingStatus | null = null
  if (orders.length === 0) {
    const [catalog, payment] = await Promise.all([
      getAdminCatalog(session.store.id),
      getPaymentConnectionStatus(session.store.id),
    ])
    const hasProducts = catalog.some((category) => category.products.length > 0)
    const missingCatalog = !hasProducts
    const missingPayment = !session.store.inStorePaymentEnabled && !payment.connected
    onboarding = missingCatalog || missingPayment ? { missingCatalog, missingPayment } : null
  }

  return (
    <KdsBoard
      storeId={session.store.id}
      storeName={session.store.name}
      timezone={session.store.timezone}
      currency={session.store.currency}
      initialOrders={orders}
      initialTransferOrders={transferOrders}
      onboarding={onboarding}
      autoStartOrders={session.store.autoStartOrders}
      autoReadyOrders={session.store.autoReadyOrders}
      // Decide si el tablero dibuja la columna "En camino". Una columna siempre
      // vacía se come un cuarto de la pantalla del que cocina.
      deliveryEnabled={session.store.delivery.enabled}
    />
  )
}
