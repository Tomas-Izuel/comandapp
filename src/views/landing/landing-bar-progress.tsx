'use client'

/**
 * Las dos cosas que la barra fija suma en esta ronda: la línea de progreso de
 * lectura, y el rótulo de la sección vigente. Dos componentes en un archivo
 * porque comparten el mismo dato (`SECTIONS`) y el mismo motivo de ser (que
 * el marco "trabaje" mientras se scrollea), pero viven en DOS lugares
 * distintos de `landing-bar.tsx` — el rótulo entre el logo y el CTA, la línea
 * pegada al borde inferior de toda la barra — así que no pueden ser un solo
 * componente con un solo `return`.
 *
 * `IntersectionObserver` en vez de comparar `scrollY` contra posiciones
 * calculadas a mano: las posiciones de sección cambian con cada slice que
 * agrega contenido, y con un observer la barra nunca queda desincronizada de
 * dónde está la sección de verdad.
 */

import { useEffect, useRef, useState } from 'react'
import { SECTIONS } from '@/lib/landing'

const LABEL_BY_ID = new Map(SECTIONS.map((section) => [section.id, section.label]))

// La banda de detección arranca justo debajo de la barra fija (~72px: CTA o
// logo de 44px + el padding vertical) y termina bien arriba del pie de
// pantalla: una sección "vigente" es la que cruza esa franja angosta, no
// cualquiera que esté parcialmente visible.
const ROOT_MARGIN = '-72px 0px -75% 0px'

/** Qué `id` de `[data-landing-section]` está cruzando la banda activa ahora mismo. */
function useActiveSectionId(): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)
  const orderRef = useRef(new Map<string, number>())
  const activeSetRef = useRef(new Set<string>())

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-landing-section]'))
    if (sections.length === 0) return

    sections.forEach((section, index) => orderRef.current.set(section.id, index))

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id
          if (entry.isIntersecting) activeSetRef.current.add(id)
          else activeSetRef.current.delete(id)
        }
        // Si ninguna cruza la banda ahora mismo (justo entre dos secciones),
        // se conserva el último rótulo: parpadear a "nada" en cada límite de
        // sección es peor que quedarse un instante de más con el anterior.
        if (activeSetRef.current.size === 0) return

        const order = orderRef.current
        let latest: string | null = null
        for (const id of activeSetRef.current) {
          if (latest === null || (order.get(id) ?? 0) > (order.get(latest) ?? 0)) latest = id
        }
        setActiveId(latest)
      },
      { rootMargin: ROOT_MARGIN, threshold: 0 },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  return activeId
}

/**
 * El rótulo de la sección vigente, solo desde `md:`. No se muestra nada hasta
 * que la primera sección cruza la banda — no hay rótulo "en blanco" que
 * mostrar antes de eso.
 *
 * `label` es derivado directo de `activeId`, sin estado ni efecto propio: no
 * hay nada que sincronizar con un sistema externo más allá de lo que ya
 * resuelve `useActiveSectionId`. El crossfade sale de reusar `.landing-num-in`
 * (la misma clase que "un número que cambió" en el resto de la landing, ver
 * `globals.css`) montada con `key={label}`: cada cambio de sección desmonta el
 * `<span>` viejo y monta uno nuevo que entra con `--dur-base`, que es
 * exactamente la textura de "esto es nuevo" que pide la especificación — sin
 * inventar un segundo mecanismo de fade a mano ni el efecto con `setState`
 * síncrono que eso requería.
 */
export function SectionLabel() {
  const activeId = useActiveSectionId()
  const label = activeId ? LABEL_BY_ID.get(activeId) : undefined
  if (!label) return null

  return (
    <span key={label} aria-hidden className="landing-num-in text-muted-foreground hidden truncate text-sm md:block">
      {label}
    </span>
  )
}

/** La línea de 2px en el borde inferior de la barra: cuánto se leyó de la página. */
export function ReadingProgressBar() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let ticking = false

    const measure = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0)
      ticking = false
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div
      aria-hidden
      className="bg-primary absolute inset-x-0 bottom-0 h-0.5 origin-left"
      style={{ transform: `scaleX(${progress})` }}
    />
  )
}
