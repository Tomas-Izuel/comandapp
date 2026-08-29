import { redirect } from 'next/navigation'
import { resolveStaffSession } from '@/controllers/staff.controller'
import { PageFrame } from '@/views/admin/page-frame'
import { CourierManager } from '@/views/admin/repartidores/courier-manager'

export default async function RepartidoresPage() {
  const session = await resolveStaffSession()

  if (session.status === 'unauthenticated' || session.status === 'no-store') redirect('/admin/acceso')
  // Esta sección es solo del dueño (ver `staff.controller.ts`): un encargado
  // que llegue acá por URL directa vuelve al inicio del panel en vez de ver
  // un 403 sin contexto.
  if (session.status === 'forbidden') redirect('/admin')

  return (
    <PageFrame
      title="Repartidores"
      description="Invitá a quienes reparten los pedidos de delivery de tu local. Solo vos, como dueño, podés darlos de alta o de baja."
      width="table"
    >
      <CourierManager storeId={session.storeId} couriers={session.couriers} />
    </PageFrame>
  )
}
