import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getCustomerDirectoryForStore } from '@/controllers/customers.controller'
import { getCouponsForStore } from '@/controllers/marketing.controller'
import { CustomerDirectoryView } from '@/views/admin/clientes/customer-directory'

// Mismo sufijo que `admin/acceso/page.tsx` ("Pedir acceso — Panel del
// local"): es el único precedente de metadata propia dentro de `/admin` en
// todo el repo. Ninguna otra sección (`repartidores`, `pagos`, `ajustes`,
// `dashboard`, `catalogo`, la Cocina) declara la suya, así que hoy TODAS
// heredan el `title: 'Pedidos'` del `layout.tsx` raíz — verificado en el
// browser con sesión real, no es un problema exclusivo de esta ruta. Ese
// hueco panel-wide queda fuera de este slice (no soy dueño de esos
// archivos); acá solo cierro el de `/admin/clientes`.
export const metadata: Metadata = {
  title: 'Clientes — Panel del local',
}

/**
 * El padrón (T2A). Solo del dueño (§5.11.1): muestra cuánto gastó cada
 * cliente, que es información de caja — mismo criterio que Repartidores.
 * Un `staff` que entra por URL directa vuelve al inicio del panel, mismo
 * patrón que `repartidores/page.tsx`.
 */
export default async function ClientesPage() {
  const session = await resolveAdminSession()

  if (session.status !== 'ok') redirect('/admin/acceso')
  if (session.role !== 'owner') redirect('/admin')

  // Los cupones viajan con el padrón porque el botón de WhatsApp de cada fila
  // ofrece mandar uno, y ése es el ÚNICO camino por el que un cupón llega a un
  // cliente sin gastar cupo de mail (§5.5.1). A 15 mails de campaña por día, es
  // el que más se va a usar.
  //
  // En paralelo: son dos lecturas independientes y la del padrón es la lenta.
  const [directory, coupons] = await Promise.all([
    getCustomerDirectoryForStore(session.store.id),
    getCouponsForStore(session.store.id),
  ])

  // El filtro es por `status`, no por `couponState()`: acá alcanza con lo que el
  // dueño prendió. Un cupón vencido o agotado igual no serviría, pero eso lo
  // decide el menú, que ya tiene los contadores y las fechas en la fila.
  const activeCoupons = coupons.filter((c) => c.status === 'active')

  return (
    <CustomerDirectoryView
      storeId={session.store.id}
      storeName={session.store.name}
      storeSlug={session.store.slug}
      timezone={session.store.timezone}
      currency={session.store.currency}
      directory={directory}
      activeCoupons={activeCoupons}
    />
  )
}
