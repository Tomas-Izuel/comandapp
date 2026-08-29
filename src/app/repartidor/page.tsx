import { redirect } from 'next/navigation'
import { resolveCourierSession } from '@/controllers/courier.controller'
import { CourierChrome } from '@/views/courier/chrome'
import { DeliveryQueue } from '@/views/courier/delivery-queue'
import { EmptyState } from '@/views/shared/states'

/**
 * La cola de entregas. Resuelve la sesión ACÁ, no en el layout: `layout.tsx`
 * de este segmento envuelve también `/repartidor/acceso`, así que un gate ahí
 * redirigiría un `unauthenticated` a `/repartidor/acceso` y volvería a
 * gatearse solo — un loop. Este patrón es el mismo de `/admin/(app)/layout.tsx`,
 * solo que ahí el grupo de rutas separa el gate de `/admin/acceso`; acá el
 * archivo de arriba lista `layout.tsx` como único, así que el gate baja un
 * nivel, al único lugar donde SÍ hay un solo dueño de la decisión.
 */
export default async function CourierPage() {
  const session = await resolveCourierSession()

  if (session.status === 'unauthenticated') {
    redirect('/repartidor/acceso')
  }

  if (session.status === 'not-a-courier') {
    return (
      <CourierChrome email={session.email}>
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            title="No encontramos tu acceso"
            description={`Entraste como ${session.email}, pero ningún local te tiene como repartidor activo ahora mismo. Si te acaban de invitar, esperá el link o pedile al local que revise tu alta.`}
          />
        </div>
      </CourierChrome>
    )
  }

  return (
    <CourierChrome courierName={session.courierName} email={session.email}>
      <DeliveryQueue initialOrders={session.orders} />
    </CourierChrome>
  )
}
