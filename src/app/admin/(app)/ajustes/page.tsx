import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getStoreHoursData } from '@/models/store-hours.model'
import { getMaxPrepMinutes } from '@/models/catalog.model'
import { PageFrame } from '@/views/admin/page-frame'
import { SettingsForm } from '@/views/admin/ajustes/settings-form'
import { ScheduleEditor } from '@/views/admin/ajustes/schedule-editor'

export default async function AdminSettingsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  // Lecturas planas de modelo directo desde la page (mismo criterio que
  // `pedidos/page.tsx` con `getOrderHistory`): no hay nada que orquestar acá,
  // ninguna de las dos necesita más que el `storeId` ya resuelto.
  const [schedule, maxPrepMinutes] = await Promise.all([
    getStoreHoursData(session.store.id),
    getMaxPrepMinutes(session.store.id),
  ])

  return (
    <PageFrame title="Ajustes" width="form">
      <div className="flex flex-col gap-10">
        <SettingsForm storeId={session.store.id} store={session.store} role={session.role} />
        <ScheduleEditor
          storeId={session.store.id}
          timezone={session.store.timezone}
          currency={session.store.currency}
          schedule={schedule}
          maxPrepMinutes={maxPrepMinutes}
        />
      </div>
    </PageFrame>
  )
}
