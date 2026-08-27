import { z } from 'zod'

/**
 * Contratos de configuración de tienda (panel de admin → "Mi local").
 *
 * `status` NO está acá: lo maneja exclusivamente la plataforma
 * (`platform.model.ts` → `setStoreStatus`). El staff de un local nunca puede
 * reactivar o suspender su propia tienda.
 */

const e164 = z
  .string()
  .trim()
  .regex(/^\+\d{8,15}$/, 'Tiene que ser un teléfono en formato +54911...')
  .nullable()

export const storeSettingsInputSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(120),
  description: z.string().trim().max(500).nullable().default(null),
  phoneE164: e164.default(null),
  whatsappPhoneE164: e164.default(null),
  address: z.string().trim().max(200).nullable().default(null),
  timezone: z.string().trim().min(1).max(60).default('America/Argentina/Buenos_Aires'),
  currency: z.string().trim().length(3).default('ARS'),

  acceptingOrders: z.boolean().default(true),
  inStorePaymentEnabled: z.boolean().default(false),

  minOrderCents: z.coerce.number().int().min(0).default(0),

  demandThresholdOrders: z.coerce.number().int().min(1).default(5),
  demandMultiplier: z.coerce.number().min(1).max(10).default(1.5),
})

export type StoreSettingsInput = z.infer<typeof storeSettingsInputSchema>
