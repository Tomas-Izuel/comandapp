'use client'

import { useRouter } from 'next/navigation'
import { Bike } from 'lucide-react'
import { Panel } from '@/views/shared/surfaces'
import { PanelHeading } from '@/views/admin/page-frame'
import { EmptyState } from '@/views/shared/states'
import { InviteCourierForm } from './invite-courier-form'
import { CourierRow } from './courier-row'
import type { CourierRow as CourierRowType } from '@/models/types'

/**
 * Orquesta la sección entera: el form de invitación arriba (que dispara
 * `router.refresh()` para traer al recién invitado sin recargar la página a
 * mano) y el listado abajo, con el estado de onboarding cuando todavía no
 * hay nadie.
 */
export function CourierManager({
  storeId,
  couriers,
  currency,
  courierCollects,
}: {
  storeId: number
  couriers: CourierRowType[]
  currency: string
  courierCollects: boolean
}) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-6">
      <InviteCourierForm storeId={storeId} onInvited={() => router.refresh()} />

      <Panel className="p-4 sm:p-5">
        <PanelHeading title="Tu equipo de reparto" />

        {couriers.length === 0 ? (
          // Onboarding, no un vacío: explica para qué sirve esto antes de que
          // el dueño haya usado la sección ni una vez.
          <EmptyState
            icon={<Bike className="size-8" />}
            title="Todavía no invitaste a ningún repartidor"
            description="Invitalo con su nombre y su email de arriba. Va a recibir un mail para entrar a ver y entregar los pedidos de delivery del local."
          />
        ) : (
          <div className="divide-border divide-y">
            {couriers.map((courier) => (
              <CourierRow
                key={courier.id}
                storeId={storeId}
                courier={courier}
                currency={currency}
                courierCollects={courierCollects}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
