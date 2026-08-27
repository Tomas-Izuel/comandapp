import { redirect } from 'next/navigation'
import dynamic from 'next/dynamic'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getStoreDashboard } from '@/models/order.model'
import { formatCentsCompact } from '@/lib/money'
import { EmptyState } from '@/views/shared/states'
import { TopProducts } from '@/views/admin/dashboard/top-products'
import { OrdersByStatusBreakdown } from '@/views/admin/dashboard/orders-by-status'
import { PrepAccuracy } from '@/views/admin/dashboard/prep-accuracy'
import { StatRow } from '@/views/admin/dashboard/stat-summary'

/**
 * `recharts` son ~100 KB gz que el dueño no necesita para ver la cocina o el
 * catálogo: se cargan solo cuando entra a Métricas, y mientras tanto el hueco
 * del gráfico ya se ve como el resto de la página en vez de saltar en blanco.
 */
const SalesChart = dynamic(() => import('@/views/admin/dashboard/sales-chart').then((m) => m.SalesChart), {
  loading: () => (
    <div className="grid gap-8 sm:grid-cols-2">
      <div className="bg-muted h-[204px] animate-pulse rounded-lg" />
      <div className="bg-muted h-[204px] animate-pulse rounded-lg" />
    </div>
  ),
})

export default async function AdminDashboardPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const dashboard = await getStoreDashboard(session.store.id)
  const totalOrders = dashboard.salesByDay.reduce((sum, day) => sum + day.orders, 0)
  const totalRevenueCents = dashboard.salesByDay.reduce((sum, day) => sum + day.revenueCents, 0)
  const currency = session.store.currency

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Métricas</h1>

      {totalOrders === 0 ? (
        <EmptyState
          title="Todavía no hay ventas"
          description="En cuanto entren los primeros pedidos, la facturación, el ranking de productos y la precisión de la cocina van a aparecer acá."
          className="py-12"
        />
      ) : (
        <>
          <StatRow
            columns={3}
            items={[
              { label: 'Pedidos · 30 días', value: String(totalOrders) },
              { label: 'Facturación · 30 días', value: formatCentsCompact(totalRevenueCents, currency) },
              { label: 'Ticket promedio', value: formatCentsCompact(dashboard.averageTicketCents, currency) },
            ]}
          />

          <section>
            <h2 className="mb-3 text-lg font-semibold">Ventas de los últimos 30 días</h2>
            <SalesChart data={dashboard.salesByDay} currency={currency} />
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold">Preparación real vs. estimada</h2>
            <p className="text-muted-foreground mb-3 text-sm">
              De confirmado a listo, contra lo que promete el catálogo.
            </p>
            <PrepAccuracy prepAccuracy={dashboard.prepAccuracy} />
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 text-lg font-semibold">Productos más pedidos</h2>
              <TopProducts products={dashboard.topProducts} currency={currency} />
            </section>
            <section>
              <h2 className="mb-3 text-lg font-semibold">Pedidos por estado</h2>
              <OrdersByStatusBreakdown counts={dashboard.ordersByStatus} />
            </section>
          </div>
        </>
      )}
    </div>
  )
}
