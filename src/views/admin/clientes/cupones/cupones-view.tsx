'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PanelHeading } from '@/views/admin/page-frame'
import { CouponList } from './coupon-list'
import { CampaignList } from './campaign-list'
import { CouponSheet } from './coupon-sheet'
import { CouponDetailSheet } from './coupon-detail'
import { CampaignSheet } from './campaign-sheet'
import type { CouponInput } from '@/models/schemas/coupon.schema'
import type { CouponCampaign, CouponDetail, PaymentMethod } from '@/models/types'

type SheetState =
  | { type: 'closed' }
  | { type: 'create'; seed: CouponInput | null }
  | { type: 'detail'; couponId: number }
  | { type: 'edit'; couponId: number }
  | { type: 'campaign'; couponId: number }

/**
 * `/admin/clientes/cupones` entero. Dos secciones apiladas con `PanelHeading`
 * —Cupones y Campañas—, nunca tabs anidadas: misma decisión y mismo motivo
 * que la bandeja de programados de `/admin/pedidos`.
 *
 * Un solo `sheet` de estado gobierna las tres hojas (crear/editar, detalle,
 * campaña): solo una puede estar abierta a la vez, así que no hace falta
 * coordinar tres booleanos independientes. `openKey` fuerza un remount de la
 * hoja activa cada vez que se ABRE una nueva intención (crear otro, duplicar,
 * editar OTRO cupón): así el estado interno de cada hoja (el form, el
 * borrador de campaña) arranca limpio, mismo patrón que `ProductDrawer`.
 *
 * `coupons` llega COMPLETO por props (`CouponDetail[]`, con los agregados y
 * los últimos 20 canjes de CADA cupón, ya resueltos por `page.tsx`): no hay
 * ningún fetch al abrir el detalle de una fila. Ver el comentario de
 * `coupon-detail.tsx` sobre por qué se precarga así.
 */
export function CuponesView({
  storeId,
  storeName,
  timezone,
  currency,
  coupons,
  campaigns,
  paymentAvailability,
}: {
  storeId: number
  storeName: string
  timezone: string
  currency: string
  coupons: CouponDetail[]
  campaigns: CouponCampaign[]
  paymentAvailability: Record<PaymentMethod, boolean>
}) {
  const router = useRouter()
  const [sheet, setSheet] = useState<SheetState>({ type: 'closed' })
  const [openKey, setOpenKey] = useState(0)

  function open(next: Exclude<SheetState, { type: 'closed' }>) {
    setSheet(next)
    setOpenKey((k) => k + 1)
  }
  function close() {
    setSheet({ type: 'closed' })
  }
  function refresh() {
    router.refresh()
  }

  const activeCoupon =
    sheet.type === 'detail' || sheet.type === 'edit' || sheet.type === 'campaign'
      ? (coupons.find((c) => c.id === sheet.couponId) ?? null)
      : null

  return (
    <div className="flex flex-col gap-8">
      <section>
        <PanelHeading title="Cupones" description="Códigos de descuento con tope de usos y de plata." />
        <CouponList
          storeId={storeId}
          timezone={timezone}
          coupons={coupons}
          paymentAvailability={paymentAvailability}
          onCreate={() => open({ type: 'create', seed: null })}
          onOpenDetail={(id) => open({ type: 'detail', couponId: id })}
          onDuplicate={(seed) => open({ type: 'create', seed })}
          onSendCampaign={(id) => open({ type: 'campaign', couponId: id })}
          onChanged={refresh}
        />
      </section>

      <section>
        <PanelHeading title="Campañas" description="El registro de los envíos por mail, de solo lectura." />
        <CampaignList campaigns={campaigns} timezone={timezone} />
      </section>

      <CouponSheet
        key={`edit-${openKey}`}
        storeId={storeId}
        currency={currency}
        timezone={timezone}
        coupon={sheet.type === 'edit' ? activeCoupon : null}
        duplicateSeed={sheet.type === 'create' ? sheet.seed : null}
        paymentAvailability={paymentAvailability}
        open={sheet.type === 'create' || sheet.type === 'edit'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        onSaved={refresh}
      />

      <CouponDetailSheet
        key={`detail-${openKey}`}
        storeId={storeId}
        currency={currency}
        timezone={timezone}
        detail={sheet.type === 'detail' ? activeCoupon : null}
        open={sheet.type === 'detail'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        onChanged={refresh}
        onEdit={() => {
          if (sheet.type === 'detail') open({ type: 'edit', couponId: sheet.couponId })
        }}
        onSendCampaign={() => {
          if (sheet.type === 'detail') open({ type: 'campaign', couponId: sheet.couponId })
        }}
      />

      <CampaignSheet
        key={`campaign-${openKey}`}
        storeId={storeId}
        timezone={timezone}
        currency={currency}
        storeName={storeName}
        coupon={sheet.type === 'campaign' ? activeCoupon : null}
        open={sheet.type === 'campaign'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        onSent={() => {
          close()
          refresh()
        }}
      />
    </div>
  )
}
