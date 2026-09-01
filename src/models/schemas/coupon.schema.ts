import { z } from 'zod'
import { paymentMethodSchema } from '@/models/schemas/order.schema'

/**
 * Contratos de cupones y campañas (Entrega B, T1B).
 *
 * `coupons` y las tres tablas que la acompañan no tienen un solo grant para
 * `authenticated` (`20260901130000_cupones.sql`), así que esta validación no
 * es la defensa real — la base no le da al browser ni el permiso de intentar.
 * Es la que produce un error legible antes de gastar una escritura, y la que
 * mantiene la forma de un `CouponInput` sincronizada con
 * `coupons_shape_check`/`coupons_window_check` para que el dueño vea el
 * problema en el campo, no en un 23514 crudo.
 */

export const storeIdSchema = z.number().int().positive()
export const couponIdSchema = z.number().int().positive()
export const campaignIdSchema = z.number().int().positive()

/**
 * `^[A-Z0-9]{4,16}$` — mismo CHECK que `coupons_code_check`. Se normaliza acá
 * (trim + mayúsculas) por el mismo motivo que `couponCode` en
 * `createOrderSchema`: un `descuento10` en minúscula no matchearía y el
 * dueño vería "código inválido" por una diferencia de caja, no de contenido.
 */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,16}$/, 'El código tiene que tener entre 4 y 16 letras o números, sin espacios')

export const couponDiscountTypeSchema = z.enum(['percentage', 'fixed'])

/** Los tres estados que el DUEÑO elige. `expired`/`exhausted`/`scheduled` son derivados (`couponState()`) y nunca se escriben. */
export const couponStatusSchema = z.enum(['draft', 'active', 'paused'])

/**
 * `null` = todos los métodos. El array vacío es inrepresentable a propósito,
 * igual que `coupons_payment_methods_check`: significaría "ningún método", o
 * sea un cupón que no se puede usar nunca, en silencio.
 */
export const couponPaymentMethodsSchema = z.array(paymentMethodSchema).min(1).max(3).nullable()

/**
 * La forma completa de un cupón, para crear y para editar. `.strict()`:
 * ninguna de estas tablas tiene grant para `authenticated`, pero el mismo
 * criterio de seguridad aplica — un campo que se cuela sin que el schema lo
 * conozca es un campo que nadie audita.
 *
 * Tanto crear como editar mandan la forma ENTERA (§5.11.3 del plan): no hay
 * un PATCH parcial, porque el segundo factor evalúa el cambio completo contra
 * el cupón vigente.
 */
export const couponInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Poné un nombre para identificar el cupón').max(80, 'El nombre es demasiado largo'),
    code: couponCodeSchema,
    discountType: couponDiscountTypeSchema,
    percent: z.number().int().min(1).max(100).nullable(),
    amountOffCents: z.number().int().positive().nullable(),
    maxDiscountCents: z.number().int().positive().nullable(),
    minSubtotalCents: z.number().int().min(0),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    maxRedemptions: z.number().int().positive('Un cupón sin tope de usos es un cheque en blanco: poné un número'),
    maxRedemptionsPerPhone: z.number().int().positive().nullable(),
    paymentMethods: couponPaymentMethodsSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    // Espeja coupons_shape_check: el tipo y el valor no pueden contradecirse.
    if (v.discountType === 'percentage') {
      if (v.percent === null) {
        ctx.addIssue({ code: 'custom', path: ['percent'], message: 'Definí el porcentaje de descuento' })
      }
      if (v.amountOffCents !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['amountOffCents'],
          message: 'Un cupón porcentual no lleva un monto fijo',
        })
      }
    } else {
      if (v.amountOffCents === null) {
        ctx.addIssue({ code: 'custom', path: ['amountOffCents'], message: 'Definí el monto fijo del descuento' })
      }
      if (v.percent !== null) {
        ctx.addIssue({ code: 'custom', path: ['percent'], message: 'Un cupón de monto fijo no lleva porcentaje' })
      }
      if (v.maxDiscountCents !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['maxDiscountCents'],
          message: 'El tope de descuento es solo para cupones porcentuales',
        })
      }
    }

    // Espeja coupons_window_check.
    if (v.startsAt && v.endsAt && new Date(v.endsAt).getTime() <= new Date(v.startsAt).getTime()) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'La fecha de fin tiene que ser posterior al inicio' })
    }
  })

export type CouponInput = z.infer<typeof couponInputSchema>

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

/**
 * Discriminada por `kind`, igual que `CampaignSegment` en `types.ts`. `.strict()`
 * en cada rama para que un `topN` colado en un segmento `all` sea un 400, no un
 * dato ignorado.
 */
export const campaignSegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('top_n'), topN: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('min_spent'), minSpentCents: z.number().int().min(0) }).strict(),
])

export const campaignPreviewInputSchema = z
  .object({
    couponId: couponIdSchema,
    segment: campaignSegmentSchema,
  })
  .strict()

export const campaignCreateInputSchema = z
  .object({
    couponId: couponIdSchema,
    segment: campaignSegmentSchema,
    subject: z.string().trim().min(1, 'Poné un asunto para el mail').max(150, 'El asunto es demasiado largo'),
    // Vacío = sin mensaje libre. Se trata como `null`, mismo criterio que
    // `customerEmail` en `createOrderSchema`.
    message: z
      .string()
      .trim()
      .max(500, 'El mensaje es demasiado largo (máximo 500 caracteres)')
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v))
      .nullable(),
  })
  .strict()

export type CampaignCreateInput = z.infer<typeof campaignCreateInputSchema>

export const campaignQuotaRequestInputSchema = z
  .object({
    requestedRecipients: z.number().int().min(0),
    daysNeeded: z.number().int().min(0),
    message: z.string().trim().max(500, 'El mensaje es demasiado largo (máximo 500 caracteres)'),
  })
  .strict()

// ---------------------------------------------------------------------------
// Validación de las respuestas `jsonb` de las RPC. `database.types.ts` las
// tipa como `Json` sin forma: esto es lo que confirma, antes de confiar en
// ellas, que el borde cumple lo que promete (mismo patrón que
// `customerDirectoryRpcSchema`).
// ---------------------------------------------------------------------------

export const campaignSegmentPreviewRpcSchema = z.object({
  inSegment: z.number().int(),
  withEmail: z.number().int(),
  optedOut: z.number().int(),
  willSend: z.number().int(),
})

const couponRedemptionRowRpcSchema = z.object({
  orderId: z.number().int(),
  shortCode: z.string(),
  customerName: z.string(),
  discountCents: z.number().int(),
  orderTotalCents: z.number().int(),
  // La lista trae los TRES estados, a diferencia de las métricas, que cuentan
  // solo `redeemed`. Es diagnóstico: sin el `reserved` y el `released` con su
  // motivo, la columna "Usos" del cupón no tiene explicación posible.
  status: z.enum(['reserved', 'redeemed', 'released']),
  releasedReason: z.enum(['expired', 'cancelled_unpaid']).nullable(),
  createdAt: z.string(),
})

export const couponDetailRpcSchema = z.object({
  id: z.number().int(),
  storeId: z.number().int(),
  name: z.string(),
  code: z.string(),
  discountType: couponDiscountTypeSchema,
  percent: z.number().int().nullable(),
  amountOffCents: z.number().int().nullable(),
  maxDiscountCents: z.number().int().nullable(),
  minSubtotalCents: z.number().int(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  maxRedemptions: z.number().int(),
  maxRedemptionsPerPhone: z.number().int().nullable(),
  reservedCount: z.number().int(),
  redeemedCount: z.number().int(),
  paymentMethods: z.array(paymentMethodSchema).nullable(),
  status: couponStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  stats: z.object({
    redemptions: z.number().int(),
    discountedCents: z.number().int(),
    revenueCents: z.number().int(),
  }),
  totalRedemptions: z.number().int(),
  recentRedemptions: z.array(couponRedemptionRowRpcSchema),
})
