import { z } from 'zod'

/**
 * Contratos del ABM de catálogo (panel de admin de cada tienda).
 *
 * Todo lo que entra acá lo escribe staff autenticado — RLS exige membresía —
 * pero igual se valida con Zod antes de tocar la base: nunca se confía en la
 * forma de lo que manda el browser.
 */

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(80),
  position: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export type CategoryInput = z.infer<typeof categoryInputSchema>

export const productInputSchema = z.object({
  categoryId: z.coerce.number().int().positive().nullable().default(null),
  name: z.string().trim().min(1, 'Falta el nombre').max(120),
  description: z.string().trim().max(500).nullable().default(null),
  imagePath: z.string().trim().max(300).nullable().default(null),
  priceCents: z.coerce.number().int().min(0),
  prepMinutes: z.coerce.number().int().min(0).max(240).default(10),
  isAvailable: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
})

export type ProductInput = z.infer<typeof productInputSchema>

/** Objeto base sin el `.refine()` cruzado, para poder derivar `.partial()` en updates. */
const optionGroupObjectSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(80),
  minSelect: z.coerce.number().int().min(0).default(0),
  maxSelect: z.coerce.number().int().min(1).default(1),
  position: z.coerce.number().int().min(0).default(0),
})

export const optionGroupInputSchema = optionGroupObjectSchema.refine(
  (data) => data.maxSelect >= data.minSelect,
  { message: 'El máximo tiene que ser mayor o igual al mínimo', path: ['maxSelect'] },
)

export type OptionGroupInput = z.infer<typeof optionGroupInputSchema>

/** Para `updateOptionGroup`: `ZodEffects` (por el `.refine`) no tiene `.partial()`. */
export const optionGroupPartialInputSchema = optionGroupObjectSchema.partial()

export const optionInputSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(80),
  priceDeltaCents: z.coerce.number().int().default(0),
  isAvailable: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
})

export type OptionInput = z.infer<typeof optionInputSchema>
