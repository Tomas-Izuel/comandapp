import 'server-only'

import { requireStoreMembership } from '@/models/store.model'
import { listCoupons, getCouponDetail } from '@/models/coupon.model'
import { listCampaigns } from '@/models/campaign.model'
import type { Coupon, CouponCampaign, CouponDetail } from '@/models/types'

/**
 * Lecturas de `/admin/clientes/cupones` (T1B). Mismo patrón que
 * `customers.controller.ts`: la page ya resolvió sesión y hace su propio
 * gate (`resolveAdminSession()` + `role === 'owner'`); esto repite
 * `requireStoreMembership(storeId, { role: 'owner' })` como defensa en
 * profundidad, no como la única barrera — `coupon_detail` vuelve a verificar
 * `is_store_owner()` una tercera vez adentro de Postgres, que es la defensa
 * real.
 *
 * Existe porque hay algo que orquestar (sesión + permiso + la lectura), no
 * para cumplir con la forma: un controller que solo reenviara a un modelo
 * sería indirección sin valor.
 */

export async function getCouponsForStore(storeId: number): Promise<Coupon[]> {
  await requireStoreMembership(storeId, { role: 'owner' })
  return listCoupons(storeId)
}

export async function getCouponDetailForStore(storeId: number, couponId: number): Promise<CouponDetail> {
  await requireStoreMembership(storeId, { role: 'owner' })
  return getCouponDetail(storeId, couponId)
}

export async function getCampaignsForStore(storeId: number): Promise<CouponCampaign[]> {
  await requireStoreMembership(storeId, { role: 'owner' })
  return listCampaigns(storeId)
}
