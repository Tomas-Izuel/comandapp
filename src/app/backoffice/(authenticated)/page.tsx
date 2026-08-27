import type { Metadata } from 'next'
import Link from 'next/link'
import { getPlatformMetrics } from '@/models/platform.model'
import { PlatformMetricsList } from '@/views/backoffice/metrics-list'
import { EmptyState } from '@/views/shared/states'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Métricas — Backoffice' }

export default async function BackofficeDashboardPage() {
  const metrics = await getPlatformMetrics()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Métricas</h1>

      {metrics.totalStores === 0 ? (
        <EmptyState
          title="Todavía no hay tiendas"
          description="Las métricas de la plataforma aparecen acá una vez que exista al menos un local dado de alta."
          action={
            <Button asChild size="lg">
              <Link href="/backoffice/tiendas/nueva">Dar de alta la primera tienda</Link>
            </Button>
          }
        />
      ) : (
        <PlatformMetricsList metrics={metrics} />
      )}
    </div>
  )
}
