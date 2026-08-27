/**
 * Conversión hex → OKLCH.
 *
 * shadcn define sus tokens en oklch, y OKLCH es perceptualmente uniforme: mover
 * la lightness un 10% se ve como un 10% en cualquier tono. Eso permite derivar
 * hover, ring y superficies suaves a partir de UN color de marca, sin que el
 * naranja quede lavado y el azul quede oscuro con el mismo ajuste.
 */

export type Oklch = { l: number; c: number; h: number }

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

export function hexToOklch(hex: string): Oklch {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new Error(`Color hex inválido: ${hex}`)

  const int = Number.parseInt(match[1], 16)
  const r = srgbToLinear(((int >> 16) & 0xff) / 255)
  const g = srgbToLinear(((int >> 8) & 0xff) / 255)
  const b = srgbToLinear((int & 0xff) / 255)

  // sRGB lineal → LMS → OKLab (Björn Ottosson)
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  const chroma = Math.sqrt(a * a + bb * bb)
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360

  return { l: L, c: chroma, h: hue }
}

const round = (n: number, digits: number) => Number(n.toFixed(digits))

export function oklchToCss({ l, c, h }: Oklch): string {
  return `oklch(${round(l, 4)} ${round(c, 4)} ${round(h, 2)})`
}

/** Deriva una variante ajustando lightness y croma en el mismo tono. */
export function shift(base: Oklch, { l = 0, c = 1 }: { l?: number; c?: number }): Oklch {
  return {
    l: Math.min(1, Math.max(0, base.l + l)),
    c: Math.max(0, base.c * c),
    h: base.h,
  }
}

/** Blanco o negro según cuál contraste mejor sobre el color dado. */
export function readableOn(base: Oklch): Oklch {
  return base.l > 0.62 ? { l: 0.145, c: 0, h: 0 } : { l: 0.985, c: 0, h: 0 }
}

// ---------------------------------------------------------------------------
// Contraste
//
// Cada local elige sus colores, así que la legibilidad NO puede depender de que
// elijan bien. Estas funciones vuelven de OKLCH a sRGB para medir contraste WCAG
// de verdad y corregir la lightness hasta que pase el umbral.
// ---------------------------------------------------------------------------

function linearToSrgb(channel: number): number {
  const v = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
  return Math.min(1, Math.max(0, v))
}

/** OKLCH → sRGB en 0..1. Recorta fuera de gamut, que es lo que hace el browser. */
export function oklchToSrgb({ l, c, h }: Oklch): { r: number; g: number; b: number } {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const bb = c * Math.sin(rad)

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3

  return {
    r: linearToSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: linearToSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: linearToSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  }
}

function relativeLuminance(color: Oklch): number {
  const { r, g, b } = oklchToSrgb(color)
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Ratio WCAG 2.1 entre dos colores: 1 (igual) a 21 (blanco sobre negro). */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Empuja la lightness del frente hasta alcanzar el ratio pedido contra el fondo,
 * conservando tono y croma para que siga siendo el color de la marca.
 *
 * Se prueba en las dos direcciones y gana la que llegue: sobre un fondo medio,
 * a veces oscurecer contrasta más que aclarar, y al revés.
 */
export function ensureContrast(foreground: Oklch, background: Oklch, target = 4.5): Oklch {
  if (contrastRatio(foreground, background) >= target) return foreground

  let best = foreground
  let bestRatio = contrastRatio(foreground, background)

  for (const direction of [1, -1]) {
    for (let step = 1; step <= 40; step++) {
      const candidate = { ...foreground, l: Math.min(1, Math.max(0, foreground.l + direction * step * 0.025)) }
      const ratio = contrastRatio(candidate, background)
      if (ratio > bestRatio) {
        best = candidate
        bestRatio = ratio
      }
      if (ratio >= target) break
    }
    if (bestRatio >= target) break
  }

  // Si ni negro ni blanco puros alcanzan el objetivo, el fondo es el problema:
  // devolvemos el extremo que más contraste da en vez de un color a medias.
  return best
}
