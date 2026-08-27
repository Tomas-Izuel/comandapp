import {
  Anton,
  Archivo,
  Bebas_Neue,
  Bricolage_Grotesque,
  DM_Sans,
  Geist,
  Geist_Mono,
  Inter,
  Oswald,
  Outfit,
  Plus_Jakarta_Sans,
  Space_Grotesk,
} from 'next/font/google'

/**
 * Catálogo de tipografías del kit de marca.
 *
 * Se declaran todas acá y cada una expone su variable CSS. Ojo con la promesa
 * de "el navegador solo descarga las que el CSS usa": eso es cierto para la
 * DESCARGA del archivo (el @font-face es perezoso), pero `preload` es `true`
 * por defecto en `next/font`, y Next precarga según dónde se invoca la función
 * — el root layout precarga en TODA ruta de la app. Con las once declaradas acá
 * e importadas desde `app/layout.tsx`, cada página (incluidas /admin y
 * /backoffice, que no usan marca de ningún local) emitía un
 * `<link rel="preload" as="font">` por familia: decenas o cientos de KB
 * forzados en el primer viewport de un cliente en 3G, para fuentes que esa
 * ruta ni siquiera renderiza.
 *
 * `preload: false` en todas menos Geist/Geist Mono corta eso: son las dos que
 * se usan en todas partes (voz del sistema, admin, backoffice, fallback sin
 * marca) y ganan precarga; las diez de marca solo se buscan cuando el CSS de
 * la tienda las referencia, sin adelantar la descarga en rutas que no las ven.
 * No hay forma soportada de precargar manualmente solo las dos de una tienda
 * puntual: `next/font` no expone la URL hasheada del archivo self-hosted fuera
 * de este módulo, así que un `<link rel="preload">` a mano no tiene a qué
 * apuntar. Ver el reporte del slice de layout compartido para el detalle.
 *
 * El slug de cada variable coincide con el valor guardado en `store_branding`,
 * porque `buildThemeCss()` arma `var(--font-<slug>)` sin tabla de traducción.
 *
 * Las caras de display (Bebas, Anton, Oswald, Archivo) son la voz de marca del
 * local: nombre del local, títulos de sección, nombres de producto. En el mundo
 * actual se usan en CAJA MIXTA y a tamaño de título — el programa anterior las
 * usaba en caja alta condensada y esa es justamente una de las cosas que se
 * rechazaron. NO son elegibles para texto corrido, y el schema lo impide.
 */

const geist = Geist({ variable: '--font-geist', subsets: ['latin'], display: 'swap' })
const geistMono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'], display: 'swap' })
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap', preload: false })
const plusJakarta = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const dmSans = DM_Sans({ variable: '--font-dm-sans', subsets: ['latin'], display: 'swap', preload: false })
const outfit = Outfit({ variable: '--font-outfit', subsets: ['latin'], display: 'swap', preload: false })
const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const archivo = Archivo({ variable: '--font-archivo', subsets: ['latin'], display: 'swap', preload: false })
const oswald = Oswald({ variable: '--font-oswald', subsets: ['latin'], display: 'swap', preload: false })
const bebas = Bebas_Neue({
  variable: '--font-bebas-neue',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  preload: false,
})
const anton = Anton({
  variable: '--font-anton',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  preload: false,
})

/** Todas las variables juntas, para colgar del <html> una sola vez. */
export const FONT_VARIABLES = [
  geist.variable,
  geistMono.variable,
  inter.variable,
  plusJakarta.variable,
  spaceGrotesk.variable,
  dmSans.variable,
  outfit.variable,
  bricolage.variable,
  archivo.variable,
  oswald.variable,
  bebas.variable,
  anton.variable,
].join(' ')

/** Etiquetas para el selector del panel de apariencia. */
export const FONT_LABELS: Record<string, string> = {
  geist: 'Geist',
  inter: 'Inter',
  'plus-jakarta': 'Plus Jakarta Sans',
  'space-grotesk': 'Space Grotesk',
  'dm-sans': 'DM Sans',
  outfit: 'Outfit',
  bricolage: 'Bricolage Grotesque',
  archivo: 'Archivo',
  oswald: 'Oswald',
  'bebas-neue': 'Bebas Neue',
  anton: 'Anton',
}
