import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { OrderingForm } from '@/views/admin/ajustes/ordering-form'

/**
 * "Pedidos y envío": tomando pedidos, pago en el local, envío propio,
 * programados, multiplicador de demanda. No pide `getStoreHoursData` ni
 * `getMaxPrepMinutes`: esas quedaron en `horarios/page.tsx`.
 */
export default async function AdminOrderingSettingsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  return <OrderingForm storeId={session.store.id} store={session.store} role={session.role} />
}
