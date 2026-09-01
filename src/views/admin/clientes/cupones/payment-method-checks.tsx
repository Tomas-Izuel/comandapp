'use client'

import Link from 'next/link'
import { Checkbox } from '@/components/ui/checkbox'
import { PAYMENT_METHOD_LABELS } from '@/models/schemas/order.schema'
import { paymentMethodUnavailableHint } from './format'
import type { PaymentMethod } from '@/models/types'

const METHODS: PaymentMethod[] = ['online', 'transfer', 'in_store']

/**
 * Los tres checkboxes de §5.9.4. `value: null` es "todos los métodos" — el
 * valor MÁS ANCHO, no el vacío — así que el checkbox de un método se ve
 * marcado cuando `value === null` o cuando el array lo incluye.
 *
 * Un método que el local no puede cobrar hoy se DESHABILITA con el motivo
 * inline y un link a `/admin/pagos`, nunca se oculta: ocultarlo hace pensar
 * que el producto no lo puede hacer, y dejarlo habilitado sin avisar es
 * plata muerta que el dueño descubre cuando un cliente le escribe.
 */
export function PaymentMethodChecks({
  value,
  onChange,
  availability,
  disabled,
}: {
  value: PaymentMethod[] | null
  onChange: (next: PaymentMethod[] | null) => void
  availability: Record<PaymentMethod, boolean>
  disabled?: boolean
}) {
  function isChecked(method: PaymentMethod): boolean {
    return value === null || value.includes(method)
  }

  function toggle(method: PaymentMethod, checked: boolean) {
    // Partimos siempre de la lista EXPLÍCITA de los tres métodos (null = todos
    // marcados) para poder destildar uno solo sin perder el resto.
    const current = value ?? [...METHODS]
    const next = checked ? [...new Set([...current, method])] : current.filter((m) => m !== method)
    // Si terminan los tres marcados, se vuelve a `null`: es la representación
    // canónica de "sin restricción" (coupons_payment_methods_check no
    // distingue entre las dos, pero `requiresConfirmation()` sí — pasar a
    // `null` explícito es lo que hace que ensanchar a "todos" cuente como
    // escalación como cualquier otra).
    onChange(next.length === METHODS.length ? null : next)
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1.5 text-sm font-medium">Medios de pago</legend>
      {METHODS.map((method) => {
        const available = availability[method]
        const hint = paymentMethodUnavailableHint(method)
        const fieldId = `coupon-payment-method-${method}`
        return (
          <label
            key={method}
            htmlFor={fieldId}
            className={
              'group/field-label has-[:focus-visible]:ring-ring/50 flex min-h-11 items-start gap-3 rounded-lg px-2 py-2 transition-colors has-[:focus-visible]:ring-3 ' +
              (!available ? 'cursor-not-allowed opacity-60' : disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted cursor-pointer')
            }
          >
            <Checkbox
              id={fieldId}
              checked={isChecked(method)}
              disabled={!available || disabled}
              onCheckedChange={(v) => toggle(method, v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{PAYMENT_METHOD_LABELS[method]}</span>
              <span className="text-muted-foreground block text-xs">
                {available ? (
                  method === 'online' ? (
                    'Pago online por adelantado'
                  ) : method === 'transfer' ? (
                    'El cliente transfiere y sube el comprobante'
                  ) : (
                    'En el local al retirar, o en la puerta si es delivery'
                  )
                ) : (
                  <>
                    {hint.unavailableLabel}.{' '}
                    <Link href={hint.href} className="text-foreground underline underline-offset-2" target="_blank">
                      Ir a Pagos
                    </Link>
                  </>
                )}
              </span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
