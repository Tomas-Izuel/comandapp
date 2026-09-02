'use client'

import { useId, useState, useSyncExternalStore } from 'react'
import { ETA_DEMO, etaMinutesFor } from '@/lib/landing'
import { cn } from '@/lib/utils'

/**
 * Duplicado a propósito en las tres calculadoras (`delivery-quote.tsx`,
 * `pricing-calculator.tsx`), mismo criterio que `events-demo.tsx`: `matchMedia`
 * es estado de un sistema externo, así que `useSyncExternalStore` en vez de un
 * `useState` + `setState` adentro de un efecto (dispara `react-hooks/set-state-in-effect`).
 * El snapshot del servidor es `false` porque ahí no existe `window`.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function getReducedMotionServerSnapshot() {
  return false
}

/**
 * Estilizado a mano sobre `<input type="range">` nativo (no el `Slider` de
 * Radix que ya existe en `src/components/ui/`): lo pide el contrato de esta
 * sección explícitamente, y un control nativo sin dependencia extra alcanza
 * para un slider de un solo pulgar. Track `bg-muted` de 6px, thumb `bg-primary`
 * de 24px (el piso de calidad pide ≥24px de dibujo con ≥44px de área táctil,
 * que da la altura del propio `<input>`). El foco no se toca acá: ya lo
 * resuelve la regla global `:where(...,input,...):focus-visible` de
 * `globals.css` con el anillo del sistema.
 *
 * Se repite tal cual en `delivery-quote.tsx`: son dos islas cliente
 * independientes y la alternativa —una primitiva nueva en
 * `views/shared/surfaces.tsx`— está fuera del alcance de este slice.
 */
const RANGE_INPUT_CLASS = cn(
  'h-11 w-full cursor-pointer touch-none appearance-none bg-transparent',
  '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-pill [&::-webkit-slider-runnable-track]:bg-muted',
  '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-pill [&::-moz-range-track]:bg-muted',
  '[&::-webkit-slider-thumb]:-mt-[9px] [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-raise',
  '[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-raise',
)

/**
 * "El tiempo de espera se mueve con la cocina": un cálculo real, no una
 * animación. `etaMinutesFor()` es la MISMA fórmula de `create_order`
 * (CLAUDE.md, "Multiplicador de demanda"), así que el número que este control
 * muestra es el que el producto de verdad calcularía con esa carga de cocina.
 *
 * Sin autoplay a propósito: es una calculadora, no una escena. El valor
 * inicial (2 pedidos activos, por debajo del umbral) es lo que ve cualquiera
 * sin JS, porque el estado inicial de React ya es ese — no hace falta un
 * efecto para que el HTML servido lo muestre.
 *
 * `hasChanged` (default `false`) es la guarda contra el hallazgo 1 de
 * `03-review.md`: sin ella, `landing-num-in` viajaba en el HTML servido y el
 * ETA "entraba" solo al cargar la página, sin que nadie tocara el slider. Se
 * sube a `true` recién dentro del `onChange` real (nunca en un efecto) y, una
 * vez arriba, se queda ahí: a partir de la primera interacción el número sí
 * se anima en cada cambio, que es la escena que corresponde acá.
 */
export function EtaDemo() {
  const sliderId = useId()
  const [activeOrders, setActiveOrders] = useState(2)
  const [hasChanged, setHasChanged] = useState(false)
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  )
  const animated = hasChanged && !reducedMotion

  const eta = etaMinutesFor(activeOrders)
  const multiplierApplied = activeOrders >= ETA_DEMO.thresholdOrders
  const slowest = ETA_DEMO.itemPrepMinutes.reduce((slower, item) => (item.minutes > slower.minutes ? item : slower))
  const thresholdPercent = (ETA_DEMO.thresholdOrders / ETA_DEMO.maxActiveOrders) * 100

  return (
    <div className="flex flex-col gap-5">
      <h3 className="display text-lg font-semibold">El tiempo de espera se mueve con la cocina</h3>

      <div className="flex flex-col gap-1.5">
        <ul className="flex flex-col gap-1.5 text-sm">
          {ETA_DEMO.itemPrepMinutes.map((item) => (
            <li key={item.name} className="flex items-baseline justify-between gap-3">
              <span className={item.name === slowest.name ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                {item.name}
              </span>
              <span className="tabular text-muted-foreground">{item.minutes} min</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          Se entrega junto: manda el más lento ({slowest.name}, {slowest.minutes} min).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={sliderId} className="text-foreground text-sm font-medium">
            Pedidos activos en la cocina
          </label>
          <span className="tabular text-muted-foreground text-sm">{activeOrders}</span>
        </div>
        <div className="relative pb-5">
          <input
            id={sliderId}
            type="range"
            min={0}
            max={ETA_DEMO.maxActiveOrders}
            step={1}
            value={activeOrders}
            onChange={(event) => {
              setActiveOrders(Number(event.target.value))
              setHasChanged(true)
            }}
            aria-valuetext={`${activeOrders} pedido${activeOrders === 1 ? '' : 's'} activo${activeOrders === 1 ? '' : 's'}`}
            className={RANGE_INPUT_CLASS}
          />
          {/* La marca del umbral de demanda: a partir de acá el multiplicador entra a jugar. */}
          <span
            className="bg-foreground/30 pointer-events-none absolute top-1 h-4 w-px"
            style={{ left: `${thresholdPercent}%` }}
            aria-hidden
          />
          <span
            className="text-muted-foreground pointer-events-none absolute top-6 text-[0.6875rem] whitespace-nowrap"
            style={{ left: `${thresholdPercent}%`, transform: 'translateX(-50%)' }}
          >
            Umbral: {ETA_DEMO.thresholdOrders} pedidos
          </span>
        </div>
      </div>

      {/* Una sola región `aria-live` para todo el bloque de resultado (ETA +
          línea de multiplicador): son dos números que cambian juntos con el
          mismo slider, así que un lector de pantalla los anuncia como una
          unidad, no dos anuncios sueltos. */}
      <div
        className="border-border bg-muted/60 flex flex-col gap-4 rounded-(--radius) border p-4"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="text-foreground text-sm">
          {multiplierApplied
            ? `Multiplicador de demanda aplicado: ×${ETA_DEMO.multiplier}`
            : `Sin multiplicador: los activos todavía no llegan al umbral de ${ETA_DEMO.thresholdOrders}`}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div
            key={animated ? `eta-${eta}` : 'eta-static'}
            className={cn('flex items-baseline gap-1.5', animated && 'landing-num-in')}
          >
            <span className="display text-foreground tabular text-4xl font-semibold sm:text-5xl">{eta}</span>
            <span className="text-muted-foreground text-sm">min</span>
          </div>
          <p className="text-muted-foreground text-xs sm:text-sm">
            Hoy por WhatsApp: <span className="tabular">{ETA_DEMO.todaysFixedAnswerMinutes} minutos</span>, siempre
          </p>
        </div>
      </div>
    </div>
  )
}
