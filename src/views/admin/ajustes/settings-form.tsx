'use client'

import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { Controller, useForm, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { updateStoreSettingsAction, requestCourierPaymentPolicyChangeAction } from '@/controllers/admin.actions'
import { storeSettingsInputSchema, type StoreSettingsInput } from '@/models/schemas/store.schema'
import { scaleUpInt } from '@/lib/money'
import { deliveryFeeFor, deliveryMinutesFor } from '@/lib/delivery'
import { Price } from '@/views/shared/money'
import { MoneyInput } from '@/views/shared/money-input'
import { PanelHeading } from '@/views/admin/page-frame'
import { ConfirmWithCode, type ConfirmWithCodeHandle } from '@/views/admin/shared/confirm-with-code'
import type { Store, StoreDelivery } from '@/models/types'

/**
 * `leaflet` toca `window` apenas se importa (detección de features de
 * browser), así que el campo del mapa se carga con `ssr:false`: Next no
 * evalúa ese módulo en el servidor y el build no se entera de que existe.
 * El esqueleto evita el salto de layout mientras se descarga el chunk.
 */
const LocationMapField = dynamic(() => import('@/views/admin/ajustes/location-map-field'), {
  ssr: false,
  loading: () => <MapFieldSkeleton />,
})

function MapFieldSkeleton() {
  return <div className="bg-muted h-72 w-full animate-pulse rounded-lg" aria-hidden />
}

/** Ejemplo del explicador de demanda: un prep_minutes realista de la carta, no un número redondo inventado. */
const DEMAND_EXAMPLE_MINUTES = 20

/** Ejemplo del explicador de envío: un subtotal realista de un pedido de dos hamburguesas y algo más. */
const DELIVERY_EXAMPLE_SUBTOTAL_CENTS = 8_000_00

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
    autoStartOrders: store.autoStartOrders,
    autoReadyOrders: store.autoReadyOrders,
    deliveryEnabled: store.delivery.enabled,
    deliveryFeeCents: store.delivery.feeCents,
    deliveryFreeFromCents: store.delivery.freeFromCents,
    deliveryMinOrderCents: store.delivery.minOrderCents,
    deliveryMinutes: store.delivery.minutes,
    deliveryBusyMinutes: store.delivery.busyMinutes,
    // `courierCollectsPayment` NO va acá: salió de `storeSettingsInputSchema`
    // (ver el comentario ahí) y ahora es un control confirmado aparte,
    // `CourierCollectsPaymentField` más abajo en este archivo.
    // Mismo criterio que el resto: '' en vez de null porque los inputs no
    // registrados no aceptan un valor DOM nulo.
    instagramHandle: store.links.instagramHandle ?? '',
    mapsUrl: store.links.mapsUrl ?? '',
    rappiUrl: store.links.rappiUrl ?? '',
    pedidosYaUrl: store.links.pedidosYaUrl ?? '',
    uberEatsUrl: store.links.uberEatsUrl ?? '',
    latitude: store.latitude,
    longitude: store.longitude,
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
  autoStartOrders: 'Empezar a cocinar solo',
  autoReadyOrders: 'Marcar listo solo',
  deliveryEnabled: 'Envío propio',
  deliveryFeeCents: 'Costo de envío',
  deliveryFreeFromCents: 'Envío gratis desde',
  deliveryMinOrderCents: 'Mínimo para envío',
  deliveryMinutes: 'Demora del envío',
  deliveryBusyMinutes: 'Demora sin repartidores libres',
  latitude: 'Ubicación en el mapa',
  longitude: 'Ubicación en el mapa',
  instagramHandle: 'Instagram',
  mapsUrl: 'Cómo llegar',
  rappiUrl: 'Rappi',
  pedidosYaUrl: 'PedidosYa',
  uberEatsUrl: 'Uber Eats',
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
 * ve el string tal cual; la conversión a entero pasa por `Math.round` — nunca
 * queda un float a mitad de camino — recién cuando el string es un número
 * válido.
 *
 * Los cuatro campos de plata (pedido mínimo, costo de envío, envío gratis
 * desde, mínimo para envío) usan `MoneyInput` en vez de este componente: ese
 * ya resuelve el prefijo "$" y el agrupado de miles. Lo que queda acá son
 * unidades simples (minutos, cantidad de pedidos, el multiplicador de
 * demanda), así que ya no hace falta un factor de escala.
 */
function DraftNumberInput({
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
function ToggleField({
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
 * "El repartidor cobra en la puerta" — sale del `useForm`/submit general
 * porque es plata, no logística (ver el comentario en `store.schema.ts`).
 * Confirmado con código de 6 dígitos, igual que las credenciales de Mercado
 * Pago, y solo el dueño puede pedirlo: un encargado logueado en la tablet del
 * mostrador no puede mover a dónde va la plata del cobro en la puerta.
 *
 * El valor mostrado es optimista SOLO después de confirmar, nunca antes: el
 * toggle se planta en `pendingValue` mientras el diálogo está abierto y
 * vuelve a `value` (el último confirmado) si se cancela — así nunca miente
 * sobre si el cambio ya se aplicó.
 *
 * `nextValueRef` (no un `useState`) es lo que lee `requestChange`: un ref se
 * actualiza en el mismo tick del click, así que no hay ventana donde
 * `ConfirmWithCode.start()` dispare con el valor de un render anterior.
 */
function CourierCollectsPaymentField({
  storeId,
  initialValue,
  canEdit,
}: {
  storeId: number
  initialValue: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const [pendingValue, setPendingValue] = useState<boolean | null>(null)
  const nextValueRef = useRef(initialValue)
  const confirmRef = useRef<ConfirmWithCodeHandle>(null)

  function handleToggle(next: boolean) {
    if (!canEdit) return
    nextValueRef.current = next
    setPendingValue(next)
    confirmRef.current?.start()
  }

  return (
    <>
      <ToggleField
        checked={pendingValue ?? value}
        onChange={handleToggle}
        disabled={!canEdit}
        label="El repartidor cobra en la puerta"
        hint={
          canEdit
            ? 'Con esto apagado, el portal del repartidor no ve ningún monto: el cobro ya quedó resuelto antes de salir a la calle. Cambiarlo pide un código que te llega por mail.'
            : 'Es plata, no logística: solo el dueño del local puede cambiarlo. Pedile que entre a Ajustes desde su cuenta.'
        }
      />
      <ConfirmWithCode
        ref={confirmRef}
        storeId={storeId}
        title="Confirmá quién cobra en la puerta"
        description="Es plata: cambia si el repartidor cobra en efectivo/POSNET o si el pedido ya viene resuelto por Mercado Pago."
        requestChange={() => requestCourierPaymentPolicyChangeAction(storeId, nextValueRef.current)}
        onCancel={() => setPendingValue(null)}
        onConfirmed={() => {
          setValue(nextValueRef.current)
          setPendingValue(null)
          toast.success('Actualizamos quién cobra en la puerta')
          router.refresh()
        }}
      />
    </>
  )
}

export function SettingsForm({ storeId, store, role }: { storeId: number; store: Store; role: 'owner' | 'staff' }) {
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
  const instagramId = useId()
  const mapsUrlId = useId()
  const rappiUrlId = useId()
  const pedidosYaUrlId = useId()
  const uberEatsUrlId = useId()
  const deliveryFeeId = useId()
  const deliveryFreeFromId = useId()
  const deliveryMinOrderId = useId()
  const deliveryMinutesId = useId()
  const deliveryBusyMinutesId = useId()

  const demandMultiplier = useWatch({ control, name: 'demandMultiplier' })
  const demandThresholdOrders = useWatch({ control, name: 'demandThresholdOrders' })
  const address = useWatch({ control, name: 'address' })
  const deliveryEnabled = useWatch({ control, name: 'deliveryEnabled' })
  const deliveryFeeCents = useWatch({ control, name: 'deliveryFeeCents' })
  const deliveryFreeFromCents = useWatch({ control, name: 'deliveryFreeFromCents' })
  const deliveryMinOrderCents = useWatch({ control, name: 'deliveryMinOrderCents' })
  const deliveryMinutes = useWatch({ control, name: 'deliveryMinutes' })
  const deliveryBusyMinutes = useWatch({ control, name: 'deliveryBusyMinutes' })

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

  // Mismas funciones puras que usa el servidor para cobrar (src/lib/delivery.ts):
  // el número que el dueño ve acá tiene que ser el mismo que después le cobra al
  // cliente, nunca una segunda cuenta hecha a mano en el formulario.
  const exampleDelivery: StoreDelivery = useMemo(
    () => ({
      enabled: true,
      feeCents: deliveryFeeCents,
      freeFromCents: deliveryFreeFromCents,
      minOrderCents: deliveryMinOrderCents,
      minutes: deliveryMinutes,
      busyMinutes: deliveryBusyMinutes,
      courierCollects: false,
    }),
    [deliveryFeeCents, deliveryFreeFromCents, deliveryMinOrderCents, deliveryMinutes, deliveryBusyMinutes],
  )
  const exampleFeeCents = deliveryFeeFor(exampleDelivery, DELIVERY_EXAMPLE_SUBTOTAL_CENTS)
  const exampleTotalCents = DELIVERY_EXAMPLE_SUBTOTAL_CENTS + exampleFeeCents
  const exampleMinutesFree = deliveryMinutesFor(exampleDelivery, 1)
  const exampleMinutesBusy = deliveryMinutesFor(exampleDelivery, 0)

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <PanelHeading title="Datos del local" />
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
        <LocationMapField storeId={storeId} control={control} />
      </section>

      <section className="flex flex-col gap-4">
        <PanelHeading title="Canales del local" />
        <p className="text-muted-foreground text-sm">
          Lo que cargues acá aparece en la barra flotante al pie de tu carta. Los que dejes vacíos no se muestran.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            htmlFor={instagramId}
            label="Instagram"
            hint="Solo el usuario. La dirección la armamos nosotros."
            error={errors.instagramHandle?.message}
            errorId={`${instagramId}-error`}
          >
            {/*
              Prefijo "@" DENTRO del campo, no un placeholder: lo que se
              guarda es el usuario, y un placeholder desaparece apenas el
              dueño empieza a tipear — el "@" tiene que quedar visible todo
              el tiempo para que no intente pegar la URL entera.
            */}
            <div className="relative">
              <span
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
              >
                @
              </span>
              <Input
                id={instagramId}
                autoCapitalize="none"
                spellCheck={false}
                {...register('instagramHandle', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.instagramHandle}
                aria-describedby={errors.instagramHandle ? `${instagramId}-error` : undefined}
                className="h-10 pl-7"
              />
            </div>
          </Field>
          <Field
            htmlFor={mapsUrlId}
            label="Cómo llegar"
            hint="Link de Google Maps o Apple Maps. Si lo dejás vacío usamos la dirección de arriba."
            error={errors.mapsUrl?.message}
            errorId={`${mapsUrlId}-error`}
          >
            <Input
              id={mapsUrlId}
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              {...register('mapsUrl', { setValueAs: toEmptyToNull })}
              aria-invalid={!!errors.mapsUrl}
              aria-describedby={errors.mapsUrl ? `${mapsUrlId}-error` : undefined}
              className="h-10"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-foreground text-sm font-semibold">Pedir por</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              htmlFor={rappiUrlId}
              label="Rappi"
              hint="Link a tu local en Rappi"
              error={errors.rappiUrl?.message}
              errorId={`${rappiUrlId}-error`}
            >
              <Input
                id={rappiUrlId}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                {...register('rappiUrl', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.rappiUrl}
                aria-describedby={errors.rappiUrl ? `${rappiUrlId}-error` : undefined}
                className="h-10"
              />
            </Field>
            <Field
              htmlFor={pedidosYaUrlId}
              label="PedidosYa"
              hint="Link a tu local en PedidosYa"
              error={errors.pedidosYaUrl?.message}
              errorId={`${pedidosYaUrlId}-error`}
            >
              <Input
                id={pedidosYaUrlId}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                {...register('pedidosYaUrl', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.pedidosYaUrl}
                aria-describedby={errors.pedidosYaUrl ? `${pedidosYaUrlId}-error` : undefined}
                className="h-10"
              />
            </Field>
            <Field
              htmlFor={uberEatsUrlId}
              label="Uber Eats"
              hint="Link a tu local en Uber Eats"
              error={errors.uberEatsUrl?.message}
              errorId={`${uberEatsUrlId}-error`}
            >
              <Input
                id={uberEatsUrlId}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                {...register('uberEatsUrl', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.uberEatsUrl}
                aria-describedby={errors.uberEatsUrl ? `${uberEatsUrlId}-error` : undefined}
                className="h-10"
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <PanelHeading title="Pedidos" />
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
        <div className="mt-3 max-w-xs">
          <Field htmlFor={minOrderId} label="Pedido mínimo" error={errors.minOrderCents?.message} errorId={`${minOrderId}-error`}>
            <Controller
              control={control}
              name="minOrderCents"
              render={({ field }) => (
                <MoneyInput
                  id={minOrderId}
                  cents={field.value}
                  onCentsChange={field.onChange}
                  currency={store.currency}
                  invalid={!!errors.minOrderCents}
                  errorId={errors.minOrderCents ? `${minOrderId}-error` : undefined}
                  className="h-10"
                />
              )}
            />
          </Field>
        </div>

        {/*
          Los dos toggles de automatización van ACÁ, dentro de "Pedidos" y
          pegados al multiplicador de demanda que sigue debajo — no en una
          sección "Automatización" aparte. El auto-listo dispara sobre el ETA
          que produce ese multiplicador, así que separarlos escondería la
          dependencia en vez de mostrarla.
        */}
        <div className="border-border mt-5 flex flex-col gap-1 border-t pt-4">
          <Controller
            control={control}
            name="autoStartOrders"
            render={({ field }) => (
              <ToggleField
                checked={field.value}
                onChange={field.onChange}
                label="Empezar a cocinar solo"
                hint="Pasa de Confirmado a Preparando sin que nadie toque el panel. Se revisa cada 2 minutos."
              />
            )}
          />
          <Controller
            control={control}
            name="autoReadyOrders"
            render={({ field }) => (
              <ToggleField
                checked={field.value}
                onChange={field.onChange}
                label="Marcar listo solo"
                hint="Al cumplirse el tiempo estimado pasa de Preparando a Listo y le avisa al cliente. Entregar y cobrar siguen siendo tuyos."
              />
            )}
          />
          <div className="bg-warning/20 text-warning-foreground mt-2 flex gap-2.5 rounded-lg p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1.5">
              <p>
                <span className="font-medium">Antes de activar &ldquo;Marcar listo solo&rdquo;:</span> si la cocina
                va atrasada, el aviso sale igual — el cliente puede llegar antes de que la comida esté lista.
              </p>
              <p>
                Y el tablero deja de mostrar el aviso de &ldquo;pasó el tiempo estimado&rdquo;: con esto prendido
                ningún pedido puede quedar en Preparando después de su ETA. Cambiás esa alarma de atraso por la
                automatización — asegurate de que la cocina de verdad cumpla el tiempo antes de prenderlo.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        {/*
          Va acá, entre "Pedidos" y "Multiplicador de demanda": los minutos de
          viaje del envío se suman al ETA que ese multiplicador produce, así
          que las dos secciones tienen que quedar contiguas.
        */}
        <PanelHeading title="Envío propio" />
        <Controller
          control={control}
          name="deliveryEnabled"
          render={({ field }) => (
            <ToggleField
              checked={field.value}
              onChange={field.onChange}
              label="Hacemos envíos a domicilio"
              hint="Además de retirar en el local, el cliente puede pedir que se lo lleven a domicilio."
            />
          )}
        />

        {deliveryEnabled ? (
          <div className="border-border mt-1 flex flex-col gap-4 border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor={deliveryFeeId}
                label="Costo de envío"
                error={errors.deliveryFeeCents?.message}
                errorId={`${deliveryFeeId}-error`}
              >
                <Controller
                  control={control}
                  name="deliveryFeeCents"
                  render={({ field }) => (
                    <MoneyInput
                      id={deliveryFeeId}
                      cents={field.value}
                      onCentsChange={field.onChange}
                      currency={store.currency}
                      invalid={!!errors.deliveryFeeCents}
                      errorId={errors.deliveryFeeCents ? `${deliveryFeeId}-error` : undefined}
                      className="h-10"
                    />
                  )}
                />
              </Field>
              <Field
                htmlFor={deliveryFreeFromId}
                label="Envío gratis a partir de"
                hint="0 = el envío nunca es gratis."
                error={errors.deliveryFreeFromCents?.message}
                errorId={`${deliveryFreeFromId}-error`}
              >
                <Controller
                  control={control}
                  name="deliveryFreeFromCents"
                  render={({ field }) => (
                    <MoneyInput
                      id={deliveryFreeFromId}
                      cents={field.value}
                      onCentsChange={field.onChange}
                      currency={store.currency}
                      invalid={!!errors.deliveryFreeFromCents}
                      errorId={errors.deliveryFreeFromCents ? `${deliveryFreeFromId}-error` : undefined}
                      className="h-10"
                    />
                  )}
                />
              </Field>
            </div>

            <div className="max-w-xs">
              <Field
                htmlFor={deliveryMinOrderId}
                label="Pedido mínimo para envío"
                hint="0 = sin mínimo propio. Es aparte del pedido mínimo general."
                error={errors.deliveryMinOrderCents?.message}
                errorId={`${deliveryMinOrderId}-error`}
              >
                <Controller
                  control={control}
                  name="deliveryMinOrderCents"
                  render={({ field }) => (
                    <MoneyInput
                      id={deliveryMinOrderId}
                      cents={field.value}
                      onCentsChange={field.onChange}
                      currency={store.currency}
                      invalid={!!errors.deliveryMinOrderCents}
                      errorId={errors.deliveryMinOrderCents ? `${deliveryMinOrderId}-error` : undefined}
                      className="h-10"
                    />
                  )}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor={deliveryMinutesId}
                label="Demora del envío"
                hint="Minutos de viaje con un repartidor libre."
                error={errors.deliveryMinutes?.message}
                errorId={`${deliveryMinutesId}-error`}
              >
                <Controller
                  control={control}
                  name="deliveryMinutes"
                  render={({ field }) => (
                    <DraftNumberInput
                      id={deliveryMinutesId}
                      value={field.value}
                      onValueChange={field.onChange}
                      min={0}
                      max={240}
                      step={1}
                      invalid={!!errors.deliveryMinutes}
                      errorId={errors.deliveryMinutes ? `${deliveryMinutesId}-error` : undefined}
                      className="h-10"
                    />
                  )}
                />
              </Field>
              <Field
                htmlFor={deliveryBusyMinutesId}
                label="Si no hay repartidores libres"
                hint="Minutos de viaje cuando todos están en la calle."
                error={errors.deliveryBusyMinutes?.message}
                errorId={`${deliveryBusyMinutesId}-error`}
              >
                <Controller
                  control={control}
                  name="deliveryBusyMinutes"
                  render={({ field }) => (
                    <DraftNumberInput
                      id={deliveryBusyMinutesId}
                      value={field.value}
                      onValueChange={field.onChange}
                      min={0}
                      max={240}
                      step={1}
                      invalid={!!errors.deliveryBusyMinutes}
                      errorId={errors.deliveryBusyMinutes ? `${deliveryBusyMinutesId}-error` : undefined}
                      className="h-10"
                    />
                  )}
                />
              </Field>
            </div>
            {deliveryBusyMinutes < deliveryMinutes ? (
              <p className="text-warning-foreground text-xs">
                &ldquo;Si no hay repartidores libres&rdquo; quedó con menos minutos que la demora normal —
                probablemente no era la intención.
              </p>
            ) : null}

            <p className="bg-muted rounded-lg px-3 py-2.5 text-sm leading-relaxed">
              Un pedido de <Price cents={DELIVERY_EXAMPLE_SUBTOTAL_CENTS} currency={store.currency} className="font-medium" /> paga{' '}
              <Price cents={exampleFeeCents} currency={store.currency} className="font-medium" /> de envío: total{' '}
              <Price cents={exampleTotalCents} currency={store.currency} className="font-medium" />. Con un repartidor libre el viaje
              suma <span className="tabular font-medium">{exampleMinutesFree} min</span> a la demora de la cocina; si están todos
              ocupados, suma <span className="tabular font-medium">{exampleMinutesBusy} min</span>.
            </p>

            <CourierCollectsPaymentField
              storeId={storeId}
              initialValue={store.delivery.courierCollects}
              canEdit={role === 'owner'}
            />

            <p className="text-muted-foreground text-xs">
              Los repartidores no se configuran acá:{' '}
              <Link href="/admin/repartidores" className="underline underline-offset-2">
                se gestionan en Repartidores
              </Link>
              . Si activás el envío y todavía no invitaste a ninguno, la opción no le va a aparecer al cliente.
            </p>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <PanelHeading title="Multiplicador de demanda" />
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

      {/*
        Barra de guardado pegajosa (F-brief C): en una pantalla de mostrador
        este formulario es más alto que el viewport, y el encargado no puede
        depender de scrollear hasta el final para guardar un cambio que hizo
        arriba del todo. `sticky bottom-0` la clava al pie de la ventana
        mientras el formulario sigue en pantalla, y deja de estarlo sola
        cuando termina el flujo del `<form>` — sin JS, sin `fixed` que tape
        contenido de otra página.
        El `-mx-4 lg:-mx-8` cancela el padding del `PageFrame` (que es
        exactamente `--admin-gutter`/`--admin-gutter-lg`, 1rem/2rem) para que
        la barra llegue a los bordes de la columna en vez de flotar angosta
        adentro de ella; el `px-4 lg:px-8` de acá adentro lo repone para el
        contenido de la barra.
      */}
      <div className="bg-background/95 border-border sticky bottom-0 -mx-4 -mb-6 flex flex-col gap-2 border-t px-4 py-4 backdrop-blur lg:-mx-8 lg:-mb-8 lg:px-8">
        {erroredFields.length > 0 ? (
          <p role="alert" className="text-destructive text-sm">
            Revisá los campos marcados: {erroredFields.map((key) => FIELD_LABELS[key]).join(', ')}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="h-10 w-fit gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar ajustes
        </Button>
      </div>
    </form>
  )
}
