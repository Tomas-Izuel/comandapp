import { redirect } from 'next/navigation'
import Link from 'next/link'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { AdminShell, AdminBareChrome } from '@/views/admin/shell'
import { Button } from '@/components/ui/button'

/**
 * Todo lo autenticado del panel vive bajo este grupo de rutas. `/admin/acceso`
 * y su callback quedan afuera a propósito: no tienen sesión que resolver.
 *
 * `proxy.ts` solo refresca cookies — la autorización real pasa acá, en cada
 * request, con `resolveAdminSession()`.
 */
export default async function AdminAppLayout({ children }: LayoutProps<'/admin'>) {
  const session = await resolveAdminSession()

  if (session.status === 'unauthenticated') {
    redirect('/admin/acceso')
  }

  if (session.status === 'no-store') {
    // Un repartidor NO es staff (S-A11: `is_store_member` filtra por
    // `role in ('owner','staff')`), así que llega hasta acá con exactamente
    // la misma sesión con la que entraría a `/repartidor`. Mandarlo a "pedile
    // al dueño que te agregue" sería mentirle: ya está agregado, en el
    // portal que no es. Este mensaje reemplaza al genérico, nunca lo suma.
    if (session.isCourier) {
      return (
        <AdminBareChrome>
          <div className="max-w-[52ch] text-center">
            <p className="text-foreground text-lg font-semibold">Este es el panel del local</p>
            <p className="text-muted-foreground mt-2 text-sm">
              Entraste como <span className="text-foreground font-medium">{session.email}</span>, y tu
              acceso es el portal del repartidor, no este panel.
            </p>
            <Button asChild className="mt-4 h-11">
              <Link href="/repartidor">Ir a mi portal</Link>
            </Button>
          </div>
        </AdminBareChrome>
      )
    }

    return (
      <AdminBareChrome>
        <div className="max-w-[52ch] text-center">
          <p className="text-foreground text-lg font-semibold">Todavía no tenés un local asignado</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Entraste como <span className="text-foreground font-medium">{session.email}</span>, pero
            ninguna tienda te tiene como staff. Pedile al dueño del local que te agregue.
          </p>
        </div>
      </AdminBareChrome>
    )
  }

  return (
    <AdminShell
      storeName={session.store.name}
      role={session.role}
      email={session.email}
      storeStatus={session.store.status}
    >
      {children}
    </AdminShell>
  )
}
