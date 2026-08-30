import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { ProfileForm } from '@/views/admin/ajustes/profile-form'

/**
 * "El local": datos, dirección + mapa, canales. Ya no pide `getStoreHoursData`
 * ni `getMaxPrepMinutes` — eso quedó en `horarios/page.tsx`, que es la única
 * que los necesita (00-architecture.md).
 */
export default async function AdminSettingsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  return <ProfileForm storeId={session.store.id} store={session.store} />
}
