import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portal del repartidor',
}

/**
 * Chrome mínimo del segmento entero: /repartidor y /repartidor/acceso viven
 * los dos acá. A propósito NO resuelve sesión ni redirige — eso es trabajo de
 * `page.tsx` (ver su comentario), porque `/repartidor/acceso` es un HIJO de
 * este layout y un gate acá adentro se metería en un loop consigo mismo la
 * primera vez que alguien llega sin sesión.
 *
 * `min-h-dvh` + fondo base: la única garantía compartida es que ninguna
 * pantalla del portal queda más chica que el viewport, sea cual sea el
 * estado que termine renderizando `page.tsx`.
 */
export default function CourierLayout({ children }: LayoutProps<'/repartidor'>) {
  return <div className="bg-background min-h-dvh">{children}</div>
}
