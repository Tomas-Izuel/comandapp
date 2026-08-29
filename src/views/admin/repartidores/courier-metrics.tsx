import { Price } from '@/views/shared/money'
import type { CourierRow as CourierRowType } from '@/models/types'

/**
 * `avgDeliveryMinutes` tiene tres lecturas distintas, no dos:
 * - `null` → nunca se cerró una entrega medible (repartidor nuevo, o entregas
 *   cerradas desde el mostrador sin pasar por el portal). "Sin datos".
 * - `0` → SÍ hay una entrega medida y el promedio real da bajo un minuto
 *   (arranque y entrega casi juntos). Es un dato real, no un cero roto.
 * - `> 0` → minutos enteros.
 *
 * Ya viene entero desde Postgres (`round(...)::int` en la RPC de
 * `courier_stats`), así que no se redondea de nuevo acá: hacerlo sugeriría
 * que el valor puede llegar fraccionado, y no es el caso.
 */
function formatAvgMinutes(min: number | null): string {
  if (min === null) return '—'
  if (min === 0) return '<1 min'
  return `${min} min`
}

/**
 * Tira densa de medidas para UN repartidor, pensada para vivir adentro de la
 * fila (no una tarjeta propia: la fila ya vive dentro del `Panel` de la
 * sección). `<dl>` en vez de un layout suelto: cada número queda atado a su
 * rótulo en el DOM, así que un lector de pantalla no depende del orden visual
 * cuando la tira se reordena en mobile.
 */
export function CourierMetrics({
  courier,
  currency,
  showMoney,
}: {
  courier: CourierRowType
  currency: string
  showMoney: boolean
}) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <div className="min-w-[6.5rem]">
        <dt className="text-muted-foreground text-xs">Entregas · 30 días</dt>
        <dd className="tabular font-medium">
          {courier.deliveries30d}
          <span className="text-muted-foreground ml-1 text-xs font-normal">
            · {courier.deliveriesToday} hoy
          </span>
        </dd>
      </div>

      <div className="min-w-[6.5rem]">
        {/*
          El rótulo tiene que desambiguar solo: en el celular del dueño (de
          donde se mira este panel, ver PRODUCT.md) un `title` no se dispara
          nunca — es hover puro. "Promedio en la calle" es el idioma que el
          producto ya usa para "esto mide al repartidor, no a la cocina" (el
          checkout avisa cuando "están todos en la calle"). El `title` queda
          de refuerzo para desktop, ya no cargando el significado solo.
        */}
        <dt className="text-muted-foreground text-xs" title="Puerta a puerta: no incluye el tiempo de cocina">
          Promedio en la calle
        </dt>
        <dd className="tabular font-medium">
          {formatAvgMinutes(courier.avgDeliveryMinutes)}
          {courier.avgDeliveryMinutes === null ? (
            <span className="text-muted-foreground ml-1 text-xs font-normal">sin entregas medidas</span>
          ) : null}
        </dd>
      </div>

      {showMoney ? (
        <div className="min-w-[8rem]">
          <dt className="text-muted-foreground text-xs">Cobrado en la puerta · hoy</dt>
          <dd className="tabular font-medium">
            <Price cents={courier.collectedTodayCents} currency={currency} />
            {/*
              Un local recién arrancado tiene EXACTAMENTE hoy === 30 días todo
              el tiempo (todavía no pasó ni un día completo de historia). Repetir
              el mismo número con otro rótulo se lee como un bug de cálculo, no
              como un dato — el rótulo "hoy" ya dice todo lo que hay para decir.
            */}
            {courier.collected30dCents !== courier.collectedTodayCents ? (
              <span className="text-muted-foreground ml-1 text-xs font-normal">
                · <Price cents={courier.collected30dCents} currency={currency} /> en 30 días
              </span>
            ) : null}
          </dd>
        </div>
      ) : null}
    </dl>
  )
}
