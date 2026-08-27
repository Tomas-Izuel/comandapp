import type { Metadata } from 'next'
import Link from 'next/link'
import { listAudit } from '@/models/platform.model'
import { AuditTable } from '@/views/backoffice/audit-table'
import { EmptyState } from '@/views/shared/states'
import { Panel } from '@/views/shared/surfaces'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Auditoría — Backoffice' }

const PAGE_SIZE = 50

export default async function BackofficeAuditPage(props: PageProps<'/backoffice/auditoria'>) {
  const searchParams = await props.searchParams
  const rawLimit = typeof searchParams.limit === 'string' ? Number(searchParams.limit) : PAGE_SIZE
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : PAGE_SIZE

  const entries = await listAudit(limit)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Auditoría</h1>
        <p className="text-muted-foreground max-w-[65ch] text-sm">
          Todo lo que pasa por el backoffice queda acá: altas, cambios de estado, y quién los hizo. Nunca datos de
          pedidos de clientes.
        </p>
      </div>

      {entries.length === 0 ? (
        <EmptyState title="Sin actividad todavía" description="Cada alta o suspensión que hagas va a aparecer acá." />
      ) : (
        <div className="flex flex-col items-start gap-4">
          <Panel elevated={false} className="w-full overflow-hidden p-0">
            <AuditTable entries={entries} />
          </Panel>
          {entries.length >= limit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/backoffice/auditoria?limit=${limit + PAGE_SIZE}`}>Ver más</Link>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
