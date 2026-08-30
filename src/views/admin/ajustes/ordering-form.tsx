'use client'

import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { Controller, useForm, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Zap } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  updateStoreOrderingAction,
  requestCourierPaymentPolicyChangeAction,
  previewScheduledNightAction,
  pauseScheduledNightAction,
  resumeAcceptingOrdersAction,
} from '@/controllers/admin.actions'
import { storeOrderingInputSchema, type StoreOrderingInput } from '@/models/schemas/store.schema'
import { scaleUpInt } from '@/lib/money'
import { deliveryFeeFor, deliveryMinutesFor } from '@/lib/delivery'
import { Price } from '@/views/shared/money'
import { MoneyInput } from '@/views/shared/money-input'
import { PanelHeading } from '@/views/admin/page-frame'
import { ConfirmWithCode, type ConfirmWithCodeHandle } from '@/views/admin/shared/confirm-with-code'
import {
  CancelScheduledOrdersDialog,
  type AffectedOrders,
} from '@/views/admin/shared/cancel-scheduled-orders-dialog'
import { Field, DraftNumberInput, ToggleField, SaveBar } from '@/views/admin/ajustes/fields'
import type { Store, StoreDelivery } from '@/models/types'

/** Ejemplo del explicador de demanda: un prep_minutes realista de la carta, no un número redondo inventado. */
const DEMAND_EXAMPLE_MINUTES = 20

/** Ejemplo del explicador de envío: un subtotal realista de un pedido de dos hamburguesas y algo más. */
const DELIVERY_EXAMPLE_SUBTOTAL_CENTS = 8_000_00

function storeToOrderingInput(store: Store): StoreOrderingInput {
  return {
    inStorePaymentEnabled: store.inStorePaymentEnabled,
    minOrderCents: store.minOrderCents,
    autoStartOrders: store.autoStartOrders,
    autoReadyOrders: store.autoReadyOrders,
    deliveryEnabled: store.delivery.enabled,
    deliveryFeeCents: store.delivery.feeCents,
    deliveryFreeFromCents: store.delivery.freeFromCents,
    deliveryMinOrderCents: store.delivery.minOrderCents,
    deliveryMinutes: store.delivery.minutes,
    deliveryBusyMinutes: store.delivery.busyMinutes,
    // Nombres de columna, no de grupo: `scheduling.deliveryEnabled` no puede
    // aplanarse a `deliveryEnabled` a secas — esa clave ya es del envío propio
    // (§StoreDelivery) y colisionaría.
    scheduledDeliveryEnabled: store.scheduling.deliveryEnabled,
    scheduledCapacityPerNight: store.scheduling.capacityPerNight,
    demandThresholdOrders: store.demandThresholdOrders,
    demandMultiplier: store.demandMultiplier,
    // `courierCollectsPayment` NO va acá: salió de `storeOrderingInputSchema`
    // (ver el comentario en store.schema.ts) y es un control confirmado
    // aparte, `CourierCollectsPaymentField` más abajo en este archivo.
  }
}

/** Traduce las claves internas del schema a lo que el dueño del local reconoce (F-05). */
const FIELD_LABELS: Record<keyof StoreOrderingInput, string> = {
  inStorePaymentEnabled: 'Pago al retirar',
  minOrderCents: 'Pedido mínimo',
  autoStartOrders: 'Empezar a cocinar solo',
  autoReadyOrders: 'Marcar listo solo',
  deliveryEnabled: 'Envío propio',
  deliveryFeeCents: 'Costo de envío',
  deliveryFreeFromCents: 'Envío gratis desde',
  deliveryMinOrderCents: 'Mínimo para envío',
  deliveryMinutes: 'Demora del envío',
  deliveryBusyMinutes: 'Demora sin repartidores libres',
  scheduledDeliveryEnabled: 'Programar con envío',
  scheduledCapacityPerNight: 'Tope de programados por noche',
  demandThresholdOrders: 'Umbral de demanda',
  demandMultiplier: 'Multiplicador de demanda',
}

/**
 * Convención visual que distingue los dos controles que se aplican SOLOS
 * ("Tomando pedidos" y "El repartidor cobra en la puerta") del resto de esta
 * página, que espera el botón "Guardar cambios" de más abajo.
 *
 * Antes de este slice, los tres mecanismos de guardado convivían sin ninguna
 * señal: el encargado tocaba un switch, veía la misma barra de "Guardar" al
 * pie, y no tenía forma de saber que ESE switch ya se había aplicado —o que
 * iba a pedir un código por mail— sin pasar por ella (00-architecture.md, "El
 * defecto de fondo"). El marco + el rótulo con el rayo son la señal: un
 * borde propio y un renglón que dice, en la misma línea en la que está el
 * control, que esto no espera a nada más.
 *
 * `Zap` no se usa en ningún otro lugar del panel todavía, así que queda libre
 * para significar exactamente "esto es instantáneo" sin chocar con otro uso.
 */
function ImmediateControl({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-1 rounded-lg border p-2">
      <p className="text-muted-foreground flex items-center gap-1.5 px-1.5 pt-0.5 text-xs font-medium">
        <Zap className="size-3.5 shrink-0" aria-hidden />
        Se aplica al instante, no espera a &ldquo;Guardar cambios&rdquo;
      </p>
      {children}
    </div>
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

/**
 * "Tomando pedidos" dejó de ser un booleano gratis, y dejó de viajar en el
 * `useForm` general de esta página (03-review.md, hallazgo bloqueante #1):
 * antes solo APAGARLO se aplicaba solo, prenderlo esperaba a "Guardar
 * cambios" mientras el banner de arriba (`ImmediateControl`) decía "se
 * aplica al instante" en los dos casos. Eso mentía al reabrir, y además
 * exponía una segunda falla: como el valor viajaba en el form, si otra
 * persona pausaba el local desde otro dispositivo, quien tuviera esta
 * pantalla abierta con el valor viejo lo reabría sin querer al guardar
 * cualquier otro campo.
 *
 * Ahora el switch maneja su propio estado, sembrado desde `store.acceptingOrders`
 * (`initialValue`), y las dos direcciones pegan directo al servidor:
 *
 * - APAGAR puede cancelar pedidos programados ya pagados, así que la
 *   consecuencia se ve ANTES de aplicarse: pide el conteo real de la noche en
 *   curso y solo si el dueño confirma en el diálogo destructivo se ejecuta
 *   `pauseScheduledNightAction`.
 * - PRENDER nunca es destructivo (no hay diálogo), pero tampoco es gratis:
 *   llama a `resumeAcceptingOrdersAction` y recién con el `ok` actualiza el
 *   switch, el toast y `router.refresh()`. Si falla, el switch vuelve a
 *   apagado (no se optimiza el valor) y sale un toast de error.
 *
 * Mientras cualquiera de las dos acciones está en vuelo el switch queda
 * deshabilitado (`busy`), para que un doble tap no dispare dos pedidos de
 * reapertura ni abra el diálogo de pausa dos veces.
 */
function AcceptingOrdersToggle({
  storeId,
  currency,
  initialValue,
}: {
  storeId: number
  currency: string
  initialValue: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const [resuming, setResuming] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [affected, setAffected] = useState<AffectedOrders | null>(null)

  function handleToggle(next: boolean) {
    if (next) {
      setResuming(true)
      void (async () => {
        const result = await resumeAcceptingOrdersAction(storeId)
        setResuming(false)
        if (!result.ok) {
          // No se optimiza el valor: si el servidor rechaza la reapertura, el
          // switch se queda apagado en vez de mostrar un "prendido" que no es cierto.
          toast.error('No pudimos reabrir el local', { description: result.error })
          return
        }
        setValue(true)
        toast.success('Volviste a tomar pedidos')
        router.refresh()
      })()
      return
    }
    setDialogOpen(true)
    setLoading(true)
    setAffected(null)
    void (async () => {
      const result = await previewScheduledNightAction(storeId)
      setLoading(false)
      if (!result.ok) {
        toast.error('No pudimos calcular el impacto', { description: result.error })
        setDialogOpen(false)
        return
      }
      setAffected(result.data)
    })()
  }

  return (
    <>
      <ToggleField
        checked={value}
        onChange={handleToggle}
        disabled={resuming}
        label="Tomando pedidos"
        hint="Es el freno de mano: se aplica encima del horario. Apagalo para cerrar ahora aunque el horario diga que estás abierto."
      />
      <CancelScheduledOrdersDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        loading={loading}
        affected={affected}
        currency={currency}
        subject="de esta noche"
        destructiveLabel="Pausar y cancelar"
        safeLabel="Pausar pedidos"
        onConfirm={() => pauseScheduledNightAction(storeId)}
        onConfirmed={() => {
          setValue(false)
          toast.success('Pausaste el local')
          router.refresh()
        }}
      />
    </>
  )
}

/**
 * "Pedidos y envío": tomando pedidos, pago en el local, envío propio,
 * programados, multiplicador de demanda. Antes eran los bloques 3–6 (más el
 * campo de repartidor cobra) de `settings-form.tsx`; quedan juntos en una
 * sola página porque `scheduledDeliveryEnabled` depende de `deliveryEnabled`
 * y los minutos de viaje entran al mismo cálculo de ETA que el multiplicador
 * de demanda (00-architecture.md).
 */
export function OrderingForm({ storeId, store, role }: { storeId: number; store: Store; role: 'owner' | 'staff' }) {
  const [pending, startTransition] = useTransition()
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<StoreOrderingInput>({
    // Ver el comentario equivalente en product-drawer.tsx: `z.coerce.number()`
    // hace que Zod infiera `unknown` para el tipo de entrada de esos campos.
    resolver: zodResolver(storeOrderingInputSchema) as Resolver<StoreOrderingInput>,
    defaultValues: storeToOrderingInput(store),
  })

  const minOrderId = useId()
  const thresholdId = useId()
  const multiplierId = useId()
  const deliveryFeeId = useId()
  const deliveryFreeFromId = useId()
  const deliveryMinOrderId = useId()
  const deliveryMinutesId = useId()
  const deliveryBusyMinutesId = useId()
  const scheduledCapacityId = useId()

  const demandMultiplier = useWatch({ control, name: 'demandMultiplier' })
  const demandThresholdOrders = useWatch({ control, name: 'demandThresholdOrders' })
  const deliveryEnabled = useWatch({ control, name: 'deliveryEnabled' })
  const deliveryFeeCents = useWatch({ control, name: 'deliveryFeeCents' })
  const deliveryFreeFromCents = useWatch({ control, name: 'deliveryFreeFromCents' })
  const deliveryMinOrderCents = useWatch({ control, name: 'deliveryMinOrderCents' })
  const deliveryMinutes = useWatch({ control, name: 'deliveryMinutes' })
  const deliveryBusyMinutes = useWatch({ control, name: 'deliveryBusyMinutes' })

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await updateStoreOrderingAction(storeId, values)
      if (!result.ok) {
        toast.error('No se pudo guardar', { description: result.error })
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (field in FIELD_LABELS) setError(field as FieldPath<StoreOrderingInput>, { type: 'server', message: messages[0] })
        }
        return
      }
      toast.success('Guardaste los ajustes de pedidos')
    })
  })

  // `scaleUpInt`, no `Math.ceil(base * mult)`: con multiplicadores decimales
  // (1.1, 1.5) el float se pasa de largo — `20 * 1.1` da 22.000000000000004 —
  // y acá el número es justo lo que le estamos prometiendo entender al dueño.
  const exampleEta = useMemo(() => scaleUpInt(DEMAND_EXAMPLE_MINUTES, demandMultiplier), [demandMultiplier])
  const erroredFields = (Object.keys(errors) as (keyof StoreOrderingInput)[]).filter((key) => key in FIELD_LABELS)

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
      <section className="flex flex-col gap-1">
        <PanelHeading title="Pedidos" />
        <ImmediateControl>
          <AcceptingOrdersToggle storeId={storeId} currency={store.currency} initialValue={store.acceptingOrders} />
        </ImmediateControl>
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

            <ImmediateControl>
              <CourierCollectsPaymentField
                storeId={storeId}
                initialValue={store.delivery.courierCollects}
                canEdit={role === 'owner'}
              />
            </ImmediateControl>

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
        {/*
          El horario semanal y las excepciones por fecha viven en su propia
          página (`horarios/`, `ScheduleEditor`): son un reemplazo
          transaccional vía RPC, no un campo más de este `useForm`. Acá solo
          van las dos preferencias que SÍ son columnas de `stores` con grant
          directo y se guardan con el resto.
        */}
        <PanelHeading title="Pedidos programados" description="El horario y las excepciones por fecha se cargan en Horarios." />
        <Controller
          control={control}
          name="scheduledDeliveryEnabled"
          render={({ field }) => (
            <ToggleField
              checked={field.value}
              onChange={field.onChange}
              label="Permitir programar con envío"
              hint="Además de retirar en el local, el cliente puede elegir una hora futura y que se lo lleven a domicilio. Necesita al menos un repartidor activo invitado."
              disabled={!deliveryEnabled}
            />
          )}
        />
        {!deliveryEnabled ? (
          <p className="text-muted-foreground text-xs">Activá &ldquo;Hacemos envíos a domicilio&rdquo; arriba para poder ofrecer esto.</p>
        ) : null}

        <Controller
          control={control}
          name="scheduledCapacityPerNight"
          render={({ field }) => (
            <div className="mt-2 flex flex-col gap-2">
              <label htmlFor={`${scheduledCapacityId}-toggle`} className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  id={`${scheduledCapacityId}-toggle`}
                  checked={field.value !== null}
                  onCheckedChange={(v) => field.onChange(v === true ? 10 : null)}
                />
                Poner un tope de pedidos programados por noche
              </label>
              {field.value !== null ? (
                <div className="max-w-[10rem]">
                  <DraftNumberInput
                    id={scheduledCapacityId}
                    value={field.value}
                    onValueChange={(n) => field.onChange(Math.max(1, n))}
                    min={1}
                    step={1}
                    invalid={!!errors.scheduledCapacityPerNight}
                    className="h-10"
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Sin tope: se acepta cualquier cantidad de programados por noche. No limita los pedidos para ahora.
                </p>
              )}
              {errors.scheduledCapacityPerNight ? (
                <p role="alert" className="text-destructive text-xs">
                  {errors.scheduledCapacityPerNight.message}
                </p>
              ) : null}
            </div>
          )}
        />
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

      <SaveBar pending={pending} errorMessages={erroredFields.map((key) => FIELD_LABELS[key])} />
    </form>
  )
}
