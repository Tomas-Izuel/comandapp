import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { SettingsForm } from '@/views/admin/ajustes/settings-form'

export default async function AdminSettingsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Ajustes</h1>
      <SettingsForm storeId={session.store.id} store={session.store} />
    </div>
  )
}
