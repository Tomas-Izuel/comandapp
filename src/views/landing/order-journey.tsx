'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SCREENSHOT_CAPTION, type JourneyStation } from '@/lib/landing'
import { StepMark, iconButtonClass } from '@/views/shared/surfaces'
import { cn } from '@/lib/utils'

/**
 * La isla cliente del recorrido. Server Component (`screens.tsx`) le pasa las
 * cinco estaciones ya tipadas; acá vive TODA la interacción: qué estación está
 * "activa" (según qué texto cruza el centro del viewport en desktop, o qué
 * tarjeta ocupa el riel en mobile) y el visor que la muestra.
 *
 * Nada de pinning por JS ni de scroll secuestrado: el scroll es nativo en los
 * dos layouts. El único trabajo de este componente es OBSERVAR el scroll
 * (`IntersectionObserver`) y reflejar el resultado — nunca conducirlo.
 */

type Aspect = 'phone' | 'desktop'

/** El aspecto sale de las dimensiones reales, no de una lista de ids a mano:
 * si `landing.ts` agrega una estación, esto no se desactualiza en silencio. */
function aspectOf(station: JourneyStation): Aspect {
  return station.screen.width < station.screen.height ? 'phone' : 'desktop'
}

function stepStateFor(index: number, activeIndex: number): 'done' | 'current' | 'todo' {
  if (index < activeIndex) return 'done'
  if (index === activeIndex) return 'current'
  return 'todo'
}

export function OrderJourneyClient({ stations }: { stations: readonly JourneyStation[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  // Cuántas veces cada estación PASÓ a ser la activa. Arranca en todos ceros
  // a propósito: es lo que distingue "la estación 0 ya viene activa en el
  // HTML servido" (no parpadea) de "la estación 0 se volvió a activar porque
  // el lector volvió atrás" (sí parpadea). Solo lo sube `handleActiveChange`,
  // nunca el render inicial.
  const [activationCounts, setActivationCounts] = useState<number[]>(() => stations.map(() => 0))
  const prevIndexRef = useRef(0)

  // Solo hace falta para decidir CÓMO se mueve el riel de mobile al tocar los
  // botones (`scrollIntoView`): el crossfade del visor ya lo recorta el
  // bloque global de `prefers-reduced-motion` en globals.css. El valor
  // inicial se lee en el inicializador perezoso (corre en el primer render
  // del cliente, después de hidratar) en vez de en el cuerpo del efecto, para
  // no disparar un `setState` síncrono ahí adentro.
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Único punto que decide "cuál estación está activa": lo alimenta CUALQUIERA
  // de los dos observers (desktop o mobile), pero solo el que de verdad está
  // visible según el breakpoint CSS dispara con datos reales. El guard de
  // `prevIndexRef` evita subir el contador de activaciones en llamadas
  // redundantes (p. ej. el observer de "intro" reafirmando la estación 0 en
  // cada scroll mientras el título sigue en pantalla).
  const handleActiveChange = useCallback((index: number) => {
    if (prevIndexRef.current === index) return
    prevIndexRef.current = index
    setActiveIndex(index)
    setActivationCounts((counts) => {
      const next = counts.slice()
      next[index] = (next[index] ?? 0) + 1
      return next
    })
  }, [])

  return (
    <div className="mt-8 lg:mt-14">
      <DesktopJourney
        stations={stations}
        activeIndex={activeIndex}
        onActiveChange={handleActiveChange}
        activationCounts={activationCounts}
        reducedMotion={reducedMotion}
      />
      <MobileJourney
        stations={stations}
        activeIndex={activeIndex}
        onActiveChange={handleActiveChange}
        activationCounts={activationCounts}
        reducedMotion={reducedMotion}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Desktop: visor sticky + riel de texto.
   --------------------------------------------------------------------------- */

function DesktopJourney({
  stations,
  activeIndex,
  onActiveChange,
  activationCounts,
  reducedMotion,
}: {
  stations: readonly JourneyStation[]
  activeIndex: number
  onActiveChange: (index: number) => void
  activationCounts: number[]
  reducedMotion: boolean
}) {
  const textRefs = useRef<Array<HTMLDivElement | null>>([])
  const introRef = useRef<HTMLDivElement | null>(null)
  // Qué estaciones están AHORA MISMO dentro de la banda central. Ojo: el
  // callback de IntersectionObserver solo entrega los targets cuyo estado
  // cambió desde la última vuelta, no todos los que siguen intersectando. Si
  // se leyera solo `entries` (como hacía la versión anterior), apenas la
  // segunda estación tocaba la banda pasaba a ser la ÚNICA entrada de ese
  // callback y "ganaba" aunque la primera siguiera ahí adentro — esa era la
  // causa real de que el visor saltara al segundo paso casi de inmediato.
  const inBandRef = useRef<Set<number>>(new Set([0]))
  // Mientras el título de la sección todavía está en pantalla (el centinela
  // de abajo no cruzó el 45% superior del viewport), la primera estación se
  // sostiene sin importar qué diga la banda.
  const introVisibleRef = useRef(true)

  const recompute = useCallback(() => {
    if (introVisibleRef.current) {
      onActiveChange(0)
      return
    }
    if (inBandRef.current.size === 0) return
    onActiveChange(Math.min(...inBandRef.current))
  }, [onActiveChange])

  useEffect(() => {
    const nodes = textRefs.current.filter((node): node is HTMLDivElement => node !== null)
    if (nodes.length === 0) return

    // Banda angosta centrada (10% del viewport, de 45% a 55%): el texto que
    // la cruza es el que el lector está leyendo AHORA, no el que apenas asoma
    // en el borde.
    const bandObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number(entry.target.getAttribute('data-station-index'))
          if (Number.isNaN(index)) return
          if (entry.isIntersecting) inBandRef.current.add(index)
          else inBandRef.current.delete(index)
        })
        recompute()
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    nodes.forEach((node) => bandObserver.observe(node))

    let introObserver: IntersectionObserver | undefined
    if (introRef.current) {
      introObserver = new IntersectionObserver(
        ([entry]) => {
          introVisibleRef.current = entry?.isIntersecting ?? false
          recompute()
        },
        { rootMargin: '0px 0px -55% 0px', threshold: 0 },
      )
      introObserver.observe(introRef.current)
    }

    return () => {
      bandObserver.disconnect()
      introObserver?.disconnect()
    }
  }, [stations.length, recompute])

  return (
    <div className="hidden gap-10 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start xl:gap-14">
      <div className="sticky top-(--sticky-offset)">
        <Visor stations={stations} activeId={stations[activeIndex]?.id} />
      </div>

      <div>
        {/* Centinela sin altura real, pegado arriba de la primera estación.
            Mientras siga en el 45% superior del viewport, el título de la
            sección todavía se está leyendo. */}
        <div ref={introRef} aria-hidden className="h-px" />
        <ol className="flex flex-col gap-10 xl:gap-12">
          {stations.map((station, index) => {
            const state = stepStateFor(index, activeIndex)
            // Solo la estación que JUSTO se activó parpadea, y solo a partir
            // de un cambio real (activationCounts[index] > 0): la que ya
            // viene activa en el HTML servido no.
            const shouldBlink = state === 'current' && !reducedMotion && (activationCounts[index] ?? 0) > 0
            return (
              <li key={station.id} className="flex gap-4 lg:min-h-[60vh]">
                <div className="flex w-6 shrink-0 flex-col items-center" aria-hidden>
                  {shouldBlink ? (
                    <span
                      key={`${station.id}-${activationCounts[index]}`}
                      className="landing-blink inline-flex"
                    >
                      <StepMark state={state} />
                    </span>
                  ) : (
                    <StepMark state={state} />
                  )}
                  {index < stations.length - 1 ? <span className="bg-border mt-1 w-px flex-1" /> : null}
                </div>
                <div
                  ref={(node) => {
                    textRefs.current[index] = node
                  }}
                  data-station-index={index}
                  className="min-w-0 flex-1 pb-2 lg:flex lg:flex-col lg:justify-center"
                >
                  <StationCopy station={station} />
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

function StationCopy({ station }: { station: JourneyStation }) {
  return (
    <div>
      {/* El "quién" ES el encabezado de la estación, no una etiqueta chica
          arriba de otro título: por eso es el h3 y va primero. */}
      <h3 className="display text-foreground text-xl font-semibold sm:text-2xl">{station.who}</h3>
      <p className="text-foreground mt-1.5 text-base font-medium sm:text-lg">{station.title}</p>
      <p className="text-muted-foreground mt-1.5 max-w-[52ch] text-sm sm:text-base">{station.claim}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {station.facts.map((fact) => (
          <li key={fact} className="text-muted-foreground flex gap-2.5 text-sm">
            <span className="text-border mt-1.5 block size-1 shrink-0 rounded-full bg-current" aria-hidden />
            <span className="min-w-0">{fact}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   El visor: un marco de celular y uno de escritorio, superpuestos.

   Las cinco fotos están montadas desde el inicio (nada se descarga al
   cambiar). Cada marco reserva la altura entera del visor (`h-full` el de
   celular, `w-full` el de escritorio) y los dos quedan centrados uno sobre el
   otro (`absolute inset-0 m-auto`): cambiar de aspecto es un crossfade de
   opacidad entre dos cajas que ya ocupan el mismo lugar, nunca un salto de
   alto — el contenedor mide siempre lo mismo.

   Ninguna imagen de esta sección lleva `preload` (el nombre vigente en
   Next 16 — `priority` quedó deprecado, ver `node_modules/next/dist/docs/
   01-app/03-api-reference/02-components/image.md`). El recorrido es la
   TERCERA sección de la página (`page.tsx`: hero → carrera → recorrido), así
   que su primera imagen nunca es el LCP real — eso es el `<h1>` del hero,
   arriba de todo. Precargar acá, encima, duplicaba el mismo asset
   (`pantalla-cliente.png`) en dos `<link rel="preload">` porque los DOS
   árboles (desktop y mobile) montan siempre, uno oculto por CSS: una
   precarga de alta prioridad al asset equivocado, compitiendo con el LCP
   real en la conexión mala de un celular. Con `loading="lazy"` en todo el
   árbol, el navegador las trae recién cuando se acercan al viewport.
   --------------------------------------------------------------------------- */

const PHONE_VISOR_SIZES = '14rem'
const DESK_VISOR_SIZES = '(min-width: 1280px) 34rem, 28rem'

function Visor({
  stations,
  activeId,
}: {
  stations: readonly JourneyStation[]
  activeId: JourneyStation['id'] | undefined
}) {
  const active = stations.find((station) => station.id === activeId) ?? stations[0]
  if (!active) return null
  const isPhoneActive = aspectOf(active) === 'phone'

  return (
    <figure className="flex flex-col gap-3">
      <div className="relative h-[26rem] w-full xl:h-[30rem]">
        <FrameStack stations={stations} aspect="phone" activeId={active.id} visible={isPhoneActive} />
        <FrameStack stations={stations} aspect="desktop" activeId={active.id} visible={!isPhoneActive} />
      </div>
      <figcaption className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">{active.screen.claim}</p>
        <p className="text-muted-foreground text-xs">{SCREENSHOT_CAPTION}</p>
      </figcaption>
    </figure>
  )
}

function FrameStack({
  stations,
  aspect,
  activeId,
  visible,
}: {
  stations: readonly JourneyStation[]
  aspect: Aspect
  activeId: JourneyStation['id']
  visible: boolean
}) {
  const own = useMemo(() => stations.filter((station) => aspectOf(station) === aspect), [stations, aspect])
  if (own.length === 0) return null

  const first = own[0]!

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'border-border bg-muted shadow-raise absolute inset-0 m-auto overflow-hidden rounded-(--radius) border transition-opacity duration-(--dur-base) ease-(--ease-out-expo)',
        aspect === 'phone' ? 'h-full' : 'w-full',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ aspectRatio: `${first.screen.width} / ${first.screen.height}` }}
    >
      {own.map((station) => (
        <Image
          key={station.id}
          src={station.screen.src}
          alt={station.screen.alt}
          fill
          sizes={aspect === 'phone' ? PHONE_VISOR_SIZES : DESK_VISOR_SIZES}
          aria-hidden={station.id !== activeId}
          loading="lazy"
          className={cn(
            'object-cover transition-opacity duration-(--dur-base) ease-(--ease-out-expo)',
            station.id === activeId ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Mobile: riel horizontal con scroll-snap nativo.
   --------------------------------------------------------------------------- */

function MobileJourney({
  stations,
  activeIndex,
  onActiveChange,
  activationCounts,
  reducedMotion,
}: {
  stations: readonly JourneyStation[]
  activeIndex: number
  onActiveChange: (index: number) => void
  activationCounts: number[]
  reducedMotion: boolean
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const slideRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    const root = railRef.current
    const nodes = slideRefs.current.filter((node): node is HTMLDivElement => node !== null)
    if (!root || nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return
        const most = visible.reduce((a, b) => (a.intersectionRatio >= b.intersectionRatio ? a : b))
        const index = Number(most.target.getAttribute('data-station-index'))
        if (!Number.isNaN(index)) onActiveChange(index)
      },
      { root, threshold: 0.6 },
    )

    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [stations.length, onActiveChange])

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(stations.length - 1, index))
      slideRefs.current[clamped]?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        inline: 'start',
        block: 'nearest',
      })
    },
    [stations.length, reducedMotion],
  )

  return (
    <div className="lg:hidden">
      <div
        ref={railRef}
        className="rail -mx-4 flex px-4 sm:-mx-6 sm:px-6"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {stations.map((station, index) => (
          <div
            key={station.id}
            ref={(node) => {
              slideRefs.current[index] = node
            }}
            data-station-index={index}
            className="w-full shrink-0 snap-start pr-4 last:pr-0 sm:pr-6"
          >
            <MobileStationCard station={station} />
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => goTo(activeIndex - 1)}
          disabled={activeIndex === 0}
          aria-label="Estación anterior del recorrido"
          className={iconButtonClass('surface', 'touch-manipulation disabled:opacity-35 disabled:hover:bg-card')}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>

        <ol className="flex items-center gap-2">
          {stations.map((station, index) => {
            const state = stepStateFor(index, activeIndex)
            const shouldBlink = state === 'current' && !reducedMotion && (activationCounts[index] ?? 0) > 0
            return (
              <li key={station.id} aria-current={index === activeIndex ? 'true' : undefined}>
                {shouldBlink ? (
                  <span key={`${station.id}-${activationCounts[index]}`} className="landing-blink inline-flex">
                    <StepMark state={state} />
                  </span>
                ) : (
                  <StepMark state={state} />
                )}
              </li>
            )
          })}
        </ol>

        <button
          type="button"
          onClick={() => goTo(activeIndex + 1)}
          disabled={activeIndex === stations.length - 1}
          aria-label="Estación siguiente del recorrido"
          className={iconButtonClass('surface', 'touch-manipulation disabled:opacity-35 disabled:hover:bg-card')}
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

function MobileStationCard({ station }: { station: JourneyStation }) {
  const isPhone = aspectOf(station) === 'phone'

  return (
    <figure className="flex h-full flex-col gap-4">
      <div
        className="border-border bg-muted shadow-raise mx-auto w-full overflow-hidden rounded-(--radius) border"
        style={{
          aspectRatio: `${station.screen.width} / ${station.screen.height}`,
          maxWidth: isPhone ? '14rem' : '100%',
        }}
      >
        <div className="relative h-full w-full">
          <Image
            src={station.screen.src}
            alt={station.screen.alt}
            fill
            sizes={isPhone ? '(min-width: 640px) 14rem, 60vw' : '(min-width: 640px) 30rem, 92vw'}
            className="object-cover"
            loading="lazy"
          />
        </div>
      </div>
      <figcaption className="flex min-h-[16rem] flex-col gap-1.5 sm:min-h-[14rem]">
        <h3 className="display text-foreground text-lg font-semibold sm:text-xl">{station.who}</h3>
        <p className="text-foreground text-sm font-medium sm:text-base">{station.title}</p>
        <p className="text-muted-foreground text-sm">{station.claim}</p>
        <ul className="mt-1 flex flex-col gap-1.5">
          {station.facts.map((fact) => (
            <li key={fact} className="text-muted-foreground flex gap-2.5 text-sm">
              <span className="text-border mt-1.5 block size-1 shrink-0 rounded-full bg-current" aria-hidden />
              <span className="min-w-0">{fact}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-1 text-xs">{SCREENSHOT_CAPTION}</p>
      </figcaption>
    </figure>
  )
}
