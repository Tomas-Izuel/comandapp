import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getOrderHistory } from '@/models/order.model'
import { DateFilter } from '@/views/admin/pedidos/date-filter'
import { OrderHistoryList } from '@/views/admin/pedidos/history-list'
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

  const orders = await getOrderHistory(session.store.id, { from: fromIso, to: toIso, limit: 200 })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
        <DateFilter from={from} to={to} />
      </div>
      <OrderHistoryList orders={orders} timezone={timezone} />
    </div>
  )
}
