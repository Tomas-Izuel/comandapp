import { redirect } from 'next/navigation'
import dynamic from 'next/dynamic'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getStoreDashboard } from '@/models/order.model'
import { formatCentsCompact } from '@/lib/money'
import { Panel } from '@/views/shared/surfaces'
import { EmptyState } from '@/views/shared/states'
import { PageFrame, PanelHeading } from '@/views/admin/page-frame'
import { TopProducts } from '@/views/admin/dashboard/top-products'
import { OrdersByStatusBreakdown } from '@/views/admin/dashboard/orders-by-status'
import { PrepAccuracy } from '@/views/admin/dashboard/prep-accuracy'
import { StatRow } from '@/views/admin/dashboard/stat-summary'

/**
 * `recharts` son ~100 KB gz que el dueño no necesita para ver la cocina o el
 * catálogo: se cargan solo cuando entra a Métricas, y mientras tanto el hueco
 * del gráfico ya se ve como el resto de la página en vez de saltar en blanco.
 * La altura del esqueleto (180/220px) tiene que calzar con la del gráfico
 * real en `sales-chart.tsx` para que no salte al montar.
 */
const SalesChart = dynamic(() => import('@/views/admin/dashboard/sales-chart').then((m) => m.SalesChart), {
  loading: () => (
    <div className="grid gap-8 sm:grid-cols-2">
      <div className="bg-muted h-[180px] animate-pulse rounded-lg lg:h-[220px]" />
      <div className="bg-muted h-[180px] animate-pulse rounded-lg lg:h-[220px]" />
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
    // `table` (90rem): es una grilla de datos —dos columnas de paneles en
    // ≥lg—, no un formulario lineal (`form` se queda corto) ni el tablero de
    // cocina (`board` es más ancho de lo que esta grilla necesita).
    <PageFrame title="Métricas" width="table">
      {totalOrders === 0 ? (
        <EmptyState
          title="Todavía no hay ventas"
          description="En cuanto entren los primeros pedidos, la facturación, el ranking de productos y la precisión de la cocina van a aparecer acá."
          className="py-12"
        />
      ) : (
        <div className="flex flex-col gap-6 lg:gap-8">
          <StatRow
            columns={3}
            items={[
              { label: 'Pedidos · 30 días', value: String(totalOrders) },
              { label: 'Facturación · 30 días', value: formatCentsCompact(totalRevenueCents, currency) },
              { label: 'Ticket promedio', value: formatCentsCompact(dashboard.averageTicketCents, currency) },
            ]}
          />

          {/* En ≥lg el mostrador sobra ancho para una grilla real: la columna
              principal (ventas + precisión de cocina, que necesitan espacio
              horizontal) contra una columna angosta de rankings. Por debajo de
              lg es una sola columna apilada, en el orden de lectura de siempre. */}
          <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
            <div className="flex flex-col gap-6 lg:col-span-2 lg:gap-8">
              <Panel elevated={false} className="p-4 lg:p-6">
                <PanelHeading title="Ventas de los últimos 30 días" />
                <SalesChart data={dashboard.salesByDay} currency={currency} />
              </Panel>

              {/* Sin `Panel` propio a propósito: `PrepAccuracy` ya monta un
                  `StatRow`, que ES un `Panel` — uno adentro de otro es
                  siempre un error de composición, no una jerarquía. */}
              <div>
                <PanelHeading
                  title="Preparación real vs. estimada"
                  description="De confirmado a listo, contra lo que promete el catálogo."
                />
                <PrepAccuracy prepAccuracy={dashboard.prepAccuracy} />
              </div>
            </div>

            <div className="flex flex-col gap-6 lg:gap-8">
              <Panel elevated={false} className="p-4 lg:p-6">
                <PanelHeading title="Productos más pedidos" />
                <TopProducts products={dashboard.topProducts} currency={currency} />
              </Panel>

              <Panel elevated={false} className="p-4 lg:p-6">
                <PanelHeading title="Pedidos por estado" />
                <OrdersByStatusBreakdown counts={dashboard.ordersByStatus} />
              </Panel>
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  )
}
