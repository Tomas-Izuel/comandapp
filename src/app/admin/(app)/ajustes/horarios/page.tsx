import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getStoreHoursData } from '@/models/store-hours.model'
import { getMaxPrepMinutes } from '@/models/catalog.model'
import { ScheduleEditor } from '@/views/admin/ajustes/schedule-editor'

/**
 * "Horarios": horario semanal + excepciones por fecha. Es la única de las
 * tres páginas de Ajustes que pide `getStoreHoursData` y `getMaxPrepMinutes`
 * — las otras dos dejaron de cargarlas, ese es parte del beneficio del corte
 * (00-architecture.md). También es la única sin `SaveBar`: `ScheduleEditor`
 * se guarda solo, vía RPC transaccional, y esa ausencia ahora significa algo.
 */
export default async function AdminScheduleSettingsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  // Lecturas planas de modelo directo desde la page (mismo criterio que
  // `pedidos/page.tsx` con `getOrderHistory`): no hay nada que orquestar acá.
  const [schedule, maxPrepMinutes] = await Promise.all([
    getStoreHoursData(session.store.id),
    getMaxPrepMinutes(session.store.id),
  ])

  return (
    <ScheduleEditor
      storeId={session.store.id}
      timezone={session.store.timezone}
      currency={session.store.currency}
      schedule={schedule}
      maxPrepMinutes={maxPrepMinutes}
    />
  )
}
