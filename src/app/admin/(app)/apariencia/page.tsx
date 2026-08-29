import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getStoreById } from '@/models/store.model'
import { BrandingForm } from '@/views/admin/apariencia/branding-form'
import { PageFrame } from '@/views/admin/page-frame'

export default async function AdminAppearancePage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const store = await getStoreById(session.store.id)
  if (!store) redirect('/admin/acceso')

  return (
    <PageFrame
      title="Apariencia"
      description="Color, tipografía y radio de tu marca. La vista previa de al lado es la carta real: lo que ves es lo que ve tu cliente."
      width="table"
    >
      <BrandingForm storeId={session.store.id} storeSlug={store.slug} storeName={store.name} initialBranding={store.branding} />
    </PageFrame>
  )
}
