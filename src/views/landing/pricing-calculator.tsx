'use client'

import { useState, useSyncExternalStore } from 'react'
import { Stepper } from '@/views/shared/surfaces'
import { formatCentsCompact } from '@/lib/money'
import { monthlyTotalCents, PRICING, PRICING_MAX_STORES } from '@/lib/landing'
import { cn } from '@/lib/utils'

/**
 * Duplicado a propósito, mismo criterio que `eta-demo.tsx`/`delivery-quote.tsx`/
 * `events-demo.tsx`: `matchMedia` es estado de un sistema externo,
 * `useSyncExternalStore` evita el `setState` síncrono en un efecto.
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
 * La única isla cliente de `Pricing`: hace visible la aritmética real de
 * `monthlyTotalCents()` en vez de dejar que el lector con más de un local
 * tenga que sacar la cuenta él mismo.
 *
 * `useState(1)` es también lo que se sirve en el HTML: sin JS el panel queda
 * en "1 local" y `$ 59.999`, que es un estado válido de por sí — no un
 * placeholder a medio cargar.
 *
 * `hasChanged` (default `false`) gatea `landing-num-in` contra el hallazgo 1
 * de `03-review.md`: sin ella, el total "entraba" animado al cargar la
 * página, antes de que nadie tocara el stepper. Se sube a `true` recién
 * dentro del `onChange` real.
 */
export function PricingCalculator() {
  const [storeCount, setStoreCount] = useState(1)
  const [hasChanged, setHasChanged] = useState(false)
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  )
  const animated = hasChanged && !reducedMotion
  const totalCents = monthlyTotalCents(storeCount)
  const extraStores = storeCount - 1

  return (
    <div className="border-border border-t px-6 py-8 text-center sm:px-10">
      <p className="text-foreground text-sm font-medium">¿Cuántos locales tenés?</p>

      <div className="mt-4 flex justify-center">
        <Stepper
          value={storeCount}
          onChange={(next) => {
            setStoreCount(next)
            setHasChanged(true)
          }}
          min={1}
          max={PRICING_MAX_STORES}
          label="¿Cuántos locales?"
        />
      </div>

      {/* `aria-live`: el stepper que dispara el cambio está arriba y el total
          está lejos en el DOM visual, así que sin esto un lector de pantalla
          nunca se entera de que el número cambió. Remontado con `key` para
          disparar `.landing-num-in` en cada cambio, misma convención que ETA
          y delivery — pero solo después de que `hasChanged` suba a `true`
          (hallazgo 1 de `03-review.md`): el HTML servido no lleva la clase. */}
      <div aria-live="polite" aria-atomic="true">
        <p
          key={animated ? `total-${totalCents}` : 'total-static'}
          className={cn(
            'tabular display text-(--brand-ink) mt-6 text-5xl font-semibold sm:text-6xl',
            animated && 'landing-num-in',
          )}
        >
          {formatCentsCompact(totalCents, PRICING.currency)}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          por mes
          {/* Mientras PRICING.IVA_DISCLOSED sea false, esto no existe: no
              afirma ni niega el IVA porque todavía no está definido. */}
          {PRICING.IVA_DISCLOSED ? ' + IVA' : ''}
        </p>

        {/* Solo desde el segundo local: con uno solo, un desglose de "1 × ..."
            no suma nada que el número de arriba no diga ya. */}
        {extraStores > 0 ? (
          <p
            key={animated ? `breakdown-${totalCents}` : 'breakdown-static'}
            className={cn('tabular text-muted-foreground mt-3 text-sm', animated && 'landing-num-in')}
          >
            {`1 × ${formatCentsCompact(PRICING.monthlyCents, PRICING.currency)} + ${extraStores} × ${formatCentsCompact(
              PRICING.monthlyMultiStoreCents,
              PRICING.currency,
            )}`}
          </p>
        ) : null}
      </div>
    </div>
  )
}
