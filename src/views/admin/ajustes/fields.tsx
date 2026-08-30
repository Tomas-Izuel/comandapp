'use client'

import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Piezas compartidas por las dos páginas de Ajustes que dependen de un
 * `useForm` con barra de guardado ("El local" y "Pedidos y envío").
 * Extraídas tal cual de la extinta `settings-form.tsx` (1130 líneas, un solo
 * archivo para ocho bloques) — acá no hay lógica nueva, solo el corte que
 * deja a cada page importar únicamente lo que necesita. `horarios/` no
 * importa nada de este archivo: se guarda sola vía RPC, sin `useForm` y sin
 * esta barra (00-architecture.md).
 */

export function toEmptyToNull(v: string): string | null {
  return v.trim() === '' ? null : v
}

export function Field({
  htmlFor,
  label,
  hint,
  error,
  errorId,
  children,
}: {
  htmlFor: string
  label: string
  hint?: string
  error?: string
  errorId: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * Input numérico con borrador en string (F-10): un input controlado por un
 * `number` fuerza "0" apenas se borra el campo para tipear de nuevo. Acá se
 * ve el string tal cual; la conversión a entero pasa por `Math.round` — nunca
 * queda un float a mitad de camino — recién cuando el string es un número
 * válido.
 *
 * Los campos de plata (pedido mínimo, costo de envío, envío gratis desde,
 * mínimo para envío) usan `MoneyInput` en vez de este componente: ese ya
 * resuelve el prefijo "$" y el agrupado de miles. Lo que queda acá son
 * unidades simples (minutos, cantidad de pedidos, el multiplicador de
 * demanda), así que ya no hace falta un factor de escala.
 */
export function DraftNumberInput({
  id,
  value,
  onValueChange,
  errorId,
  invalid,
  ...props
}: {
  id: string
  value: number
  onValueChange: (n: number) => void
  errorId?: string
  invalid?: boolean
} & Omit<React.ComponentProps<typeof Input>, 'id' | 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(() => String(value))
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={draft}
      aria-invalid={invalid || undefined}
      aria-describedby={errorId}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') {
          onValueChange(0)
          return
        }
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) onValueChange(Math.round(parsed))
      }}
      {...props}
    />
  )
}

/**
 * Fila de on/off con target de 44px (F-04).
 *
 * Antes esto era un `<Button>` de shadcn con un `<Checkbox>` de Radix adentro
 * "como indicador visual" — pero el Checkbox también renderiza su propio
 * `<button role="checkbox">`, así que quedaba un `<button>` dentro de otro
 * `<button>`: HTML inválido y error de hidratación garantizado en React
 * (`tabIndex={-1}` lo saca del tab order, pero sigue siendo un elemento
 * interactivo anidado).
 *
 * El arreglo es que haya un solo control real: el Checkbox, con `id`, y la
 * fila entera como `<label htmlFor>` asociado a ese id. Mismo target grande
 * (toda la fila activa el control), mismo click-en-cualquier-lado, sin
 * anidamiento. Las variantes `group-has-[:focus-visible]/field-label:` que ya
 * trae la clase base de `Checkbox` (ver `components/ui/checkbox.tsx`) están
 * pensadas exactamente para esto: le ceden el anillo de foco a un ancestro con
 * clase `group/field-label`, que acá es esta misma fila — así el foco se ve
 * alrededor de la fila entera y no solo del cuadradito de 16px.
 *
 * De paso, esto saca el problema de raíz que forzaba `whitespace-normal` +
 * `min-w-0 shrink` como parche: esa necesidad venía de la clase base de
 * `Button` (`whitespace-nowrap` + `shrink-0`), que un `<label>` no trae.
 */
export function ToggleField({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  const hintId = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'group/field-label has-[:focus-visible]:ring-ring/50 flex min-h-11 w-full min-w-0 items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors has-[:focus-visible]:ring-3',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted cursor-pointer',
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {/* Medida de lectura, no el ancho del contenedor: una línea de 120
            caracteres es ilegible incluso cuando entra. */}
        {hint ? (
          <span id={hintId} className="text-muted-foreground block max-w-[62ch] text-xs font-normal">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  )
}

/**
 * Barra de guardado pegajosa (F-brief C): en una pantalla de mostrador el
 * formulario puede ser más alto que el viewport, y el encargado no puede
 * depender de scrollear hasta el final para guardar un cambio que hizo arriba
 * del todo. `sticky bottom-0` la clava al pie de la ventana mientras el
 * formulario sigue en pantalla, y deja de estarlo sola cuando termina el flujo
 * del `<form>` — sin JS, sin `fixed` que tape contenido de otra página.
 * El `-mx-4 lg:-mx-8` cancela el padding del `PageFrame` (que es exactamente
 * `--admin-gutter`/`--admin-gutter-lg`, 1rem/2rem) para que la barra llegue a
 * los bordes de la columna en vez de flotar angosta adentro de ella; el
 * `px-4 lg:px-8` de acá adentro lo repone para el contenido de la barra.
 *
 * Compartida por "El local" y "Pedidos y envío" — las dos únicas páginas de
 * Ajustes con un `useForm` que espera "Guardar". `horarios/` no la monta: es
 * la única que se guarda sola (RPC transaccional de `ScheduleEditor`), y esa
 * ausencia ahora significa algo (ver 00-architecture.md).
 */
export function SaveBar({
  pending,
  errorMessages,
  label = 'Guardar cambios',
}: {
  pending: boolean
  errorMessages: string[]
  label?: string
}) {
  return (
    <div className="bg-background/95 border-border sticky bottom-0 -mx-4 -mb-6 flex flex-col gap-2 border-t px-4 py-4 backdrop-blur lg:-mx-8 lg:-mb-8 lg:px-8">
      {errorMessages.length > 0 ? (
        <p role="alert" className="text-destructive text-sm">
          Revisá los campos marcados: {errorMessages.join(', ')}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-10 w-fit gap-2">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {label}
      </Button>
    </div>
  )
}
