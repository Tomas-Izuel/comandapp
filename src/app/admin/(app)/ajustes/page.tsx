import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { PageFrame } from '@/views/admin/page-frame'
import { SettingsForm } from '@/views/admin/ajustes/settings-form'

export default async function AdminSettingsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  return (
    <PageFrame title="Ajustes" width="form">
      <SettingsForm storeId={session.store.id} store={session.store} role={session.role} />
    </PageFrame>
  )
}
