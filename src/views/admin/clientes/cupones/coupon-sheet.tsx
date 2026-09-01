'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Controller, useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2, Shuffle } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MoneyInput } from '@/views/shared/money-input'
import { formatCents } from '@/lib/money'
import { requiresConfirmation, worstCaseCents, type CouponShape } from '@/lib/coupon'
import {
  createCouponDraftAction,
  updateCouponAction,
  setCouponStatusAction,
  requestCouponActivationAction,
} from '@/controllers/marketing.actions'
import { couponInputSchema, type CouponInput } from '@/models/schemas/coupon.schema'
import { PaymentMethodChecks } from './payment-method-checks'
import { ConfirmCouponCode, type ConfirmCouponCodeHandle } from './confirm-coupon-code'
import type { PendingChangeStarted } from '@/controllers/admin.controller'
import { ConfirmDeleteCouponButton } from './confirm-delete-coupon'
import { generateCouponCodeClient, isoToLocalDay, localDayToEndIso, localDayToStartIso } from './format'
import type { Coupon, PaymentMethod } from '@/models/types'

/** Claves válidas de `CouponInput`, para no pisar un campo que el form no tiene (mismo patrón que `product-drawer.tsx`). */
const COUPON_FIELD_KEYS: Record<keyof CouponInput, true> = {
  name: true,
  code: true,
  discountType: true,
  percent: true,
  amountOffCents: true,
  maxDiscountCents: true,
  minSubtotalCents: true,
  startsAt: true,
  endsAt: true,
  maxRedemptions: true,
  maxRedemptionsPerPhone: true,
  paymentMethods: true,
}

function toCouponShape(input: CouponInput, status: Coupon['status']): CouponShape {
  return { ...input, status }
}

function toFormValues(coupon: Coupon | null, seed: CouponInput | null): CouponInput {
  if (coupon) {
    return {
      name: coupon.name,
      code: coupon.code,
      discountType: coupon.discountType,
      percent: coupon.percent,
      amountOffCents: coupon.amountOffCents,
      maxDiscountCents: coupon.maxDiscountCents,
      minSubtotalCents: coupon.minSubtotalCents,
      startsAt: coupon.startsAt,
      endsAt: coupon.endsAt,
      maxRedemptions: coupon.maxRedemptions,
      maxRedemptionsPerPhone: coupon.maxRedemptionsPerPhone,
      paymentMethods: coupon.paymentMethods,
    }
  }
  if (seed) return seed
  return {
    name: '',
    code: generateCouponCodeClient(),
    discountType: 'percentage',
    percent: 10,
    amountOffCents: null,
    maxDiscountCents: null,
    minSubtotalCents: 0,
    startsAt: null,
    endsAt: null,
    maxRedemptions: 100,
    maxRedemptionsPerPhone: 1,
    paymentMethods: null,
  }
}

/**
 * La hoja de crear/editar un cupón (§5.6 y §5.11.3 del plan). Dos tiempos:
 * "Guardar borrador" (gratis, ilimitado) y "Activar" (pide el código de 6
 * dígitos). El peor caso en pesos se recalcula en vivo con cada tecla —es la
 * diferencia entre una decisión informada y un formulario— y el aviso del pie
 * dice, ANTES de guardar, si ese guardado va a pedir código.
 *
 * El padre remonta este componente con una `key` distinta por cupón (mismo
 * patrón que `ProductDrawer`), así que el estado interno (`current`, el form)
 * arranca limpio en cada apertura. `current` empieza en la prop `coupon` y se
 * actualiza con la respuesta de cada Server Action: no hace falta esperar al
 * `router.refresh()` de `onSaved` para que la hoja misma quede consistente.
 */
export function CouponSheet({
  storeId,
  currency,
  timezone,
  coupon,
  duplicateSeed,
  paymentAvailability,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: number
  currency: string
  timezone: string
  /** `null` = crear. Un cupón existente = editar. */
  coupon: Coupon | null
  /** Solo se usa cuando `coupon` es `null`: los valores de un "Duplicar" (ver `coupon-list.tsx`). */
  duplicateSeed?: CouponInput | null
  paymentAvailability: Record<PaymentMethod, boolean>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [current, setCurrent] = useState<Coupon | null>(coupon)
  const [pending, startTransition] = useTransition()
  const confirmRef = useRef<ConfirmCouponCodeHandle>(null)
  // `useState`, no `useRef`: el título y la descripción del diálogo de código
  // se leen de esto en cada render, y un ref que cambia no dispara uno solo.
  const [pendingIntent, setPendingIntent] = useState<'activate' | 'update'>('update')
  // `react-hooks/refs` prohíbe leer un ref adentro de una función que se le
  // pasa a algo que React no reconoce (acá, el `handleSubmit` de
  // react-hook-form): no puede probar que RHF no la llama en el render. La
  // solución es la misma que ya documenta `location-map-field.tsx` para
  // ESCRIBIR un ref durante el render: sacar el acceso al ref afuera, a un
  // efecto. Este estado es el puente — un "abrí esto" de una sola vez, que el
  // efecto de abajo consume y limpia.
  const [openConfirmWith, setOpenConfirmWith] = useState<PendingChangeStarted | null>(null)

  useEffect(() => {
    // Sin reset a `null` acá adentro: cada pending change que llega del
    // servidor es un objeto NUEVO (otro `requestId`), así que la
    // desigualdad de referencia ya dispara el efecto en la próxima vez sin
    // necesidad de un `setState` síncrono en el cuerpo del efecto (que
    // `react-hooks/set-state-in-effect` prohíbe).
    if (openConfirmWith) confirmRef.current?.openWithPending(openConfirmWith)
  }, [openConfirmWith])

  const {
    control,
    register,
    handleSubmit,
    getValues,
    trigger,
    setValue,
    setError,
    formState: { errors },
  } = useForm<CouponInput>({
    resolver: zodResolver(couponInputSchema) as Resolver<CouponInput>,
    defaultValues: toFormValues(coupon, duplicateSeed ?? null),
  })

  const discountType = useWatch({ control, name: 'discountType' })
  const watched = useWatch({ control })

  const nameError = errors.name?.message
  const codeError = errors.code?.message
  const percentError = errors.percent?.message
  const amountOffError = errors.amountOffCents?.message
  const maxDiscountError = errors.maxDiscountCents?.message
  const minSubtotalError = errors.minSubtotalCents?.message
  const maxRedemptionsError = errors.maxRedemptions?.message
  const rootError = errors.root?.message

  // El peor caso en pesos, en vivo. `worstCaseCents()` toma un `Coupon`
  // completo, pero solo lee estos cinco campos — el resto no aplica a un
  // formulario que todavía no tiene fila en la base, así que el cast es
  // deliberado y no una forma real de `Coupon` (ver la firma en `lib/coupon.ts`).
  const worstCase = useMemo(() => {
    const shape = {
      discountType: watched.discountType,
      percent: watched.percent ?? null,
      amountOffCents: watched.amountOffCents ?? null,
      maxDiscountCents: watched.maxDiscountCents ?? null,
      maxRedemptions: watched.maxRedemptions ?? 0,
    } as unknown as Coupon
    return worstCaseCents(shape)
  }, [watched.discountType, watched.percent, watched.amountOffCents, watched.maxDiscountCents, watched.maxRedemptions])

  // El aviso del pie: corre ACÁ, mientras se tipea, con la misma función que
  // corre en el servidor. Coordinación 2026-09-01: mientras el resultado del
  // cambio no sea `active`, nunca pide código — así que en creación y
  // mientras el cupón está `draft`/`paused` este chequeo ni se llama.
  const activeChangeRequiresCode = useMemo(() => {
    if (!current || current.status !== 'active') return false
    const currentShape = toCouponShape(toFormValues(current, null), current.status)
    const nextShape = toCouponShape(watched as CouponInput, 'active')
    return requiresConfirmation(currentShape, nextShape)
  }, [current, watched])

  function applyServerErrors(result: { error: string; fieldErrors?: Record<string, string[]> }) {
    setError('root', { type: 'server', message: result.error })
    for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (field in COUPON_FIELD_KEYS) setError(field as keyof CouponInput, { type: 'server', message: messages[0] })
    }
  }

  const onSubmitSave = handleSubmit((values) => {
    startTransition(async () => {
      if (!current) {
        const result = await createCouponDraftAction(storeId, values)
        if (!result.ok) return applyServerErrors(result)
        setCurrent(result.data)
        toast.success('Borrador guardado. Podés seguir editando o activarlo cuando quieras.')
        onSaved()
        return
      }

      const result = await updateCouponAction(storeId, current.id, values)
      if (!result.ok) return applyServerErrors(result)
      if (result.data.requiresConfirmation) {
        setPendingIntent('update')
        setOpenConfirmWith(result.data.pending)
        return
      }
      setCurrent(result.data.coupon)
      toast.success('Cambios guardados')
      onSaved()
    })
  })

  function handleActivateClick() {
    startTransition(async () => {
      const valid = await trigger()
      if (!valid) {
        toast.error('Revisá los campos marcados antes de activar')
        return
      }
      const values = getValues()

      let couponId = current?.id ?? null
      if (!current) {
        const createResult = await createCouponDraftAction(storeId, values)
        if (!createResult.ok) return applyServerErrors(createResult)
        setCurrent(createResult.data)
        couponId = createResult.data.id
      } else {
        // El cupón todavía no está activo en este punto, así que esto SIEMPRE
        // se aplica al instante (requiresConfirmation() con next.status
        // distinto de 'active' es `false` por definición) — no hace falta
        // revisar `requiresConfirmation` acá.
        const updateResult = await updateCouponAction(storeId, current.id, values)
        if (!updateResult.ok) return applyServerErrors(updateResult)
        if (!updateResult.data.requiresConfirmation) setCurrent(updateResult.data.coupon)
      }
      if (couponId === null) return

      const activateResult = await requestCouponActivationAction(storeId, couponId)
      if (!activateResult.ok) {
        toast.error('No se pudo iniciar la activación', { description: activateResult.error })
        return
      }
      setPendingIntent('activate')
      setOpenConfirmWith(activateResult.data)
    })
  }

  function handlePause() {
    if (!current) return
    startTransition(async () => {
      const result = await setCouponStatusAction(storeId, current.id, 'paused')
      if (!result.ok) {
        toast.error('No se pudo pausar', { description: result.error })
        return
      }
      setCurrent(result.data)
      toast.success('Cupón pausado. Dejó de canjearse, pero se puede reactivar cuando quieras.')
      onSaved()
    })
  }

  function handleConfirmed() {
    if (pendingIntent === 'activate') {
      setCurrent((c) => (c ? { ...c, status: 'active' } : c))
      toast.success('Cupón activado')
    } else {
      // `confirmCouponChangeAction` no devuelve el cupón actualizado (es
      // `void`): lo que se confirmó es exactamente lo que el form ya tiene
      // cargado, así que se refleja acá con los valores del form en vez de
      // esperar a que `onSaved()` (`router.refresh()`) traiga la fila nueva.
      setCurrent((c) => (c ? { ...c, ...getValues() } : c))
      toast.success('Cambios guardados')
    }
    onSaved()
  }

  const canDelete = current !== null && current.reservedCount === 0 && current.redeemedCount === 0
  const isActive = current?.status === 'active'
  const showActivate = !isActive

  const startDay = isoToLocalDay(watched.startsAt ?? null, timezone)
  const endDay = isoToLocalDay(watched.endsAt ?? null, timezone)

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <DrawerHeader>
          <DrawerTitle>{current ? 'Editar cupón' : 'Nuevo cupón'}</DrawerTitle>
          <DrawerDescription>
            Cada campo de acá es plata: el peor caso se calcula abajo, en vivo, antes de guardar.
          </DrawerDescription>
        </DrawerHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          <form id="coupon-form" onSubmit={onSubmitSave} className="flex flex-col gap-5 pb-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-name">Nombre interno</Label>
              <Input
                id="coupon-name"
                {...register('name')}
                placeholder="Ej: Vuelve el cliente, Finde largo"
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'coupon-name-error' : undefined}
                className="h-10"
              />
              {nameError ? (
                <p id="coupon-name-error" role="alert" className="text-destructive text-xs">
                  {nameError}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">Solo lo ve el equipo del local, nunca el cliente.</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-code">Código</Label>
              <div className="flex gap-2">
                <Input
                  id="coupon-code"
                  {...register('code')}
                  onChange={(e) => setValue('code', e.target.value.toUpperCase(), { shouldValidate: true })}
                  placeholder="FINDE2024"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!codeError}
                  aria-describedby={codeError ? 'coupon-code-error' : 'coupon-code-hint'}
                  className="h-10 flex-1 font-mono uppercase"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-1.5"
                  onClick={() => setValue('code', generateCouponCodeClient(), { shouldValidate: true })}
                >
                  <Shuffle className="size-4" aria-hidden />
                  Generar
                </Button>
              </div>
              {codeError ? (
                <p id="coupon-code-error" role="alert" className="text-destructive text-xs">
                  {codeError}
                </p>
              ) : (
                <p id="coupon-code-hint" className="text-muted-foreground text-xs">
                  4 a 16 letras y números. Cortito y fácil de decir en el mostrador.
                </p>
              )}
            </div>

            <Controller
              control={control}
              name="discountType"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label id="coupon-discount-type-label">Tipo de descuento</Label>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    aria-labelledby="coupon-discount-type-label"
                    className="grid grid-cols-2 gap-2"
                  >
                    <Label
                      htmlFor="coupon-discount-type-percentage"
                      className="group/field-label has-[:focus-visible]:ring-ring/50 border-border flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 has-[:focus-visible]:ring-3 has-[[data-state=checked]]:border-primary"
                    >
                      <RadioGroupItem id="coupon-discount-type-percentage" value="percentage" />
                      Porcentaje
                    </Label>
                    <Label
                      htmlFor="coupon-discount-type-fixed"
                      className="group/field-label has-[:focus-visible]:ring-ring/50 border-border flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 has-[:focus-visible]:ring-3 has-[[data-state=checked]]:border-primary"
                    >
                      <RadioGroupItem id="coupon-discount-type-fixed" value="fixed" />
                      Monto fijo
                    </Label>
                  </RadioGroup>
                </div>
              )}
            />

            {discountType === 'percentage' ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="coupon-percent">Porcentaje</Label>
                  <Controller
                    control={control}
                    name="percent"
                    render={({ field }) => (
                      <Input
                        id="coupon-percent"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={100}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                        aria-invalid={!!percentError}
                        aria-describedby={percentError ? 'coupon-percent-error' : undefined}
                        className="tabular h-10"
                      />
                    )}
                  />
                  {percentError ? (
                    <p id="coupon-percent-error" role="alert" className="text-destructive text-xs">
                      {percentError}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="coupon-max-discount">Tope de descuento</Label>
                  <div className="flex items-center gap-2">
                    <Controller
                      control={control}
                      name="maxDiscountCents"
                      render={({ field }) => (
                        <MoneyInput
                          id="coupon-max-discount"
                          cents={field.value ?? 0}
                          onCentsChange={field.onChange}
                          disabled={field.value === null}
                          currency={currency}
                          invalid={!!maxDiscountError}
                          errorId={maxDiscountError ? 'coupon-max-discount-error' : undefined}
                          className="h-10"
                        />
                      )}
                    />
                  </div>
                  <label className="text-muted-foreground flex min-h-6 items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={watched.maxDiscountCents === null}
                      onCheckedChange={(v) => setValue('maxDiscountCents', v === true ? null : 0, { shouldValidate: true })}
                    />
                    Sin tope
                  </label>
                  {maxDiscountError ? (
                    <p id="coupon-max-discount-error" role="alert" className="text-destructive text-xs">
                      {maxDiscountError}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-amount-off">Monto del descuento</Label>
                <Controller
                  control={control}
                  name="amountOffCents"
                  render={({ field }) => (
                    <MoneyInput
                      id="coupon-amount-off"
                      cents={field.value ?? 0}
                      onCentsChange={field.onChange}
                      currency={currency}
                      invalid={!!amountOffError}
                      errorId={amountOffError ? 'coupon-amount-off-error' : undefined}
                      className="h-10"
                    />
                  )}
                />
                {amountOffError ? (
                  <p id="coupon-amount-off-error" role="alert" className="text-destructive text-xs">
                    {amountOffError}
                  </p>
                ) : null}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-min-subtotal">Mínimo de compra</Label>
              <Controller
                control={control}
                name="minSubtotalCents"
                render={({ field }) => (
                  <MoneyInput
                    id="coupon-min-subtotal"
                    cents={field.value}
                    onCentsChange={field.onChange}
                    currency={currency}
                    invalid={!!minSubtotalError}
                    errorId={minSubtotalError ? 'coupon-min-subtotal-error' : undefined}
                    className="h-10"
                  />
                )}
              />
              <p className="text-muted-foreground text-xs">Se evalúa sobre el subtotal, antes del envío y del descuento.</p>
              {minSubtotalError ? (
                <p id="coupon-min-subtotal-error" role="alert" className="text-destructive text-xs">
                  {minSubtotalError}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-starts-at">Vigencia desde</Label>
                <Input
                  id="coupon-starts-at"
                  type="date"
                  value={startDay}
                  onChange={(e) => setValue('startsAt', localDayToStartIso(e.target.value, timezone), { shouldValidate: true })}
                  className="h-10"
                />
                <p className="text-muted-foreground text-xs">Vacío: ya arrancó.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-ends-at">Vigencia hasta</Label>
                <Input
                  id="coupon-ends-at"
                  type="date"
                  value={endDay}
                  onChange={(e) => setValue('endsAt', localDayToEndIso(e.target.value, timezone), { shouldValidate: true })}
                  aria-invalid={!!errors.endsAt}
                  aria-describedby={errors.endsAt ? 'coupon-ends-at-error' : undefined}
                  className="h-10"
                />
                {errors.endsAt ? (
                  <p id="coupon-ends-at-error" role="alert" className="text-destructive text-xs">
                    {errors.endsAt.message}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">Vacío: sin vencimiento.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-max-redemptions">Tope de usos</Label>
                <Controller
                  control={control}
                  name="maxRedemptions"
                  render={({ field }) => (
                    <Input
                      id="coupon-max-redemptions"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                      aria-invalid={!!maxRedemptionsError}
                      aria-describedby={maxRedemptionsError ? 'coupon-max-redemptions-error' : undefined}
                      className="tabular h-10"
                    />
                  )}
                />
                {maxRedemptionsError ? (
                  <p id="coupon-max-redemptions-error" role="alert" className="text-destructive text-xs">
                    {maxRedemptionsError}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">Cupo total, contando reservas y canjes.</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-max-per-phone">Tope por teléfono</Label>
                <Controller
                  control={control}
                  name="maxRedemptionsPerPhone"
                  render={({ field }) => (
                    <Input
                      id="coupon-max-per-phone"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      disabled={field.value === null}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                      className="tabular h-10"
                    />
                  )}
                />
                <label className="text-muted-foreground flex min-h-6 items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={watched.maxRedemptionsPerPhone === null}
                    onCheckedChange={(v) => setValue('maxRedemptionsPerPhone', v === true ? null : 1, { shouldValidate: true })}
                  />
                  Sin tope por teléfono
                </label>
              </div>
            </div>

            <Controller
              control={control}
              name="paymentMethods"
              render={({ field }) => (
                <PaymentMethodChecks value={field.value} onChange={field.onChange} availability={paymentAvailability} />
              )}
            />

            {/* El peor caso: SIN COTA se dice en palabras, nunca "—" ni "$0" —
                es el estado más peligroso de toda la hoja (00-architecture.md §5.9.3). */}
            <div
              role="status"
              className={
                'rounded-lg border px-3 py-2.5 text-sm ' +
                (worstCase === null ? 'border-warning/40 bg-warning/10 text-warning-foreground' : 'border-border bg-muted/40')
              }
            >
              {worstCase === null ? (
                <p className="font-medium">Peor caso: sin tope. Si el código se filtra, no hay techo — poné un tope de descuento.</p>
              ) : (
                <p>
                  Peor caso si el código se filtra: hasta{' '}
                  <span className="tabular font-semibold">{formatCents(worstCase, currency)}</span> en descuentos.
                </p>
              )}
            </div>

            {rootError ? (
              <p role="alert" className="text-destructive text-sm">
                {rootError}
              </p>
            ) : null}

            {/* El aviso del segundo factor, AL PIE y no en un tooltip: nadie
                descubre esto después de apretar guardar. */}
            <p role="status" className="text-muted-foreground text-xs">
              {!current || !isActive
                ? 'Guardar se aplica al instante. Activar te va a pedir un código por mail.'
                : activeChangeRequiresCode
                  ? 'Este cambio pide un código por mail.'
                  : 'Este cambio se aplica al instante.'}
            </p>
          </form>
        </ScrollArea>

        <DrawerFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {canDelete ? <ConfirmDeleteCouponButton storeId={storeId} coupon={current} onDeleted={() => onSaved()} /> : null}
            {isActive ? (
              <Button type="button" variant="outline" onClick={handlePause} disabled={pending} className="gap-2">
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Pausar
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DrawerClose asChild>
              <Button type="button" variant="ghost">
                Cancelar
              </Button>
            </DrawerClose>
            <Button type="submit" form="coupon-form" variant="outline" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {current ? 'Guardar cambios' : 'Guardar borrador'}
            </Button>
            {showActivate ? (
              <Button type="button" onClick={handleActivateClick} disabled={pending} className="gap-2">
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Activar
              </Button>
            ) : null}
          </div>
        </DrawerFooter>
      </DrawerContent>

      <ConfirmCouponCode
        ref={confirmRef}
        storeId={storeId}
        title={pendingIntent === 'activate' ? 'Confirmá la activación' : 'Confirmá el cambio'}
        description={
          pendingIntent === 'activate'
            ? 'Activar este cupón lo hace canjeable en la vitrina apenas confirmes.'
            : 'Este cambio amplía lo que el cupón permite, así que pedimos un código antes de aplicarlo.'
        }
        onConfirmed={handleConfirmed}
      />
    </Drawer>
  )
}
