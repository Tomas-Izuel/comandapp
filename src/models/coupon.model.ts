import 'server-only'

import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { formatCents } from '@/lib/money'
import { discountForSubtotal } from '@/lib/coupon'
import { couponCodeSchema, couponDetailRpcSchema, type CouponInput } from '@/models/schemas/coupon.schema'
import { COUPON_REJECTION_MESSAGES, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/models/schemas/order.schema'
import type {
  Coupon,
  CouponAppliedQuote,
  CouponDetail,
  CouponDiscountType,
  CouponRejectionCode,
  CouponStatus,
} from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

const CTX = 'coupon.model'

/**
 * Único lugar que habla con Postgres para `coupons` y `coupon_redemptions`.
 *
 * `coupons` no tiene un solo grant para `authenticated` ni `anon`
 * (`20260901130000_cupones.sql`): cada una de sus columnas es plata
 * (`percent`, `amountOffCents`, `maxDiscountCents`, `minSubtotalCents`) o
 * alcance (`startsAt`, `endsAt`, `maxRedemptions`, `paymentMethods`,
 * `status`). Toda escritura acá va con `createAdminClient()` +
 * `.eq('store_id', storeId)` explícito, además del id: el aislamiento por
 * tienda no se delega a que el id que mandó el browser sea correcto.
 *
 * `getCouponDetail` es la única excepción: llama a `coupon_detail` con el
 * cliente de SESIÓN porque esa RPC es `SECURITY DEFINER` pero verifica
 * `is_store_owner()` leyendo `auth.uid()` — con el cliente admin (sin JWT de
 * usuario) esa verificación no tiene con qué comparar y la llamada falla
 * siempre. Misma trampa que `store_couriers`, documentada en `CLAUDE.md`.
 */

type CouponRow = Database['public']['Tables']['coupons']['Row']

function toCoupon(row: CouponRow): Coupon {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    code: row.code,
    discountType: row.discount_type as CouponDiscountType,
    percent: row.percent,
    amountOffCents: row.amount_off_cents,
    maxDiscountCents: row.max_discount_cents,
    minSubtotalCents: row.min_subtotal_cents,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    maxRedemptions: row.max_redemptions,
    maxRedemptionsPerPhone: row.max_redemptions_per_phone,
    reservedCount: row.reserved_count,
    redeemedCount: row.redeemed_count,
    paymentMethods: (row.payment_methods as PaymentMethod[] | null) ?? null,
    status: row.status as CouponStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Columnas de `coupons` que el dueño puede escribir. `status` se maneja aparte (`setCouponStatus`): activar SIEMPRE pasa por el segundo factor, nunca por acá. */
function toRow(input: CouponInput) {
  return {
    name: input.name,
    code: input.code,
    discount_type: input.discountType,
    percent: input.percent,
    amount_off_cents: input.amountOffCents,
    max_discount_cents: input.maxDiscountCents,
    min_subtotal_cents: input.minSubtotalCents,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    max_redemptions: input.maxRedemptions,
    max_redemptions_per_phone: input.maxRedemptionsPerPhone,
    payment_methods: input.paymentMethods,
  }
}

/**
 * 8 caracteres, alfabeto sin confundibles (`0/O`, `1/I/L`), CSPRNG con
 * rejection sampling. **Nunca `Math.random()`** — mismo criterio que
 * `public_token` y el mismo alfabeto y cutoff que `private.random_token` en
 * Postgres, solo que en mayúsculas: `coupons_code_check` es
 * `^[A-Z0-9]{4,16}$`.
 *
 * 248 = 8 × 31 es el múltiplo de 31 más grande que entra en un byte.
 * Descartar los bytes ≥ 248 elimina el sesgo del módulo: sin eso los primeros
 * caracteres del alfabeto saldrían más seguido que los últimos.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 8
const CODE_ALPHABET_CUTOFF = 248

export function generateCouponCode(): string {
  let out = ''
  while (out.length < CODE_LENGTH) {
    const bytes = randomBytes(CODE_LENGTH - out.length)
    for (const byte of bytes) {
      if (byte >= CODE_ALPHABET_CUTOFF) continue
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (out.length === CODE_LENGTH) break
    }
  }
  return out
}

export async function listCoupons(storeId: number): Promise<Coupon[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('coupons')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  if (error) {
    log.error(CTX, 'no se pudieron listar los cupones', error, { storeId })
    throw new Error(`No se pudieron listar los cupones: ${error.message}`)
  }
  return (data ?? []).map(toCoupon)
}

/** Un cupón puntual, sin agregados. Lo usan las acciones que necesitan comparar el estado vigente contra un cambio propuesto (`requiresConfirmation`). */
export async function getCouponById(storeId: number, couponId: number): Promise<Coupon | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('coupons').select('*').eq('id', couponId).eq('store_id', storeId).maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo leer el cupón', error, { storeId })
    throw new Error(`No se pudo leer el cupón: ${error.message}`)
  }
  return data ? toCoupon(data) : null
}

/**
 * El detalle completo, vía `coupon_detail` (PostgREST corta en `max_rows`
 * sin avisar, así que los agregados y los últimos 20 canjes salen de una RPC
 * que agrega en Postgres, no de leer la tabla).
 */
export async function getCouponDetail(storeId: number, couponId: number): Promise<CouponDetail> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('coupon_detail', { p_store_id: storeId, p_coupon_id: couponId })

  if (error) {
    // 42501 es el guard de `is_store_owner()` DENTRO de la RPC; no debería
    // llegar acá porque el controller ya exige `role: 'owner'` antes, pero
    // si ese orden se rompe alguna vez el cliente tiene que ver un error de
    // dominio, no un código de Postgres crudo.
    if (error.code === '42501') {
      throw new DomainError('Solo el dueño del local puede ver el detalle de un cupón', { status: 403 })
    }
    // `no_data_found` de PL/pgSQL: el SQLSTATE es P0002.
    if (error.code === 'P0002') {
      throw new DomainError('No se encontró ese cupón en esta tienda', { status: 404 })
    }
    log.error(CTX, 'no se pudo leer el detalle del cupón', error, { storeId })
    throw new Error(`No se pudo leer el detalle del cupón: ${error.message}`)
  }

  const parsed = couponDetailRpcSchema.safeParse(data)
  if (!parsed.success) {
    log.error(CTX, 'coupon_detail devolvió una forma inesperada', parsed.error, { storeId })
    throw new Error('El detalle del cupón llegó en un formato inesperado')
  }
  return parsed.data
}

/** Nace SIEMPRE `draft`: activar es un paso aparte que pide el código de 6 dígitos. */
export async function createCouponDraft(storeId: number, input: CouponInput, createdBy: string): Promise<Coupon> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('coupons')
    .insert({ store_id: storeId, status: 'draft', created_by: createdBy, ...toRow(input) })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('Ya existe un cupón con ese código en esta tienda.', { status: 409, field: 'code' })
    }
    log.error(CTX, 'no se pudo crear el cupón', error, { storeId })
    throw new Error(`No se pudo crear el cupón: ${error.message}`)
  }
  return toCoupon(data)
}

/**
 * Reemplaza la forma entera del cupón, sin tocar `status`. Lo llaman dos
 * caminos: la edición libre de un cupón que NO está activo (gratis, sin
 * código — mientras está apagado no hay nada que canjear), y la confirmación
 * de un cambio que sí pidió código (`confirmCouponChangeAction`).
 */
export async function updateCoupon(storeId: number, couponId: number, input: CouponInput): Promise<Coupon> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('coupons')
    .update(toRow(input))
    .eq('id', couponId)
    .eq('store_id', storeId)
    .select('*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('Ya existe un cupón con ese código en esta tienda.', { status: 409, field: 'code' })
    }
    log.error(CTX, 'no se pudo actualizar el cupón', error, { storeId })
    throw new Error(`No se pudo actualizar el cupón: ${error.message}`)
  }
  if (!data) throw new DomainError('No se encontró ese cupón en esta tienda', { status: 404 })
  return toCoupon(data)
}

/**
 * Cambia `status` sin tocar nada más. Quien decide si ESTE cambio necesita el
 * código de 6 dígitos es el llamador (`marketing.actions.ts`): pasar a
 * `active` siempre lo pide, pausar o volver a `draft` nunca ("no apagar se
 * apaga sin código", aprobado por el dueño del producto).
 */
export async function setCouponStatus(storeId: number, couponId: number, status: CouponStatus): Promise<Coupon> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('coupons')
    .update({ status })
    .eq('id', couponId)
    .eq('store_id', storeId)
    .select('*')
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo cambiar el estado del cupón', error, { storeId })
    throw new Error(`No se pudo cambiar el estado del cupón: ${error.message}`)
  }
  if (!data) throw new DomainError('No se encontró ese cupón en esta tienda', { status: 404 })
  return toCoupon(data)
}

/**
 * Solo si el cupón NUNCA tuvo una fila en el libro mayor — `released`
 * incluidas, porque son el rastro de que el cupón estuvo en la calle. La FK
 * `coupon_redemptions_coupon_same_store_fkey` es `on delete restrict`, así
 * que el `23503` es la base rechazándolo de verdad, no una validación de
 * cortesía: aunque este chequeo se saltee, el `DELETE` no entra.
 */
export async function deleteUnusedCoupon(storeId: number, couponId: number): Promise<void> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('coupons').delete().eq('id', couponId).eq('store_id', storeId).select('id')

  if (error) {
    if (error.code === '23503') {
      throw new DomainError('Este cupón ya se usó: se puede pausar, no borrar.', { status: 409 })
    }
    log.error(CTX, 'no se pudo borrar el cupón', error, { storeId })
    throw new Error(`No se pudo borrar el cupón: ${error.message}`)
  }
  if (!data || data.length === 0) {
    throw new DomainError('No se encontró ese cupón en esta tienda', { status: 404 })
  }
}

/**
 * Lo que devuelve la validación de cotización: el `quote` es lo que VE el
 * cliente, el `reasonCode` es interno y **nunca sale del servidor**.
 *
 * Están separados y no fundidos en un solo objeto a propósito. `quote` es el
 * contrato de cara al browser y `reasonCode` distingue dos rechazos que
 * comparten el mismo texto (`not_found` e `inactive`): meterlo adentro del quote
 * lo mandaría en la cotización y reabriría el oráculo que ese texto compartido
 * cierra.
 */
export type CouponValidation = {
  quote: CouponAppliedQuote
  /** `null` cuando el cupón se aplicó. */
  reasonCode: CouponRejectionCode | null
}

function rejected(code: string, reason: string, reasonCode: CouponRejectionCode): CouponValidation {
  return { quote: { status: 'rejected', code, reason }, reasonCode }
}

/**
 * La validación de COTIZACIÓN (§5.9.1). Nunca tira: un cupón mal tipeado, o
 * cualquier otro motivo de rechazo, no puede dejar el carrito sin precio —
 * vuelve como dato (`status: 'rejected'`) al lado del total, que sigue
 * viajando igual.
 *
 * El orden de los chequeos replica el de `create_order` en SQL, a propósito:
 * son las mismas reglas escritas dos veces (TS para cotizar, SQL para
 * cobrar), y que el orden coincida es lo que hace que el mensaje que el
 * cliente ve acá sea el mismo que recibiría si intentara pagar.
 *
 * `customerPhoneE164` es opcional porque la cotización (`GET /api/orders`) no
 * siempre conoce el teléfono todavía: sin él, el tope por teléfono se
 * saltea acá y lo aplica igual `create_order` al confirmar — el peor caso es
 * un 400 tardío en el commit, nunca un descuento que el servidor no volvería
 * a conceder.
 */
export async function validateCouponForCart(params: {
  storeId: number
  code: string
  subtotalCents: number
  paymentMethod: PaymentMethod
  customerPhoneE164?: string
}): Promise<CouponValidation> {
  const parsedCode = couponCodeSchema.safeParse(params.code)
  const normalizedCode = parsedCode.success ? parsedCode.data : params.code.trim().toUpperCase()

  // Un código que ni siquiera respeta el formato no puede existir: no vale la
  // pena consultar la base por algo que `coupons_code_check` rechazaría
  // igual. Mismo criterio que `orderTokenSchema`.
  if (!parsedCode.success) return rejected(normalizedCode, COUPON_REJECTION_MESSAGES.notFound, 'not_found')

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('coupons')
    .select('*')
    .eq('store_id', params.storeId)
    .eq('code', normalizedCode)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo validar el cupón en la cotización', error, { storeId: params.storeId })
    throw new Error(`No se pudo validar el cupón: ${error.message}`)
  }
  if (!row) return rejected(normalizedCode, COUPON_REJECTION_MESSAGES.notFound, 'not_found')

  const coupon = toCoupon(row)

  if (coupon.status !== 'active') return rejected(coupon.code, COUPON_REJECTION_MESSAGES.notFound, 'inactive')

  const now = Date.now()
  if (coupon.startsAt && now < new Date(coupon.startsAt).getTime()) {
    return rejected(coupon.code, COUPON_REJECTION_MESSAGES.notStarted, 'not_started')
  }
  if (coupon.endsAt && now >= new Date(coupon.endsAt).getTime()) {
    return rejected(coupon.code, COUPON_REJECTION_MESSAGES.expired, 'expired')
  }

  if (params.subtotalCents < coupon.minSubtotalCents) {
    const missing = coupon.minSubtotalCents - params.subtotalCents
    return rejected(
      coupon.code,
      `Ese cupón es para pedidos de ${formatCents(coupon.minSubtotalCents)} o más. Te faltan ${formatCents(missing)}.`,
      'min_subtotal',
    )
  }

  if (coupon.paymentMethods !== null && !coupon.paymentMethods.includes(params.paymentMethod)) {
    const methods = coupon.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' o ')
    return rejected(coupon.code, `Ese cupón vale solo pagando con ${methods}.`, 'payment_method')
  }

  // Estrictamente `>=`: acá los contadores YA reflejan todas las reservas
  // vivas (no estamos insertando una), así que no aplica el off-by-one del
  // trigger `enforce_coupon_redemption` (ese sí necesita `<` porque valida
  // ANTES de insertar la fila que ocuparía el cupo).
  if (coupon.reservedCount + coupon.redeemedCount >= coupon.maxRedemptions) {
    return rejected(coupon.code, COUPON_REJECTION_MESSAGES.exhausted, 'exhausted')
  }

  if (params.customerPhoneE164 && coupon.maxRedemptionsPerPhone !== null) {
    const { count, error: countError } = await admin
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', coupon.id)
      .eq('customer_phone_e164', params.customerPhoneE164)
      .in('status', ['reserved', 'redeemed'])

    if (countError) {
      log.error(CTX, 'no se pudo verificar el tope por teléfono', countError, { storeId: params.storeId })
      throw new Error(`No se pudo validar el cupón: ${countError.message}`)
    }
    if ((count ?? 0) >= coupon.maxRedemptionsPerPhone) {
      return rejected(coupon.code, COUPON_REJECTION_MESSAGES.phoneLimit, 'phone_limit')
    }
  }

  const discountCents = discountForSubtotal(coupon, params.subtotalCents)
  return {
    quote: {
      status: 'applied',
      code: coupon.code,
      label: `${coupon.discountType === 'percentage' ? `${coupon.percent}%` : formatCents(coupon.amountOffCents ?? 0)} (−${formatCents(discountCents)})`,
      discountCents,
    },
    reasonCode: null,
  }
}
