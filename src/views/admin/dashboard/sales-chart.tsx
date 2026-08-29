'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCentsCompact } from '@/lib/money'
import { formatDayShort } from '@/lib/dates'
import type { SalesPoint } from '@/models/types'

/**
 * Dos gráficos de un eje cada uno, no uno con doble escala: facturación y
 * cantidad de pedidos son magnitudes distintas y un eje compartido las
 * distorsiona a las dos. Comparten la misma línea de tiempo, nunca la
 * misma escala.
 *
 * `date` llega como `YYYY-MM-DD` ya agrupado por día EN LA ZONA DEL LOCAL
 * (la RPC `store_dashboard` lo arma con `at time zone`), así que acá no hay
 * ninguna zona que aplicar. Antes se parseaba con `new Date(iso)`, que lo lee
 * como medianoche UTC y en un cliente en UTC-3 corría el eje un día entero:
 * `formatDayShort` no parsea nada, formatea el string tal como viene.
 */

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' }
const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--popover-foreground)',
}

export function SalesChart({ data, currency }: { data: SalesPoint[]; currency: string }) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">Todavía no hay ventas en este rango.</p>
  }

  function formatDay(day: React.ReactNode): string {
    return formatDayShort(String(day))
  }

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium">Facturación por día</p>
        {/* aria-hidden: el SVG del gráfico es invisible para un lector de
            pantalla igual, y sin esto recharts deja pasar texto suelto del
            tooltip que duplica —desordenado— la tabla `sr-only` de abajo.
            La altura crece en ≥lg (calza con el esqueleto de `dashboard/page.tsx`)
            porque `ResponsiveContainer` necesita un contenedor con alto propio
            para leer "100%": no acepta un breakpoint en su prop `height`. */}
        <div aria-hidden className="h-[180px] lg:h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={formatDay} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(v: number) => formatCentsCompact(v, currency)}
              />
              <Tooltip
                formatter={(value) => formatCentsCompact(Number(value ?? 0), currency)}
                labelFormatter={formatDay}
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: 'var(--muted)' }}
              />
              <Bar dataKey="revenueCents" name="Facturación" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* El `sr-only` va en el `div` que envuelve, no en la `table`: en una
            tabla el alto computado por el navegador es un MÍNIMO, no un
            máximo, así que `height:1px` de la utilidad no la colapsa —
            quedaba en 768px reales, oculta por `clip` pero igual estirando
            el documento por debajo (y, al ser absoluta y huérfana de
            contenedor posicionado, el `<main>` de `AdminShell`). */}
        <div className="sr-only">
          <table>
            <caption>Facturación por día</caption>
            <thead>
              <tr>
                <th scope="col">Día</th>
                <th scope="col">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.date}>
                  <td>{formatDay(point.date)}</td>
                  <td>{formatCentsCompact(point.revenueCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium">Pedidos por día</p>
        <div aria-hidden className="h-[180px] lg:h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={formatDay} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <Tooltip labelFormatter={formatDay} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--muted)' }} />
              <Bar dataKey="orders" name="Pedidos" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Mismo motivo que arriba: el colapso a 1×1 va en el `div`, no en la `table`. */}
        <div className="sr-only">
          <table>
            <caption>Pedidos por día</caption>
            <thead>
              <tr>
                <th scope="col">Día</th>
                <th scope="col">Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.date}>
                  <td>{formatDay(point.date)}</td>
                  <td>{point.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
