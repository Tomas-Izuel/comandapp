'use client'

import { useState, useSyncExternalStore } from 'react'
import { buildDeliveryQuote } from '@/lib/delivery'
import { DELIVERY_DEMO, DELIVERY_DEMO_SUBTOTAL } from '@/lib/landing'
import { formatCentsCompact } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { CourierAvailability } from '@/models/types'

/**
 * Duplicado a propósito, mismo criterio que `eta-demo.tsx`/`events-demo.tsx`:
 * `matchMedia` es estado de un sistema externo, `useSyncExternalStore` evita
 * el `setState` síncrono en un efecto (`react-hooks/set-state-in-effect`).
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
 * Mismo control que `eta-demo.tsx`, duplicado a propósito: ver el comentario
 * largo ahí sobre por qué es un `<input type="range">` nativo estilizado y no
 * la primitiva de `views/shared/`.
 */
const RANGE_INPUT_CLASS = cn(
  'h-11 w-full cursor-pointer touch-none appearance-none bg-transparent',
  '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-pill [&::-webkit-slider-runnable-track]:bg-muted',
  '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-pill [&::-moz-range-track]:bg-muted',
  '[&::-webkit-slider-thumb]:-mt-[9px] [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-raise',
  '[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-raise',
)

const DEMO_CURRENCY = 'ARS'

type AvailabilityChoice = 'free' | 'busy'

const AVAILABILITY_OPTIONS: ReadonlyArray<{ id: AvailabilityChoice; label: string; value: CourierAvailability }> = [
  { id: 'free', label: 'Hay un repartidor libre', value: { activeCouriers: 2, freeCouriers: 1 } },
  { id: 'busy', label: 'Están todos en la calle', value: { activeCouriers: 2, freeCouriers: 0 } },
]

/**
 * El cotizador de envío, con la MISMA función que cobra en el checkout real
 * (`buildDeliveryQuote`, `src/lib/delivery.ts`): nunca puede mostrar un envío
 * que el producto no cobraría. `DELIVERY_DEMO` y `DELIVERY_DEMO_SUBTOTAL` son
 * el contrato de `src/lib/landing.ts`; no se inventa un número acá.
 *
 * El valor inicial reproduce el pedido #A2A1 ($16.700), que ya supera el
 * "gratis desde" de la tienda de demostración — por eso el estado inicial
 * (sin JS) muestra "Envío gratis", no el costo de $1.800: ese es el costo
 * PLANO de la tienda, no lo que este subtotal puntual paga.
 *
 * `hasChanged` (default `false`) gatea `landing-num-in` contra el hallazgo 1
 * de `03-review.md`: sin ella, el subtotal y los tres resultados de la
 * cotización "entraban" animados al cargar la página, antes de que nadie
 * tocara el slider o el radiogroup. Se sube a `true` desde los dos disparadores
 * reales del cambio (el slider y `selectAvailability`), nunca desde un efecto.
 */
export function DeliveryQuote() {
  const [subtotalCents, setSubtotalCents] = useState<number>(DELIVERY_DEMO_SUBTOTAL.initialCents)
  const [availability, setAvailability] = useState<AvailabilityChoice>('free')
  const [hasChanged, setHasChanged] = useState(false)
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  )
  const animated = hasChanged && !reducedMotion

  const selected = AVAILABILITY_OPTIONS.find((option) => option.id === availability) ?? AVAILABILITY_OPTIONS[0]
  const quote = buildDeliveryQuote({
    delivery: DELIVERY_DEMO,
    subtotalCents,
    availability: selected.value,
    currency: 'ARS',
  })

  function selectAvailability(next: AvailabilityChoice) {
    setAvailability(next)
    setHasChanged(true)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    selectAvailability(availability === 'free' ? 'busy' : 'free')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="delivery-quote-subtotal" className="text-foreground text-sm font-medium">
            Tu pedido
          </label>
          <span
            key={animated ? `subtotal-${subtotalCents}` : 'subtotal-static'}
            className={cn('tabular text-foreground text-sm font-semibold', animated && 'landing-num-in')}
          >
            {formatCentsCompact(subtotalCents, DEMO_CURRENCY)}
          </span>
        </div>
        <input
          id="delivery-quote-subtotal"
          type="range"
          min={DELIVERY_DEMO_SUBTOTAL.minCents}
          max={DELIVERY_DEMO_SUBTOTAL.maxCents}
          step={DELIVERY_DEMO_SUBTOTAL.stepCents}
          value={subtotalCents}
          onChange={(event) => {
            setSubtotalCents(Number(event.target.value))
            setHasChanged(true)
          }}
          aria-valuetext={formatCentsCompact(subtotalCents, DEMO_CURRENCY)}
          className={RANGE_INPUT_CLASS}
        />
      </div>

      <div
        role="radiogroup"
        aria-label="Disponibilidad de repartidores"
        onKeyDown={handleKeyDown}
        className="bg-muted grid grid-cols-2 gap-1 rounded-(--radius) p-1"
      >
        {AVAILABILITY_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={availability === option.id}
            tabIndex={availability === option.id ? 0 : -1}
            onClick={() => selectAvailability(option.id)}
            className={cn(
              'flex min-h-11 items-center justify-center rounded-(--radius) px-2 text-center text-sm font-medium transition-colors duration-(--dur-fast)',
              availability === option.id
                ? 'bg-card text-foreground shadow-flat'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Una sola región `aria-live` para todo el bloque de resultado (envío,
          mínimo faltante, minutos): los tres cambian juntos con el mismo
          slider/radiogroup, así que se anuncian como una unidad. */}
      <div
        className="border-border bg-muted/60 flex flex-col gap-3 rounded-(--radius) border p-4"
        aria-live="polite"
        aria-atomic="true"
      >
        {quote.available ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-foreground text-sm font-medium">Envío</span>
              <span
                key={animated ? `fee-${quote.feeCents}` : 'fee-static'}
                className={cn('tabular text-lg font-semibold', animated && 'landing-num-in')}
              >
                {quote.feeCents === 0 ? (
                  <span className="text-(--brand-ink)">Envío gratis</span>
                ) : (
                  <span className="text-foreground">{formatCentsCompact(quote.feeCents, DEMO_CURRENCY)}</span>
                )}
              </span>
            </div>
            {quote.missingForFreeCents > 0 ? (
              <p
                key={animated ? `missing-${quote.missingForFreeCents}` : 'missing-static'}
                className={cn('text-muted-foreground text-xs', animated && 'landing-num-in')}
              >
                Te faltan {formatCentsCompact(quote.missingForFreeCents, DEMO_CURRENCY)} para el envío gratis.
              </p>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-foreground text-sm font-medium">Minutos de viaje</span>
              <span
                key={animated ? `minutes-${quote.minutesToAdd}` : 'minutes-static'}
                className={cn('tabular text-lg font-semibold', animated && 'landing-num-in')}
              >
                {quote.minutesToAdd} min
              </span>
            </div>
            {quote.allCouriersBusy ? (
              <p className="text-muted-foreground text-xs">
                Toda la flota está en la calle: el tiempo se estira, el envío no se apaga.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-foreground text-sm">{quote.unavailableReason}</p>
        )}
      </div>
    </div>
  )
}
