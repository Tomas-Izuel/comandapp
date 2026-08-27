import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { AdminShell } from '@/views/admin/shell'

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
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-[45ch] text-center">
          <p className="text-2xl font-semibold tracking-tight">Todavía no tenés un local asignado</p>
          <p className="text-muted-foreground mt-3 text-sm">
            Entraste como <span className="text-foreground font-medium">{session.email}</span>, pero
            ninguna tienda te tiene como staff. Pedile al dueño del local que te agregue.
          </p>
        </div>
      </div>
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
