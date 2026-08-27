'use client'

import { useId, useMemo, useState, useTransition } from 'react'
import { Controller, useForm, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { updateStoreSettingsAction } from '@/controllers/admin.actions'
import { storeSettingsInputSchema, type StoreSettingsInput } from '@/models/schemas/store.schema'
import { scaleUpInt } from '@/lib/money'
import type { Store } from '@/models/types'

/** Ejemplo del explicador de demanda: un prep_minutes realista de la carta, no un número redondo inventado. */
const DEMAND_EXAMPLE_MINUTES = 20

function storeToInput(store: Store): StoreSettingsInput {
  return {
    name: store.name,
    // '' en vez de null: los inputs de texto no registrados no aceptan un
    // valor DOM nulo. Se vuelve a convertir a null en `setValueAs`.
    description: store.description ?? '',
    phoneE164: store.phoneE164 ?? '',
    whatsappPhoneE164: store.whatsappPhoneE164 ?? '',
    address: store.address ?? '',
    timezone: store.timezone,
    currency: store.currency,
    acceptingOrders: store.acceptingOrders,
    inStorePaymentEnabled: store.inStorePaymentEnabled,
    minOrderCents: store.minOrderCents,
    demandThresholdOrders: store.demandThresholdOrders,
    demandMultiplier: store.demandMultiplier,
  }
}

/** Traduce las claves internas del schema a lo que el dueño del local reconoce (F-05). */
const FIELD_LABELS: Record<keyof StoreSettingsInput, string> = {
  name: 'Nombre',
  description: 'Descripción',
  phoneE164: 'Teléfono',
  whatsappPhoneE164: 'WhatsApp',
  address: 'Dirección',
  timezone: 'Zona horaria',
  currency: 'Moneda',
  acceptingOrders: 'Tomando pedidos',
  inStorePaymentEnabled: 'Pago al retirar',
  minOrderCents: 'Pedido mínimo',
  demandThresholdOrders: 'Umbral de demanda',
  demandMultiplier: 'Multiplicador de demanda',
}

function toEmptyToNull(v: string): string | null {
  return v.trim() === '' ? null : v
}

function Field({
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
 * ve el string tal cual; la conversión a entero (centavos o unidades) pasa
 * por `Math.round` — nunca queda un float a mitad de camino — recién cuando
 * el string es un número válido.
 */
function DraftNumberInput({
  id,
  value,
  onValueChange,
  scale = 1,
  errorId,
  invalid,
  ...props
}: {
  id: string
  value: number
  onValueChange: (n: number) => void
  scale?: number
  errorId?: string
  invalid?: boolean
} & Omit<React.ComponentProps<typeof Input>, 'id' | 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(() => String(value / scale))
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
        if (Number.isFinite(parsed)) onValueChange(Math.round(parsed * scale))
      }}
      {...props}
    />
  )
}

/**
 * Fila de on/off con botón de 44px (F-04): el Checkbox de Radix es un botón,
 * no un input nativo etiquetable por tamaño de click a ojo. El botón entero
 * es el control; el Checkbox de adentro queda como indicador visual.
 */
function ToggleField({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex h-auto min-h-11 w-full items-start justify-start gap-3 px-2 py-2 text-left"
    >
      <Checkbox checked={checked} onCheckedChange={() => {}} tabIndex={-1} className="pointer-events-none mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="text-muted-foreground block text-xs font-normal">{hint}</span> : null}
      </span>
    </Button>
  )
}

export function SettingsForm({ storeId, store }: { storeId: number; store: Store }) {
  const [pending, startTransition] = useTransition()
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<StoreSettingsInput>({
    // Ver el comentario equivalente en product-drawer.tsx: `z.coerce.number()`
    // hace que Zod infiera `unknown` para el tipo de entrada de esos campos.
    resolver: zodResolver(storeSettingsInputSchema) as Resolver<StoreSettingsInput>,
    defaultValues: storeToInput(store),
  })

  const nameId = useId()
  const descId = useId()
  const phoneId = useId()
  const whatsappId = useId()
  const addressId = useId()
  const minOrderId = useId()
  const thresholdId = useId()
  const multiplierId = useId()

  const demandMultiplier = useWatch({ control, name: 'demandMultiplier' })
  const demandThresholdOrders = useWatch({ control, name: 'demandThresholdOrders' })
  const address = useWatch({ control, name: 'address' })

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await updateStoreSettingsAction(storeId, values)
      if (!result.ok) {
        toast.error('No se pudo guardar', { description: result.error })
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (field in FIELD_LABELS) setError(field as FieldPath<StoreSettingsInput>, { type: 'server', message: messages[0] })
        }
        return
      }
      toast.success('Ajustes guardados')
    })
  })

  // `scaleUpInt`, no `Math.ceil(base * mult)`: con multiplicadores decimales
  // (1.1, 1.5) el float se pasa de largo — `20 * 1.1` da 22.000000000000004 —
  // y acá el número es justo lo que le estamos prometiendo entender al dueño.
  const exampleEta = useMemo(() => scaleUpInt(DEMAND_EXAMPLE_MINUTES, demandMultiplier), [demandMultiplier])
  const erroredFields = (Object.keys(errors) as (keyof StoreSettingsInput)[]).filter((key) => key in FIELD_LABELS)

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Datos del local</h2>
        <Field htmlFor={nameId} label="Nombre" error={errors.name?.message} errorId={`${nameId}-error`}>
          <Input
            id={nameId}
            {...register('name')}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            className="h-10"
          />
        </Field>
        <Field htmlFor={descId} label="Descripción" errorId={`${descId}-error`}>
          <Textarea id={descId} {...register('description', { setValueAs: toEmptyToNull })} rows={3} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            htmlFor={phoneId}
            label="Teléfono"
            hint="Formato +54911…"
            error={errors.phoneE164?.message}
            errorId={`${phoneId}-error`}
          >
            <Input
              id={phoneId}
              {...register('phoneE164', { setValueAs: toEmptyToNull })}
              aria-invalid={!!errors.phoneE164}
              aria-describedby={errors.phoneE164 ? `${phoneId}-error` : undefined}
              className="h-10"
            />
          </Field>
          <Field
            htmlFor={whatsappId}
            label="WhatsApp"
            hint="Al que le llegan los avisos de pedido listo"
            error={errors.whatsappPhoneE164?.message}
            errorId={`${whatsappId}-error`}
          >
            <Input
              id={whatsappId}
              {...register('whatsappPhoneE164', { setValueAs: toEmptyToNull })}
              aria-invalid={!!errors.whatsappPhoneE164}
              aria-describedby={errors.whatsappPhoneE164 ? `${whatsappId}-error` : undefined}
              className="h-10"
            />
          </Field>
        </div>
        <Field
          htmlFor={addressId}
          label="Dirección"
          hint="Todo pedido es retiro en el local: es lo único que el cliente tiene para saber dónde ir a buscarlo."
          error={errors.address?.message}
          errorId={`${addressId}-error`}
        >
          <Input id={addressId} {...register('address', { setValueAs: toEmptyToNull })} className="h-10" />
        </Field>
        {!address?.trim() ? (
          <p className="text-destructive text-xs">
            Sin dirección cargada el cliente no sabe dónde retirar el pedido. Completala antes de tomar pedidos.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="mb-3 text-lg font-semibold">Pedidos</h2>
        <Controller
          control={control}
          name="acceptingOrders"
          render={({ field }) => (
            <ToggleField
              checked={field.value}
              onChange={field.onChange}
              label="Tomando pedidos"
              hint="Apagalo para pausar el local sin tocar el catálogo. La carta sigue visible."
            />
          )}
        />
        <Controller
          control={control}
          name="inStorePaymentEnabled"
          render={({ field }) => (
            <ToggleField
              checked={field.value}
              onChange={field.onChange}
              label="Permitir pago al retirar"
              hint="El cliente reserva y paga en el mostrador. Vas a tener que marcarlo cobrado a mano."
            />
          )}
        />
        <div className="mt-3 max-w-2xs">
          <Field htmlFor={minOrderId} label="Pedido mínimo" error={errors.minOrderCents?.message} errorId={`${minOrderId}-error`}>
            <Controller
              control={control}
              name="minOrderCents"
              render={({ field }) => (
                <DraftNumberInput
                  id={minOrderId}
                  value={field.value}
                  onValueChange={field.onChange}
                  scale={100}
                  min={0}
                  step={1}
                  invalid={!!errors.minOrderCents}
                  errorId={errors.minOrderCents ? `${minOrderId}-error` : undefined}
                  className="h-10"
                />
              )}
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Multiplicador de demanda</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            htmlFor={thresholdId}
            label="A partir de cuántos pedidos activos"
            error={errors.demandThresholdOrders?.message}
            errorId={`${thresholdId}-error`}
          >
            <Controller
              control={control}
              name="demandThresholdOrders"
              render={({ field }) => (
                <DraftNumberInput
                  id={thresholdId}
                  value={field.value}
                  onValueChange={(n) => field.onChange(Math.max(1, n))}
                  min={1}
                  step={1}
                  invalid={!!errors.demandThresholdOrders}
                  errorId={errors.demandThresholdOrders ? `${thresholdId}-error` : undefined}
                  className="h-10"
                />
              )}
            />
          </Field>
          <Field
            htmlFor={multiplierId}
            label="Multiplicador"
            error={errors.demandMultiplier?.message}
            errorId={`${multiplierId}-error`}
          >
            <Controller
              control={control}
              name="demandMultiplier"
              render={({ field }) => (
                <DraftNumberInput
                  id={multiplierId}
                  value={field.value}
                  onValueChange={(n) => field.onChange(Math.min(10, Math.max(1, n)))}
                  min={1}
                  max={10}
                  step={0.1}
                  invalid={!!errors.demandMultiplier}
                  errorId={errors.demandMultiplier ? `${multiplierId}-error` : undefined}
                  className="h-10"
                />
              )}
            />
          </Field>
        </div>
        <p className="bg-muted rounded-lg px-3 py-2.5 text-sm">
          Con <span className="tabular font-medium">{demandThresholdOrders}</span> pedidos activos, un pedido de{' '}
          <span className="tabular font-medium">{DEMAND_EXAMPLE_MINUTES} min</span> pasa a decir{' '}
          <span className="tabular font-medium">{exampleEta} min</span>.
        </p>
      </section>

      {erroredFields.length > 0 ? (
        <p role="alert" className="text-destructive text-sm">
          Revisá los campos marcados: {erroredFields.map((key) => FIELD_LABELS[key]).join(', ')}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="h-10 w-fit gap-2">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Guardar ajustes
      </Button>
    </form>
  )
}
