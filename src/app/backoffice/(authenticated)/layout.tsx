import { requireBackofficeSession } from '@/controllers/platform.controller'
import { BackofficeShell } from '@/views/backoffice/shell'

export default async function BackofficeAuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireBackofficeSession()

  return <BackofficeShell identity={identity}>{children}</BackofficeShell>
}
