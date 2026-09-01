'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Mail } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/views/shared/surfaces'
import { formatCents } from '@/lib/money'
import { formatDateTime, zonedDay } from '@/lib/dates'
import { couponState, describeDiscount } from '@/lib/coupon'
import { setCouponStatusAction } from '@/controllers/marketing.actions'
import { ConfirmDeleteCouponButton } from './confirm-delete-coupon'
import { couponStateLabel, redemptionReleasedReasonLabel } from './format'
import type { CouponDetail, CouponRedemptionRow } from '@/models/types'

const STATE_TONE: Record<ReturnType<typeof couponState>, 'neutral' | 'live' | 'warning' | 'danger' | 'done'> = {
  draft: 'neutral',
  scheduled: 'live',
  active: 'live',
  paused: 'neutral',
  expired: 'danger',
  exhausted: 'warning',
}

/**
 * `reserved`/`released` son diagnóstico, `redeemed` no lleva pill (es el
 * estado esperado). Nunca la misma pill para `released` que para `reserved`:
 * uno es "todavía puede confirmarse", el otro es "ya no va a pasar nada".
 */
function RedemptionStatusPill({ row }: { row: CouponRedemptionRow }) {
  if (row.status === 'reserved') {
    return (
      <StatusPill tone="live" className="w-fit">
        Reservado
      </StatusPill>
    )
  }
  if (row.status === 'released') {
    return (
      <StatusPill tone="neutral" className="w-fit">
        Liberado: {redemptionReleasedReasonLabel(row.releasedReason)}
      </StatusPill>
    )
  }
  return null
}

/**
 * La hoja de detalle de un cupón ya creado (§5.7.2.4 y §5.14.5). Es de solo
 * lectura salvo por pausar/activar y borrar — editar los campos vive en
 * `coupon-sheet.tsx`, que esta hoja abre con "Editar".
 *
 * `detail` llega COMPLETO por props (incluidos los 20 últimos canjes y los
 * tres agregados): no hay ningún fetch acá. `getCouponDetailForStore` (T1B)
 * es server-only y no hay una Server Action de lectura para pedirlo bajo
 * demanda desde el cliente —agregar una es tocar `marketing.actions.ts`, que
 * no es archivo de este slice—, así que `page.tsx` precarga el detalle de
 * TODOS los cupones del local de una vez (ver el dev log de T4B). Para el
 * volumen de cupones de un local esto es liviano; si el catálogo de
 * promociones creciera mucho, ahí sí haría falta una Server Action de
 * lectura bajo demanda.
 */
export function CouponDetailSheet({
  storeId,
  currency,
  timezone,
  detail,
  open,
  onOpenChange,
  onChanged,
  onEdit,
  onSendCampaign,
}: {
  storeId: number
  currency: string
  timezone: string
  detail: CouponDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  onEdit: () => void
  onSendCampaign: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [current, setCurrent] = useState<CouponDetail | null>(detail)

  if (!current) return null

  const state = couponState(current)
  const quedan = Math.max(current.maxRedemptions - current.reservedCount - current.redeemedCount, 0)

  function handlePause() {
    startTransition(async () => {
      const result = await setCouponStatusAction(storeId, current!.id, 'paused')
      if (!result.ok) {
        toast.error('No se pudo pausar', { description: result.error })
        return
      }
      setCurrent((c) => (c ? { ...c, status: 'paused' } : c))
      toast.success('Cupón pausado')
      onChanged()
    })
  }

  // No `reservedCount === 0 && redeemedCount === 0`: los dos se recalculan
  // solo sobre `reserved`/`redeemed` (`sync_coupon_counters`), así que un
  // cupón con únicamente canjes `released` viejos (un pedido abandonado y
  // cancelado) queda "aparentemente virgen" con esos dos contadores en cero
  // y ofrece un botón que el `on delete restrict` de la base va a rechazar
  // (hallazgo 8 del review de Entrega B). `recentRedemptions` trae los
  // últimos 20 SIN filtrar por status, así que si viene vacío el ledger
  // completo de este cupón está vacío — es el dato que ya teníamos y no
  // usábamos. `coupon-list.tsx` se queda con el heurístico de los dos
  // contadores: ahí sí es un límite real de lo que trae `Coupon` en la lista.
  const canDelete = current.recentRedemptions.length === 0

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <DrawerHeader>
          <DrawerTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{current.code}</span>
            <StatusPill tone={STATE_TONE[state]}>{couponStateLabel(state)}</StatusPill>
          </DrawerTitle>
          <DrawerDescription>{current.name}</DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Descuento</dt>
              <dd className="tabular mt-0.5 font-medium">{describeDiscount(current, currency)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Mínimo de compra</dt>
              <dd className="tabular mt-0.5">
                {current.minSubtotalCents > 0 ? formatCents(current.minSubtotalCents, currency) : 'Sin mínimo'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Desde</dt>
              <dd className="tabular mt-0.5">{current.startsAt ? formatDateTime(current.startsAt, timezone) : 'Ya arrancó'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Hasta</dt>
              <dd className="tabular mt-0.5">{current.endsAt ? formatDateTime(current.endsAt, timezone) : 'Sin vencimiento'}</dd>
            </div>
          </dl>

          {/* El desglose de la reserva: TRES partes, nunca un solo número
              (00-architecture.md §5.7.2.4). El helper de "reservados" va
              inline al lado, no en un tooltip que nadie abre. */}
          <p className="bg-muted/50 rounded-lg px-3 py-2.5 text-sm">
            <span className="tabular font-medium">{current.redeemedCount}</span> canjes ·{' '}
            <span className="tabular font-medium">{current.reservedCount}</span> reservados{' '}
            <span className="text-muted-foreground text-xs">(pedidos con el cupón que todavía no se entregaron)</span> · quedan{' '}
            <span className="tabular font-medium">{quedan}</span> de <span className="tabular font-medium">{current.maxRedemptions}</span>
          </p>

          {/* Los tres agregados, en una línea de texto — nunca tarjetas de
              métrica (00-architecture.md §5.14.5). Cuentan SOLO `redeemed`. */}
          <p className="text-sm">
            <span className="tabular font-medium">{current.stats.redemptions}</span> canjes ·{' '}
            <span className="tabular font-medium">{formatCents(current.stats.discountedCents, currency)}</span> descontados ·{' '}
            <span className="tabular font-medium">{formatCents(current.stats.revenueCents, currency)}</span> facturados
          </p>

          <div>
            <p className="mb-2 text-sm font-medium">
              Últimos canjes{' '}
              <span className="text-muted-foreground tabular font-normal">
                ({current.recentRedemptions.length} de {current.totalRedemptions})
              </span>
            </p>
            {current.recentRedemptions.length === 0 ? (
              <p className="text-muted-foreground text-sm">Todavía no hay movimientos de este cupón.</p>
            ) : (
              <ul className="divide-border border-border divide-y rounded-lg border">
                {current.recentRedemptions.map((r) => {
                  const day = zonedDay(r.createdAt, timezone)
                  return (
                    <li key={r.orderId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          href={`/admin/pedidos?from=${day}&to=${day}`}
                          className="text-foreground min-w-0 truncate font-medium underline-offset-2 hover:underline"
                        >
                          {r.shortCode} · {r.customerName}
                        </Link>
                        {/* `redeemed` no lleva pill: es el estado esperado y ya
                            lo dice el desglose de arriba. `reserved` y
                            `released` SÍ, porque son diagnóstico — la pregunta
                            que este renglón contesta es "¿por qué el cupón
                            dice 12 canjes y yo conté 15 pedidos?"
                            (00-architecture.md §5.7.2.4). */}
                        <RedemptionStatusPill row={r} />
                      </div>
                      <span className="tabular text-muted-foreground shrink-0">
                        −{formatCents(r.discountCents, currency)} de {formatCents(r.orderTotalCents, currency)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <DrawerFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {canDelete ? (
              <ConfirmDeleteCouponButton
                storeId={storeId}
                coupon={current}
                onDeleted={() => {
                  onChanged()
                  onOpenChange(false)
                }}
              />
            ) : null}
            {current.status === 'active' ? (
              <Button type="button" variant="outline" onClick={handlePause} disabled={pending} className="gap-2">
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Pausar
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DrawerClose asChild>
              <Button type="button" variant="ghost">
                Cerrar
              </Button>
            </DrawerClose>
            {state === 'active' ? (
              <Button type="button" variant="outline" onClick={onSendCampaign} className="gap-2">
                <Mail className="size-4" aria-hidden />
                Mandar por mail
              </Button>
            ) : null}
            <Button type="button" onClick={onEdit}>
              Editar
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
