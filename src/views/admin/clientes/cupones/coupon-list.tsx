'use client'

import { useRef, useTransition } from 'react'
import { toast } from 'sonner'
import { Copy, Loader2, Mail, MoreVertical, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Panel, StatusPill } from '@/views/shared/surfaces'
import { EmptyState } from '@/views/shared/states'
import { formatDayShort, zonedDay } from '@/lib/dates'
import { couponState, describeDiscount } from '@/lib/coupon'
import { setCouponStatusAction, requestCouponActivationAction } from '@/controllers/marketing.actions'
import { ConfirmCouponCode, type ConfirmCouponCodeHandle } from './confirm-coupon-code'
import { ConfirmDeleteCouponButton } from './confirm-delete-coupon'
import { couponStateLabel, generateCouponCodeClient } from './format'
import { PAYMENT_METHOD_LABELS } from '@/models/schemas/order.schema'
import type { CouponInput } from '@/models/schemas/coupon.schema'
import type { CouponDetail, PaymentMethod } from '@/models/types'

const STATE_TONE: Record<ReturnType<typeof couponState>, 'neutral' | 'live' | 'warning' | 'danger' | 'done'> = {
  draft: 'neutral',
  scheduled: 'live',
  active: 'live',
  paused: 'neutral',
  expired: 'danger',
  exhausted: 'warning',
}

/**
 * Ancho FIJO en la última columna, no `auto`: con `auto` cada FILA calculaba
 * su propia plantilla de grilla según cuántos botones tenía "Acciones" (una
 * fila `active` con "Pausar" + "Mandar por mail" + el menú es mucho más ancha
 * que una `draft` con solo "Activar"), y las dos columnas `fr` absorbían la
 * diferencia — el encabezado y cada fila terminaban con anchos de columna
 * DISTINTOS entre sí, verificado con `getComputedStyle(...).gridTemplateColumns`.
 * 19rem es lo que necesita la fila más ancha (Pausar/Activar + "Mandar por
 * mail" + el kebab de 44px), con margen. Compartida por el encabezado y por
 * cada fila para que las seis columnas den IDÉNTICO en toda la tabla.
 */
const GRID_COLS = 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_6rem_9rem_10rem_19rem]'

function toDuplicateSeed(coupon: CouponDetail, freshCode: string): CouponInput {
  return {
    name: `${coupon.name} (copia)`,
    code: freshCode,
    discountType: coupon.discountType,
    percent: coupon.percent,
    amountOffCents: coupon.amountOffCents,
    maxDiscountCents: coupon.maxDiscountCents,
    minSubtotalCents: coupon.minSubtotalCents,
    startsAt: null,
    endsAt: null,
    maxRedemptions: coupon.maxRedemptions,
    maxRedemptionsPerPhone: coupon.maxRedemptionsPerPhone,
    paymentMethods: coupon.paymentMethods,
  }
}

/** "Mercado Pago", "Mercado Pago y Transferencia", "Mercado Pago, Transferencia y Pago al recibir" — sin conjugar verbos, para no pelear con singular/plural de "está(n) habilitado(s)". */
function methodsPhrase(methods: PaymentMethod[]): string {
  const labels = methods.map((m) => PAYMENT_METHOD_LABELS[m])
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
}

function CouponRow({
  storeId,
  coupon,
  paymentAvailability,
  timezone,
  onOpenDetail,
  onDuplicate,
  onSendCampaign,
  onChanged,
}: {
  storeId: number
  coupon: CouponDetail
  paymentAvailability: Record<PaymentMethod, boolean>
  timezone: string
  onOpenDetail: () => void
  onDuplicate: () => void
  onSendCampaign: () => void
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const confirmRef = useRef<ConfirmCouponCodeHandle>(null)

  const state = couponState(coupon)
  const occupied = coupon.reservedCount + coupon.redeemedCount
  const canDelete = coupon.reservedCount === 0 && coupon.redeemedCount === 0

  // Granular a propósito: "un medio sin habilitar" (el cupón sigue sirviendo
  // por los demás métodos que permite) y "sin NINGÚN medio habilitado" (el
  // cupón no se puede canjear por NADA hoy) son dos severidades distintas, y
  // un pill de dos palabras no alcanza para decir cuál es cuál — el
  // dueño lo señaló probando la pantalla: "no me quedó claro qué comunica".
  const unavailableMethods = (coupon.paymentMethods ?? []).filter((m) => !paymentAvailability[m])
  const allMethodsUnavailable =
    coupon.paymentMethods !== null && coupon.paymentMethods.length > 0 && unavailableMethods.length === coupon.paymentMethods.length
  const someMethodUnavailable = unavailableMethods.length > 0 && !allMethodsUnavailable
  const paymentAvailabilityNotice = allMethodsUnavailable
    ? { tone: 'danger' as const, text: `No se puede canjear: hoy no cobrás con ${methodsPhrase(unavailableMethods)}` }
    : someMethodUnavailable
      ? { tone: 'warning' as const, text: `Incluye un medio que hoy no cobrás: ${methodsPhrase(unavailableMethods)}` }
      : null

  function handlePause() {
    startTransition(async () => {
      const result = await setCouponStatusAction(storeId, coupon.id, 'paused')
      if (!result.ok) {
        toast.error('No se pudo pausar', { description: result.error })
        return
      }
      toast.success('Cupón pausado')
      onChanged()
    })
  }

  function handleActivateClick() {
    startTransition(async () => {
      const result = await requestCouponActivationAction(storeId, coupon.id)
      if (!result.ok) {
        toast.error('No se pudo iniciar la activación', { description: result.error })
        return
      }
      confirmRef.current?.openWithPending(result.data)
    })
  }

  const vigencia =
    coupon.startsAt || coupon.endsAt
      ? `${coupon.startsAt ? formatDayShort(zonedDay(coupon.startsAt, timezone)) : 'ya'} – ${coupon.endsAt ? formatDayShort(zonedDay(coupon.endsAt, timezone)) : 'sin fin'}`
      : 'Sin vigencia fija'

  return (
    <div className="py-3 lg:py-2.5">
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onOpenDetail} className="min-w-0 text-left">
            <p className="text-foreground truncate font-mono text-sm font-semibold">{coupon.code}</p>
            <p className="text-muted-foreground truncate text-xs">{coupon.name}</p>
          </button>
          <StatusPill tone={STATE_TONE[state]} className="shrink-0">
            {couponStateLabel(state)}
          </StatusPill>
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
          <span>{describeDiscount(coupon)}</span>
          <span aria-hidden>·</span>
          <span className="tabular">
            {occupied} / {coupon.maxRedemptions} usos
          </span>
          <span aria-hidden>·</span>
          <span className="tabular">{vigencia}</span>
        </p>
        {paymentAvailabilityNotice ? <StatusPill tone={paymentAvailabilityNotice.tone}>{paymentAvailabilityNotice.text}</StatusPill> : null}
        <RowActions
          state={state}
          pending={pending}
          canDelete={canDelete}
          onPause={handlePause}
          onActivate={handleActivateClick}
          onDuplicate={onDuplicate}
          onSendCampaign={onSendCampaign}
          storeId={storeId}
          coupon={coupon}
          onChanged={onChanged}
        />
      </div>

      <div className={`${GRID_COLS} hidden lg:grid lg:items-center lg:gap-4`}>
        <div className="min-w-0">
          <button type="button" onClick={onOpenDetail} className="block min-w-0 text-left">
            <p className="text-foreground truncate font-mono text-sm font-semibold">{coupon.code}</p>
            <p className="text-muted-foreground truncate text-xs">{coupon.name}</p>
          </button>
          {paymentAvailabilityNotice ? (
            <StatusPill tone={paymentAvailabilityNotice.tone} className="mt-1">
              {paymentAvailabilityNotice.text}
            </StatusPill>
          ) : null}
        </div>
        <p className="text-foreground truncate text-sm">{describeDiscount(coupon)}</p>
        <StatusPill tone={STATE_TONE[state]} className="w-fit">
          {couponStateLabel(state)}
        </StatusPill>
        <p className="text-muted-foreground tabular text-sm">
          {occupied} / {coupon.maxRedemptions}
        </p>
        <p className="text-muted-foreground tabular text-sm">{vigencia}</p>
        <RowActions
          state={state}
          pending={pending}
          canDelete={canDelete}
          onPause={handlePause}
          onActivate={handleActivateClick}
          onDuplicate={onDuplicate}
          onSendCampaign={onSendCampaign}
          storeId={storeId}
          coupon={coupon}
          onChanged={onChanged}
        />
      </div>

      <ConfirmCouponCode
        ref={confirmRef}
        storeId={storeId}
        title="Confirmá la activación"
        description="Activar este cupón lo hace canjeable en la vitrina apenas confirmes."
        onConfirmed={() => {
          toast.success('Cupón activado')
          onChanged()
        }}
      />
    </div>
  )
}

/**
 * "Pausar"/"Activar" son botones a la vista, nunca escondidos en el menú de
 * tres puntos: es lo primero que alguien busca cuando un código se filtró y
 * está sangrando plata (00-architecture.md §5.6). "Duplicar" y "Borrar" van
 * en el menú porque son de uso ocasional.
 */
function RowActions({
  state,
  pending,
  canDelete,
  onPause,
  onActivate,
  onDuplicate,
  onSendCampaign,
  storeId,
  coupon,
  onChanged,
}: {
  state: ReturnType<typeof couponState>
  pending: boolean
  canDelete: boolean
  onPause: () => void
  onActivate: () => void
  onDuplicate: () => void
  onSendCampaign: () => void
  storeId: number
  coupon: CouponDetail
  onChanged: () => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {/* `size` default (44px), no `sm`: es el piso duro de todo lo que se
          toca con el pulgar, y "Pausar" en particular es la acción que
          alguien busca con apuro cuando un código se filtró — no se achica. */}
      {state === 'active' ? (
        <Button type="button" variant="outline" onClick={onPause} disabled={pending} className="gap-1.5 px-3">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Pausar
        </Button>
      ) : state === 'draft' || state === 'paused' || state === 'expired' ? (
        <Button type="button" variant="outline" onClick={onActivate} disabled={pending} className="gap-1.5 px-3">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Activar
        </Button>
      ) : null}
      {state === 'active' ? (
        <Button type="button" variant="ghost" onClick={onSendCampaign} className="gap-1.5 px-3">
          <Mail className="size-4" aria-hidden />
          Mandar por mail
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={`Más acciones para ${coupon.code}`}>
            <MoreVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDuplicate} className="gap-2">
            <Copy className="size-4" aria-hidden />
            Duplicar
          </DropdownMenuItem>
          {canDelete ? (
            <div className="px-1 py-0.5">
              <ConfirmDeleteCouponButton storeId={storeId} coupon={coupon} onDeleted={onChanged} />
            </div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function CouponList({
  storeId,
  timezone,
  coupons,
  paymentAvailability,
  onCreate,
  onOpenDetail,
  onDuplicate,
  onSendCampaign,
  onChanged,
}: {
  storeId: number
  timezone: string
  coupons: CouponDetail[]
  paymentAvailability: Record<PaymentMethod, boolean>
  onCreate: () => void
  onOpenDetail: (couponId: number) => void
  onDuplicate: (seed: CouponInput) => void
  onSendCampaign: (couponId: number) => void
  onChanged: () => void
}) {
  if (coupons.length === 0) {
    return (
      <Panel className="p-4 sm:p-5">
        <EmptyState
          icon={<Ticket className="size-8" />}
          title="Todavía no creaste ningún cupón"
          description="Un cupón es un código de descuento con tope de usos y de plata: lo mandás por mail o por WhatsApp, y el cliente lo carga en el checkout."
          action={
            <Button type="button" onClick={onCreate} className="gap-1.5">
              Crear cupón
            </Button>
          }
        />
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" onClick={onCreate} className="gap-1.5">
          Crear cupón
        </Button>
      </div>
      <Panel className="p-4 sm:p-5">
        <div className={`${GRID_COLS} text-muted-foreground hidden text-xs font-medium lg:grid lg:gap-4 lg:border-b lg:pb-2`}>
          <span>Cupón</span>
          <span>Descuento</span>
          <span>Estado</span>
          <span>Usos</span>
          <span>Vigencia</span>
          <span>Acciones</span>
        </div>
        <div className="divide-border divide-y">
          {coupons.map((coupon) => (
            <CouponRow
              key={coupon.id}
              storeId={storeId}
              coupon={coupon}
              timezone={timezone}
              paymentAvailability={paymentAvailability}
              onOpenDetail={() => onOpenDetail(coupon.id)}
              onDuplicate={() => onDuplicate(toDuplicateSeed(coupon, generateCouponCodeClient()))}
              onSendCampaign={() => onSendCampaign(coupon.id)}
              onChanged={onChanged}
            />
          ))}
        </div>
      </Panel>
    </div>
  )
}
