import { z } from 'zod'

/**
 * Kit de marca de una tienda.
 *
 * Estos valores terminan dentro de un <style> en el HTML, así que la validación
 * acá no es cosmética: es la barrera contra inyección de CSS. Un color libre
 * como `red; } body { display: none` rompería la página de cualquier local.
 * Por eso: hex estricto, número acotado y enum cerrado. Nada de texto libre.
 */

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Tiene que ser un hex de 6 dígitos, por ejemplo #f97316')

/**
 * Dos listas, no una. Las caras de display condensadas son el corazón del
 * programa de etiqueta en los títulos, y son ilegibles en un párrafo.
 */
export const BODY_FONTS = [
  'geist',
  'inter',
  'plus-jakarta',
  'space-grotesk',
  'dm-sans',
  'outfit',
] as const

export const HEADING_FONTS = [
  ...BODY_FONTS,
  'bricolage',
  'archivo',
  'oswald',
  'bebas-neue',
  'anton',
] as const

export const headingFontSchema = z.enum(HEADING_FONTS)
export const bodyFontSchema = z.enum(BODY_FONTS)
export type HeadingFont = z.infer<typeof headingFontSchema>
export type BodyFont = z.infer<typeof bodyFontSchema>

export const themeModeSchema = z.enum(['light', 'dark', 'system'])

/** Las imágenes son URLs de Supabase Storage; nunca javascript: ni data:. */
const assetUrl = z
  .url()
  .refine((value) => value.startsWith('https://') || value.startsWith('http://127.0.0.1'), {
    message: 'La URL tiene que ser https',
  })

export const brandingSchema = z.object({
  logo_url: assetUrl.nullable().default(null),
  logo_dark_url: assetUrl.nullable().default(null),
  favicon_url: assetUrl.nullable().default(null),
  hero_image_url: assetUrl.nullable().default(null),

  color_primary: hexColor.default('#f97316'),
  color_primary_foreground: hexColor.default('#ffffff'),
  color_accent: hexColor.default('#fb923c'),
  color_background: hexColor.default('#ffffff'),
  color_foreground: hexColor.default('#0a0a0a'),

  radius_rem: z.coerce.number().min(0).max(2).default(0.65),

  font_heading: headingFontSchema.default('geist'),
  font_body: bodyFontSchema.default('geist'),

  theme_mode: themeModeSchema.default('light'),
})

export type Branding = z.infer<typeof brandingSchema>

/** Defaults para una tienda que todavía no configuró su marca. */
export const DEFAULT_BRANDING: Branding = brandingSchema.parse({})
