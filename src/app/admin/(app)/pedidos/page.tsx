import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getOrderHistory, getScheduledOrders } from '@/models/order.model'
import { DateFilter } from '@/views/admin/pedidos/date-filter'
import { OrderHistoryList } from '@/views/admin/pedidos/history-list'
import { ScheduledOrdersTray } from '@/views/admin/pedidos/scheduled-tray'
import { PageFrame, PanelHeading } from '@/views/admin/page-frame'
import { isCalendarDay, todayInZone, zonedDayRange } from '@/lib/dates'

const HISTORY_DEFAULT_DAYS = 7

/** Resta días a un `YYYY-MM-DD` en aritmética de calendario, sin tocar husos horarios. */
function daysBefore(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, date))
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export default async function AdminOrderHistoryPage(props: PageProps<'/admin/pedidos'>) {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const timezone = session.store.timezone
  const today = todayInZone(timezone)

  const searchParams = await props.searchParams
  const rawFrom = typeof searchParams.from === 'string' ? searchParams.from : undefined
  const rawTo = typeof searchParams.to === 'string' ? searchParams.to : undefined

  // S-18: un from/to que no es un día de calendario real (o que directamente
  // no vino) no puede tirar un 500 — `new Date('basura').toISOString()` lanza
  // `RangeError`. Cae al default de siempre en vez de romper la página.
  const from = rawFrom && isCalendarDay(rawFrom) ? rawFrom : daysBefore(today, HISTORY_DEFAULT_DAYS)
  const to = rawTo && isCalendarDay(rawTo) ? rawTo : today

  // A-10: los límites se calculan en la zona DEL LOCAL, no en la del proceso
  // (UTC en Vercel) — si no, "hoy" arranca a las 21:00 de ayer y se pierde
  // justo la hora pico del viernes a la noche.
  const { fromIso } = zonedDayRange(from, timezone)
  const { toIso } = zonedDayRange(to, timezone)

  // Dos preguntas distintas, dos queries distintas: el historial acota por
  // `created_at` (cuándo se hizo el pedido) y la bandeja de Programados por
  // `scheduled_for` (cuándo se prometió) — mezclarlas en una sola lectura
  // dejaría un programado a 3 días "escondido" fuera del rango de fechas del
  // historial, o "perdido" en el día equivocado si se lo agrupara por creación.
  const [orders, scheduledOrders] = await Promise.all([
    getOrderHistory(session.store.id, { from: fromIso, to: toIso, limit: 200 }),
    getScheduledOrders(session.store.id),
  ])

  return (
    // `table`: es un historial denso de hasta 200 filas, no un formulario ni el
    // tablero de cocina — 90rem le da lugar a la tabla sin estirarla a 1920px.
    <PageFrame title="Pedidos" width="table" action={<DateFilter from={from} to={to} />}>
      <div className="flex flex-col gap-10">
        <ScheduledOrdersTray
          storeId={session.store.id}
          orders={scheduledOrders}
          timezone={timezone}
          currency={session.store.currency}
        />
        <section className="flex flex-col gap-3">
          <PanelHeading title="Historial" />
          <OrderHistoryList orders={orders} timezone={timezone} />
        </section>
      </div>
    </PageFrame>
  )
}
