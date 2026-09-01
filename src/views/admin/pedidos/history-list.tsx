'use client'

import { Fragment, useMemo, useState } from 'react'
import { Bike } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WhatsApp } from '@/components/ui/whatsapp'
import { StatusPill } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import { formatDateTime, todayInZone, zonedDay, zonedDayStart } from '@/lib/dates'
import { whatsappHref } from '@/lib/whatsapp'
import { cn } from '@/lib/utils'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/models/schemas/order.schema'
import type { Order, OrderStatus, PaymentStatus } from '@/models/types'

const TABS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  ...ORDER_STATUSES.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] })),
]

/** Tono del estado de cocina en la tabla: no es el de `PaymentNotice` (eso es dinero), este es cocina. */
const STATUS_TONE: Record<OrderStatus, 'neutral' | 'live' | 'warning' | 'danger' | 'done'> = {
  pending: 'warning',
  confirmed: 'live',
  preparing: 'live',
  ready: 'live',
  on_the_way: 'live',
  delivered: 'done',
  cancelled: 'danger',
}

/**
 * Cocina y pago son dos relojes distintos y no se leen igual: cocina es la
 * `StatusPill` llena (el reloj que manda en el mostrador), pago es texto con
 * un punto — más liviano — porque "aprobado" es el camino feliz y no necesita
 * gritar. Solo se pone en foco cuando hay algo que mirar: pendiente o, peor,
 * rechazado/reembolsado.
 *
 * Exportado: la bandeja de Programados (`scheduled-tray.tsx`) lo reusa tal
 * cual — mismo lenguaje visual para el mismo dato, en vez de una segunda
 * tabla de tonos que se puede desincronizar de esta.
 */
export const PAYMENT_TEXT_TONE: Record<PaymentStatus, string> = {
  pending: 'text-warning-foreground',
  approved: 'text-muted-foreground',
  rejected: 'text-destructive font-medium',
  refunded: 'text-destructive font-medium',
}

/**
 * Encabezado del divisor de día: "Hoy" / "Ayer" para los dos casos que se leen
 * cien veces por turno, y fecha larga para el resto. Todo en la zona del
 * local — `day` ya es un `YYYY-MM-DD` calculado con `zonedDay`, así que acá
 * solo se formatea, nunca se vuelve a hacer aritmética de fechas.
 */
function formatDayHeading(day: string, timezone: string, today: string, yesterday: string): string {
  if (day === today) return 'Hoy'
  if (day === yesterday) return 'Ayer'

  const instant = zonedDayStart(day, timezone)
  // El año se agrega solo si no es el actual: un historial de 200 pedidos
  // puede cruzar el 1° de enero, y "31 de diciembre" a secas mentiría sobre
  // cuál diciembre es.
  const includeYear = day.slice(0, 4) !== today.slice(0, 4)
  const label = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  }).format(instant)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * Historial denso: tabla, no tarjetas. Responde "¿qué pasó con el pedido de
 * las 9?" en una fila —código, hora, cliente, qué pidió, cocina, dinero,
 * total— sin tener que abrir nada.
 */
export function OrderHistoryList({ orders, timezone }: { orders: Order[]; timezone: string }) {
  const [tab, setTab] = useState<OrderStatus | 'all'>('all')

  const counts = useMemo(() => {
    const map = new Map<OrderStatus, number>()
    for (const order of orders) map.set(order.status, (map.get(order.status) ?? 0) + 1)
    return map
  }, [orders])

  const filtered = useMemo(
    () => (tab === 'all' ? orders : orders.filter((o) => o.status === tab)),
    [orders, tab],
  )

  // Divisores por día: un solo recorrido sobre la lista ya filtrada y ya
  // ordenada (más reciente primero), agrupando por día CALENDARIO DEL LOCAL.
  // Calcularlo sobre `filtered` en vez de sobre `orders` es lo que evita el
  // encabezado huérfano: un día que el filtro de estado deja sin filas
  // directamente no genera grupo.
  const today = todayInZone(timezone)
  const yesterday = zonedDay(new Date(zonedDayStart(today, timezone).getTime() - 1), timezone)
  const groups = useMemo(() => {
    const result: { day: string; orders: Order[] }[] = []
    for (const order of filtered) {
      const day = zonedDay(order.createdAt, timezone)
      const current = result[result.length - 1]
      if (current && current.day === day) current.orders.push(order)
      else result.push({ day, orders: [order] })
    }
    return result
  }, [filtered, timezone])

  return (
    <div className="flex flex-col gap-4">
      {/* Grupo de botones toggle, no `Tabs`: esto filtra una sola tabla, no hay
          `tabpanel`, así que `role="tablist"` era semántica prestada. Es
          además la tercera vez que las clases base de `TabsTrigger` (acá
          `hover:text-foreground`) pisaban un override de prefijo distinto
          (`data-active:text-primary-foreground`) porque `tailwind-merge` no
          deduplica entre prefijos distintos — la última fue texto casi negro
          sobre `bg-primary` casi negro al pasar el mouse por el chip activo.
          Con clases propias no hay clase base con la que pelear. */}
      <div
        role="group"
        aria-label="Filtrar pedidos por estado"
        className="flex w-full flex-wrap gap-1.5 overflow-x-auto [scrollbar-width:none]"
      >
        {TABS.map((t) => {
          const count = t.value === 'all' ? orders.length : (counts.get(t.value) ?? 0)
          const active = tab === t.value
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.value)}
              // El estado activo se distingue por fondo Y por peso de fuente,
              // nunca solo por color: un encargado con sol de frente o
              // daltónico igual lo lee. Sin `border`/`shadow` propios de
              // `TabsTrigger`: acá el chip es deliberadamente plano.
              className={cn(
                'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-transparent px-3.5 text-xs transition-colors duration-(--dur-fast) focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring',
                active
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground font-medium',
              )}
            >
              {t.label} <span className="tabular ml-1">({count})</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        // Dos vacíos distintos: sin pedidos todavía no es lo mismo que un
        // filtro que no encontró nada — el primero es el estado normal de un
        // local nuevo, el segundo es "probá otro estado".
        orders.length === 0 ? (
          <EmptyState title="Todavía no hay pedidos" description="Los pedidos del local van a aparecer acá." />
        ) : (
          <EmptyState
            title="Sin resultados para este filtro"
            description="Ningún pedido tiene ese estado. Probá con otro filtro o mirá Todos."
          />
        )
      ) : (
        // El tope de ancho es del marco (`PageFrame width="table"`, 90rem): acá
        // solo el overflow horizontal para cuando la ventana es más angosta que
        // el `min-w`. La tabla scrollea adentro de este div; el body nunca.
        <div className="border-border overflow-x-auto rounded-lg border">
          {/* `table-fixed` + `colgroup`: los anchos de columna salen de acá, no
              del contenido de cada fila. Sin esto el layout automático del
              navegador recalcula el ancho fila a fila y la grilla deja de
              leerse en línea recta — exactamente lo que hace que una tabla
              densa se sienta "fea" aunque el contenido sea correcto.

              El reparto (10/13/16/14/13/12/14/8) sale de medir en el
              navegador, con Inter real y `tabular-nums`, el string más largo
              que cada columna puede llegar a mostrar, más el padding real de
              la celda (`lg:px-4`, 32px):

                - HORA: "31/12, 20:59" mide ~86px a 15px/400 → ~118px con
                  padding. 13% de 62rem son 129px. Antes tenía 11% y el peor
                  caso era 40px más largo, porque `es-AR` imprimía "08:59
                  p. m." — de ahí el "28/8, 01:…" truncado. La hora de 24
                  horas se arregló en `lib/dates.ts`, que es donde estaba el
                  problema; acá solo se ajusta el reparto a la medida nueva.
                - TOTAL: "$ 1.234.567" (7 dígitos, el peor caso de un total en
                  pesos) mide ~91px a 16px/600 → ~123px con padding. 14% de
                  62rem son 139px. Antes tenía 9% y cortaba en "$ 18.0…".
                - ACCIONES (T6, nueva): un solo botón ícono de 44px
                  (`size="icon"`) con padding chico (`px-2 lg:px-3`, no
                  `px-4`) — 8% de 62rem son 79px, de sobra para el botón sin
                  desbordar la celda. No compite con HORA/TOTAL por el `min-w`:
                  esos dos siguen siendo los que fijan el piso de 62rem.
                - PIDIÓ dona por segunda vez para bancarla (22% → 14%): ya
                  trunca con elipsis A PROPÓSITO —es texto libre y largo, y el
                  `title` cubre el resto—, así que sigue siendo la única
                  columna donde ceder ancho no pierde información.
                - CÓDIGO, CLIENTE, COCINA y PAGO quedan igual (10/16/13/12): no
                  tenían el bug, y COCINA/PAGO son `whitespace-nowrap` SIN
                  `truncate`, o sea que apretarlas desborda en vez de truncar.

              `min-w` en 62rem (992px) y no más: es el ancho mínimo con el que
              esos porcentajes le alcanzan a HORA y TOTAL. Subirlo de más no es
              gratis — a 1400px de ventana el área de trabajo da 1096px, así
              que un `min-w` mayor a eso le pone a la tabla su propia barra
              horizontal en una pantalla de escritorio normal. Con 62rem no
              scrollea; abajo de ~1060px de ventana sí, y para eso está el
              `overflow-x-auto` del contenedor de arriba, que es la única forma
              autorizada de contenido ancho: `<main>` es `overflow-x: hidden` y
              nunca scrollea de costado. */}
          <table className="w-full min-w-[62rem] table-fixed border-collapse text-sm lg:text-[0.9375rem]">
            <caption className="sr-only">Historial de pedidos del local, más reciente primero</caption>
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[13%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[8%]" />
            </colgroup>
            {/* Pegajoso debajo del chrome del panel: con 200 filas el encabezado
                tiene que seguir visible al bajar, si no cada fila es ambigua
                sin volver a subir a leer la columna. El `sticky` va en cada
                `th`, no en `thead`/`tr`: `position: sticky` sobre un grupo de
                fila de tabla es inconsistente entre navegadores. */}
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs font-medium uppercase tracking-[0.04em]">
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-3 py-2.5 font-medium lg:px-4 lg:py-3.5">
                  Código
                </th>
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-3 py-2.5 font-medium lg:px-4 lg:py-3.5">
                  Hora
                </th>
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-3 py-2.5 font-medium lg:px-4 lg:py-3.5">
                  Cliente
                </th>
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-3 py-2.5 font-medium lg:px-4 lg:py-3.5">
                  Pidió
                </th>
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-3 py-2.5 font-medium lg:px-4 lg:py-3.5">
                  Cocina
                </th>
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-3 py-2.5 font-medium lg:px-4 lg:py-3.5">
                  Pago
                </th>
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-3 py-2.5 text-right font-medium lg:px-4 lg:py-3.5">
                  Total
                </th>
                {/* Ícono solo, sin texto visible en la fila: el encabezado
                    lleva el nombre igual, para lectores de pantalla que
                    navegan la tabla celda por celda. */}
                <th scope="col" className="bg-background sticky top-(--admin-header-h) z-10 px-2 py-2.5 font-medium lg:px-3 lg:py-3.5">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            {/* `divide-y` marca el límite entre filas sin sumar un borde propio
                a cada `td`: una línea por fila, no un enrejado. */}
            <tbody className="divide-border divide-y">
              {groups.map((group) => (
                <Fragment key={group.day}>
                  {/* Divisor de día: `<tr>` con un único `<th scope="colgroup">`
                      que abarca las 8 columnas — fila real de la tabla, no un
                      `<div>` suelto entre `<tr>`s, así que sigue siendo una
                      sola tabla para lectores de pantalla y para `table-fixed`.
                      No es sticky: el `th` del encabezado de columnas ya ocupa
                      ese rol, y apilar dos stickies acá suma complejidad que
                      esta tabla no necesita. */}
                  <tr className="bg-muted/40">
                    <th
                      scope="colgroup"
                      colSpan={8}
                      className="text-foreground px-3 py-1.5 text-left text-xs font-semibold lg:px-4"
                    >
                      {formatDayHeading(group.day, timezone, today, yesterday)}
                    </th>
                  </tr>
                  {group.orders.map((order) => {
                    const itemsSummary = order.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(', ')
                    return (
                      <tr key={order.id} className="hover:bg-muted/50 transition-colors duration-(--dur-fast)">
                        {/* Código y total son lo que se busca al leer una fila: en
                            negro pleno y con más peso que el resto de la fila. */}
                        <td className="text-foreground truncate px-3 py-2.5 font-semibold lg:px-4 lg:py-3 lg:text-base">
                          {order.shortCode || `#${order.id}`}
                        </td>
                        <td className="text-muted-foreground tabular truncate px-3 py-2.5 lg:px-4 lg:py-3">
                          {formatDateTime(order.createdAt, timezone)}
                        </td>
                        {/* Cliente es identidad, no medición: peso medio, ni tan
                            opaco como hora/pidió ni tan marcado como código/total.
                            El ícono de moto es la marca de "esto fue delivery" —
                            un pedido de retiro no lleva nada acá — y no infla el
                            ancho de columna: comparte la misma celda truncada. */}
                        <td className="text-foreground px-3 py-2.5 font-medium lg:px-4 lg:py-3" title={order.customerName}>
                          <span className="flex items-center gap-1.5">
                            {order.deliveryMethod === 'delivery' ? (
                              <Bike className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                            ) : null}
                            <span className="truncate">{order.customerName}</span>
                          </span>
                        </td>
                        <td
                          className="text-muted-foreground truncate px-3 py-2.5 lg:px-4 lg:py-3"
                          title={itemsSummary}
                        >
                          {itemsSummary}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap lg:px-4 lg:py-3">
                          <StatusPill tone={STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</StatusPill>
                        </td>
                        {/* Pago no es una segunda pastilla: es texto liviano con un
                            punto. "Aprobado" no necesita gritar; lo que sí merece
                            atención (pendiente, rechazado, reembolsado) se nota por
                            color y peso, no por otro semáforo al lado del de cocina. */}
                        <td className="px-3 py-2.5 whitespace-nowrap lg:px-4 lg:py-3">
                          <span className={cn('inline-flex items-center gap-1.5 text-xs', PAYMENT_TEXT_TONE[order.paymentStatus])}>
                            <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                          </span>
                        </td>
                        <td className="text-foreground truncate px-3 py-2.5 text-right font-semibold lg:px-4 lg:py-3 lg:text-base">
                          <Price cents={order.totalCents} currency={order.currency} />
                          {/* Mismo criterio que la línea de envío de abajo: el total YA
                              está neto del descuento (es lo que se cobró), esto es solo
                              la aclaración de cuánto de la diferencia es el cupón. Sin
                              cupón la fila no cambia en nada — `discountCents` es 0. */}
                          {order.discountCents > 0 ? (
                            <span className="text-muted-foreground block text-[0.6875rem] font-normal normal-case tracking-normal">
                              {order.couponCodeSnapshot} −<Price cents={order.discountCents} currency={order.currency} />
                            </span>
                          ) : null}
                          {/* El total YA incluye el envío (es plata real, se cobró);
                              esto es solo la aclaración de cuánto de ese total es
                              flete, para no tener que abrir el pedido a mirarlo. */}
                          {order.deliveryFeeCents > 0 ? (
                            <span className="text-muted-foreground block text-[0.6875rem] font-normal normal-case tracking-normal">
                              incl. <Price cents={order.deliveryFeeCents} currency={order.currency} /> envío
                            </span>
                          ) : null}
                        </td>
                        {/*
                          El dueño del producto pidió que WhatsApp esté SIEMPRE
                          en las dos pantallas de pedidos — acá, el historial,
                          nunca lo tuvo. Sin padding `px-3/px-4` como el resto
                          de las celdas: el botón (`size="icon"`, 44px) es el
                          contenido, no hay texto que necesite ese aire, y con
                          `px-4` no entraría en el 8% de columna. Sin padding
                          vertical propio (`py-0`) a propósito: las filas de
                          esta tabla ya rondan 40-48px de alto por su propio
                          texto+`py-2.5/lg:py-3`, así que el botón de 44px
                          entra CASI sin empujar la fila — el piso de 44px del
                          toque se cumple sin sumarle una fila más alta a las
                          200 que puede tener este historial.
                        */}
                        <td className="px-2 py-0 text-center align-middle lg:px-3">
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            aria-label={`Escribirle a ${order.customerName} por WhatsApp`}
                          >
                            <a href={whatsappHref(order.customerPhoneE164)} target="_blank" rel="noreferrer">
                              <WhatsApp className="size-4" aria-hidden />
                            </a>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
