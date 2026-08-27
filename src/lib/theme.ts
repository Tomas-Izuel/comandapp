import { ensureContrast, hexToOklch, oklchToCss, readableOn, shift } from '@/lib/color'
import type { Branding } from '@/models/schemas/branding.schema'

/**
 * Convierte el kit de marca de una tienda en las variables CSS que shadcn ya usa.
 *
 * Se inyecta en el layout de /[store] como un <style> scopeado. Sin JS y sin
 * flash: el HTML llega con el tema puesto. Y como pisa los mismos tokens que
 * los componentes leen, todo shadcn se adapta solo sin tocar un componente.
 *
 * Solo entra acá lo que ya pasó por brandingSchema.
 */
/**
 * Selector del tema de la tienda.
 *
 * `[data-sonner-toaster]` está incluido porque sonner portaliza los toasts a
 * `document.body`, o sea FUERA del div del tema: sin esto, "Agregado al carrito"
 * salía con la paleta neutra de la plataforma y era la única superficie que se
 * veía ajena al local en la cara del cliente (F-14).
 *
 * Queda un residuo conocido: el modo claro/oscuro propio de sonner lo fija el
 * layout raíz, que no sabe en qué tienda está. Los COLORES ya son los del local;
 * alinear también el modo requiere un Toaster por árbol de rutas.
 */
export const STORE_THEME_SELECTOR = '[data-store-theme], [data-sonner-toaster]'

export function buildThemeCss(branding: Branding, selector: string = STORE_THEME_SELECTOR): string {
  const primary = hexToOklch(branding.color_primary)
  const accent = hexToOklch(branding.color_accent)
  const background = hexToOklch(branding.color_background)
  const foreground = hexToOklch(branding.color_foreground)
  const primaryFg = hexToOklch(branding.color_primary_foreground)

  const isDark = background.l < 0.5
  const primaryIsDark = primary.l < 0.5

  // Garantía de legibilidad: el local elige el color, el sistema garantiza que
  // se lea. Sin esto, un naranja claro con blanco encima da 1.9:1 y el precio
  // es ilegible al sol, que es exactamente donde se usa la app.
  const safeForeground = ensureContrast(foreground, background, 4.5)
  const safePrimaryFg = ensureContrast(primaryFg, primary, 4.5)

  // Superficies derivadas del fondo: en claro se oscurecen, en oscuro se aclaran.
  const surfaceStep = isDark ? 0.04 : -0.025
  const muted = shift(background, { l: surfaceStep * 1.4 })
  const border = shift(background, { l: surfaceStep * 3 })

  const vars: Record<string, string> = {
    '--background': oklchToCss(background),
    '--foreground': oklchToCss(safeForeground),

    '--card': oklchToCss(shift(background, { l: surfaceStep * 0.4 })),
    '--card-foreground': oklchToCss(safeForeground),
    '--popover': oklchToCss(shift(background, { l: surfaceStep * 0.4 })),
    '--popover-foreground': oklchToCss(safeForeground),

    '--primary': oklchToCss(primary),
    '--primary-foreground': oklchToCss(safePrimaryFg),
    // Texto secundario SOBRE el campo de color (F-06): varias vistas usaban
    // `text-primary-foreground/80` para bajar el énfasis, pero mezclar con el
    // fondo del propio campo de color rompe la garantía de contraste que
    // `ensureContrast` recién dejó en 4.5:1 justo. Mismo truco que
    // `--muted-foreground`: se tiñe desde el propio tono en vez de opacidad.
    '--primary-foreground-muted': oklchToCss(
      ensureContrast(shift(safePrimaryFg, { l: primaryIsDark ? 0.3 : -0.34, c: 0.7 }), primary, 4.5),
    ),

    '--secondary': oklchToCss(muted),
    '--secondary-foreground': oklchToCss(safeForeground),

    '--muted': oklchToCss(muted),
    // Texto secundario: mismo tono, contraste bajado hasta seguir siendo legible.
    // Texto secundario: tintado desde el mismo tono, nunca gris, y con piso de
    // 4.5:1 igual que el principal. Un "gris suave" sobre un campo de color es
    // el defecto más común y el más ilegible.
    '--muted-foreground': oklchToCss(
      ensureContrast(shift(safeForeground, { l: isDark ? -0.3 : 0.34, c: 0.7 }), muted, 4.5),
    ),

    '--accent': oklchToCss(shift(accent, { l: isDark ? -0.34 : 0.3, c: 0.35 })),
    '--accent-foreground': oklchToCss(isDark ? readableOn(accent) : shift(accent, { l: -0.42 })),

    '--destructive': 'oklch(0.577 0.245 27.325)',

    '--border': oklchToCss(border),
    '--input': oklchToCss(border),
    '--ring': oklchToCss(shift(primary, { c: 0.9 })),

    '--radius': `${branding.radius_rem}rem`,

    '--font-sans': `var(--font-${branding.font_body})`,
    '--font-heading': `var(--font-${branding.font_heading})`,

    // Serie para los gráficos del dashboard, derivada del color de marca para
    // que las métricas se vean parte de la misma identidad.
    '--chart-1': oklchToCss(primary),
    '--chart-2': oklchToCss(shift(primary, { l: 0.12, c: 0.75 })),
    '--chart-3': oklchToCss(accent),
    '--chart-4': oklchToCss(shift(accent, { l: -0.12, c: 0.85 })),
    '--chart-5': oklchToCss(shift(primary, { l: -0.14, c: 1.1 })),
  }

  const body = Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')

  return `${selector}{${body}}`
}

/** La clase `dark` que shadcn usa para su variant, según el fondo elegido. */
export function themeClass(branding: Branding): string {
  if (branding.theme_mode === 'dark') return 'dark'
  if (branding.theme_mode === 'light') return ''
  return hexToOklch(branding.color_background).l < 0.5 ? 'dark' : ''
}
