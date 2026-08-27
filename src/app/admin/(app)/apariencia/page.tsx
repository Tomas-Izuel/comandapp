import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getStoreById } from '@/models/store.model'
import { BrandingForm } from '@/views/admin/apariencia/branding-form'

export default async function AdminAppearancePage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const store = await getStoreById(session.store.id)
  if (!store) redirect('/admin/acceso')

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Apariencia</h1>
      <BrandingForm storeId={session.store.id} storeName={store.name} initialBranding={store.branding} />
    </div>
  )
}
