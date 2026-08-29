import { ensureContrast, hexToOklch, oklchToCss, readableOn, shift } from '@/lib/color'
import type { Branding, Density } from '@/models/schemas/branding.schema'

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

/**
 * Densidad → factor de la escala de espaciado de Tailwind.
 *
 * `--spacing` es la variable de la que Tailwind v4 deriva TODAS las utilidades
 * numéricas (`p-4`, `gap-3`, `size-4`, `min-h-11`…), así que pisarla dentro del
 * scope de la tienda mueve el ritmo entero sin tocar un solo componente. Ese
 * alcance es también el motivo de que ningún factor baje de 1: `min-h-11` es
 * exactamente 44px con el factor 1, y cualquier valor menor rompe el piso de
 * target táctil desde el panel del local. La densidad solo puede dar MÁS aire.
 */
const DENSITY_SCALE: Record<Density, number> = {
  compact: 1,
  cozy: 1.1,
  roomy: 1.22,
}

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

  const density = DENSITY_SCALE[branding.density]
  // Redondeo a 4 decimales: `1.5 * 1.22` en float da 1.8299999999999998 y no
  // hace falta emitir ese ruido en cada variable.
  const scaled = (rem: number) => `${Number((rem * density).toFixed(4))}rem`

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
    //
    // OJO — con un primary de lightness media este token COLAPSA contra
    // `--primary-foreground` y los dos salen blanco puro. No es un bug: si el
    // campo apenas llega a 4.5:1 con blanco (el verde por defecto, #468511, da
    // 4.54:1), no existe un segundo nivel más tenue que siga pasando. La
    // jerarquía secundaria sobre el campo de color se hace con TAMAÑO Y PESO,
    // nunca con opacidad — eso rompería la garantía. Verificado en el render:
    // con el verde por defecto los dos emiten `oklch(1 0 0)`.
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

    // Ver DENSITY_SCALE: mueve el ritmo entero de Tailwind dentro de la tienda.
    '--spacing': scaled(0.25),
    '--density-scale': String(density),

    // --- Por qué estos tokens se REEMITEN acá y no se derivan en globals.css --
    // `var()` dentro de una custom property se sustituye donde la propiedad se
    // DECLARA, no donde se usa. O sea que un
    // `--space-4: calc(1rem * var(--density-scale))` escrito en `:root` congela
    // el factor de `:root` (1) y lo hereda ya resuelto: pisar
    // `--density-scale` acá adentro no lo movería nunca.
    // Verificado en el browser: con `--a: calc(10px * var(--k))` declarado
    // donde `--k:1`, un descendiente con `--k:2` sigue midiendo 10px.
    // `--spacing` sí funciona por la razón opuesta: Tailwind emite
    // `calc(var(--spacing) * 4)` en el ELEMENTO, así que ahí sí resuelve
    // contra el valor heredado. Todo lo demás hay que emitirlo ya calculado.
    '--space-1': scaled(0.25),
    '--space-2': scaled(0.5),
    '--space-3': scaled(0.75),
    '--space-4': scaled(1),
    '--space-5': scaled(1.5),
    '--space-6': scaled(2),
    '--space-7': scaled(3),
    '--space-8': scaled(4),

    // El chasis pegajoso escala con la densidad porque lo que vive ADENTRO
    // escala: `iconButtonClass` es `size-11`, o sea 11 × `--spacing`. Con el
    // dock clavado en 3.5rem y la densidad en 1.22, el botón medía 53.7px
    // dentro de una barra de 56px — 1px de aire, y el ícono asomando por el
    // borde. Las alturas del chasis y sus contenidos son la misma escala o no
    // son nada.
    '--chrome-h': scaled(3.75),
    '--rail-h': scaled(4.5),
    '--sticky-offset': scaled(3.75 + 4.5),
    '--dock-h': scaled(3.5),

    // --- Columnas de la carta -------------------------------------------------
    // La densidad no es solo aire: cambia la FORMA de la carta. Compacta = dos
    // productos por fila (tarjeta vertical, foto arriba); cómoda y amplia = uno
    // por fila, y a ese ancho la tarjeta se acuesta sola (foto a un costado)
    // porque una foto a sangre completa por producto convierte la carta en un
    // scroll infinito.
    //
    // Va como VARIABLE y no como prop para que `app/[store]/loading.tsx` —que
    // no puede leer la tienda, Next no le pasa params— dibuje el esqueleto con
    // la misma grilla que el contenido real. Un esqueleto con otra cantidad de
    // columnas es un salto de layout en cada carga.
    '--catalog-cols': branding.density === 'compact' ? '2' : '1',

    '--dock-gap': scaled(0.75),

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
