import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getCouponsForStore, getCouponDetailForStore, getCampaignsForStore } from '@/controllers/marketing.controller'
import { CuponesView } from '@/views/admin/clientes/cupones/cupones-view'
import type { CouponDetail } from '@/models/types'

export const metadata: Metadata = {
  title: 'Cupones — Panel del local',
}

/**
 * La tab de Cupones (T4B). Solo del dueño (§5.11.1), mismo criterio que el
 * padrón: un cupón es plata y una campaña habla en nombre de la marca.
 *
 * `getCouponDetailForStore` no tiene una Server Action de lectura bajo
 * demanda (no es archivo de este slice agregarle una a `marketing.actions.ts`),
 * así que en vez de que la hoja de detalle haga un fetch al abrirse —lo que
 * violaría "las views nunca fetchean"— esta page trae el detalle de TODOS los
 * cupones de una vez, en paralelo. Para el volumen de cupones de un local
 * (una lista de promociones, no un catálogo) esto es liviano; si el día de
 * mañana un local tiene cientos de cupones activos a la vez, ahí sí conviene
 * una Server Action de detalle bajo demanda — reportado en el dev log de T4B.
 */
export default async function CuponesPage() {
  const session = await resolveAdminSession()

  if (session.status !== 'ok') redirect('/admin/acceso')
  if (session.role !== 'owner') redirect('/admin')

  const [coupons, campaigns] = await Promise.all([
    getCouponsForStore(session.store.id),
    getCampaignsForStore(session.store.id),
  ])

  const details: CouponDetail[] = await Promise.all(
    coupons.map((coupon) => getCouponDetailForStore(session.store.id, coupon.id)),
  )

  return (
    <CuponesView
      storeId={session.store.id}
      storeName={session.store.name}
      timezone={session.store.timezone}
      currency={session.store.currency}
      coupons={details}
      campaigns={campaigns}
      paymentAvailability={{
        online: session.store.onlinePaymentEnabled,
        transfer: session.store.transferPaymentEnabled,
        in_store: session.store.inStorePaymentEnabled,
      }}
    />
  )
}
