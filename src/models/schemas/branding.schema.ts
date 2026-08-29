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

/**
 * Cuánto aire respira la carta. Enum cerrado, no un número libre: con un
 * slider el dueño puede hundir los targets por debajo de 44px desde el panel
 * y el sistema deja de poder garantizar nada. Los tres valores están
 * calibrados en `globals.css` y NINGUNO aprieta por debajo de la escala
 * actual — `compact` es exactamente lo que la app ya era.
 */
export const DENSITY_OPTIONS = ['compact', 'cozy', 'roomy'] as const
export const densitySchema = z.enum(DENSITY_OPTIONS)
export type Density = z.infer<typeof densitySchema>

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

  // Defaults del mundo visual nuevo (2026-08-28), no el naranja de etiqueta de
  // cerveza que reemplazó. El verde no es el lima de la referencia tal cual
  // (#8cc63f, 2.05:1 contra blanco): en esta composición el color de marca ES
  // el color del precio sobre la tarjeta blanca, y a 2.05:1 no se lee al sol.
  // #468511 es el mismo verde bajado en lightness hasta 4.54:1, así que pasa
  // sin que `ensureContrast()` tenga que corregir nada. El lima original queda
  // como `color_accent`. Mismos valores que el ALTER de
  // `20260828120200_store_links_brand_defaults.sql` — se cambian juntos.
  color_primary: hexColor.default('#468511'),
  color_primary_foreground: hexColor.default('#ffffff'),
  color_accent: hexColor.default('#8cc63f'),
  color_background: hexColor.default('#ffffff'),
  color_foreground: hexColor.default('#0a0a0a'),

  radius_rem: z.coerce.number().min(0).max(2).default(1.25),

  density: densitySchema.default('cozy'),

  font_heading: headingFontSchema.default('geist'),
  font_body: bodyFontSchema.default('geist'),

  theme_mode: themeModeSchema.default('light'),
})

export type Branding = z.infer<typeof brandingSchema>

/** Defaults para una tienda que todavía no configuró su marca. */
export const DEFAULT_BRANDING: Branding = brandingSchema.parse({})
