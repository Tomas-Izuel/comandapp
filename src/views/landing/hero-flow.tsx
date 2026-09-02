'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { Bell, MapPin, MousePointer2, Motorbike, Pause, Play, Plus, RotateCcw, Store } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCentsCompact } from '@/lib/money'
import { DEMO_SCENE_CAPTION, HERO_FLOW, HERO_FLOW_DURATION_MS, HERO_ORDER } from '@/lib/landing'
import { Panel, PhotoFrame, StatusPill, StepMark, iconButtonClass } from '@/views/shared/surfaces'

/**
 * El storyboard del hero (ronda 5, a mano del hilo principal).
 *
 * Un escenario único donde un cuadro a la vez entra por la derecha, se
 * reproduce y sale por la izquierda —cinco cuadros: pide, paga, cocina,
 * listo, reparto— contando el pedido de DELIVERY `HERO_ORDER`. Es la única
 * escena ilustrada de la página y la única con un pedido distinto del #A2A1,
 * porque tiene que terminar en la puerta del cliente.
 *
 * Qué cambió respecto de la ronda anterior, y por qué:
 *
 * - **El cursor se ve moverse.** Antes arrancaba a 24px del botón con
 *   opacidad 0 y "llegaba" en 420ms: invisible. Ahora nace visible en la
 *   esquina opuesta del escenario y recorre ~200px en 900ms con
 *   `--ease-out-expo`; el clic es un `scale(.85)` del cursor más una onda
 *   (`landing-blink`) en el botón. Un gesto que el ojo puede seguir.
 * - **La foto.** La fila de producto lleva una foto real
 *   (`/landing/demo-doble-cheddar.jpg`, Unsplash License, placeholder hasta
 *   que el local piloto entregue las suyas), en el mismo `PhotoFrame` que
 *   usa la vitrina. La comida se ve antes que el texto: es la regla del
 *   producto y acá también vende.
 * - **Cuadros con entrada y salida distintas.** El saliente se desplaza a la
 *   izquierda, se achica a .96 y se desenfoca 2px; el entrante llega desde la
 *   derecha con 120ms de retraso, para que no sea un crossfade plano en el
 *   mismo lugar. Dentro de cada cuadro hay un segundo gesto propio: la hoja
 *   de pago sube desde abajo como una hoja real, la tarjeta de cocina entra
 *   por la derecha del tablero, el aviso al cliente baja desde arriba.
 * - **La moto la mueve el reloj de la escena**, no una transición CSS sobre
 *   coordenadas fijas: en cada frame se lee `getPointAtLength` del `<path>`
 *   real y se posiciona el `<g>` con `transform`, con rotación tangente. Así
 *   la ruta puede escalar con el ancho del escenario (`viewBox`) y la moto
 *   siempre va sobre la línea. La parte recorrida se pinta en verde de marca
 *   con `pathLength="1"` + `stroke-dashoffset`, en sincronía exacta.
 *
 * Estrategia sin JS / SSR, igual que el resto de las demos: el estado por
 * defecto de React ya es el ÚLTIMO cuadro completo (la moto en la puerta,
 * ticket "Entregado 22:24"). `play()` vacía el escenario y lo recorre desde
 * el cuadro 1, y SOLO se llama desde un callback asincrónico (el
 * `IntersectionObserver`, el botón), nunca desde el cuerpo de un efecto. Con
 * `prefers-reduced-motion` no hay escena ni botón: se ve el final.
 *
 * El reloj es un `requestAnimationFrame` que acumula el tiempo transcurrido
 * en un ref, así que pausar (a mano, al ocultar la pestaña o al salir del
 * viewport) y reanudar retoma exactamente donde quedó.
 */

/** Cinco cuadros a ~2,6s: el contrato de la ronda lo fija así. */
const STEP_MS = HERO_FLOW_DURATION_MS / HERO_FLOW.length
const LAST_STEP = HERO_FLOW.length - 1
const CURSOR_TRAVEL_MS = 900
/** Tope del delta por frame: un frame "largo" (pestaña congelada) cuenta como uno normal. */
const MAX_FRAME_DELTA_MS = 64

/** Foto de demostración del producto (placeholder hasta que lleguen las del local piloto). */
const DEMO_PRODUCT_PHOTO = '/landing/demo-doble-cheddar.jpg'

/* Cuadro 1 — pide: el cursor cruza el escenario, toca el "+", el pedido queda armado. */
const CURSOR1_GO_MS = 150
const PRESS1_ON_MS = CURSOR1_GO_MS + CURSOR_TRAVEL_MS + 80
const PRESS1_OFF_MS = PRESS1_ON_MS + 130
const ORDER_LINE_MS = PRESS1_OFF_MS + 60

/* Cuadro 2 — paga: la hoja sube, el cursor va al botón, queda pagado. */
const CURSOR2_GO_MS = STEP_MS * 1 + 650
const PRESS2_ON_MS = CURSOR2_GO_MS + 650
const PRESS2_OFF_MS = PRESS2_ON_MS + 130
const PAID_MS = PRESS2_OFF_MS + 40
const ACCOUNT_LINE_MS = PAID_MS + 380

/* Cuadro 3 — cocina: la tarjeta entra al tablero, el mostrador la toma, la sartén arranca. */
const KITCHEN_PRESS_ON_MS = STEP_MS * 2 + 750
const KITCHEN_PRESS_OFF_MS = KITCHEN_PRESS_ON_MS + 130
const COOKING_MS = KITCHEN_PRESS_OFF_MS + 40

/* Cuadro 4 — listo: sale de la cocina y el aviso baja al celular del cliente. */
const NOTIFY_MS = STEP_MS * 3 + 550

/* Cuadro 5 — reparto: la moto arranca, recorre la ruta, el pin cae, entregado. */
const MOTO_START_MS = STEP_MS * 4 + 350
const MOTO_TRAVEL_MS = 1750
const MOTO_END_MS = MOTO_START_MS + MOTO_TRAVEL_MS
const DELIVERED_MS = MOTO_END_MS + 120

/** La ruta del reparto en unidades del viewBox (320×120). Lo mismo dibuja el `<path>` y lo recorre la moto. */
const ROUTE_PATH = 'M28 92 C 96 20, 224 20, 292 92'
const ROUTE_START = { x: 28, y: 92 }
const ROUTE_END = { x: 292, y: 92 }

type ScenePhase = 'idle' | 'playing' | 'paused' | 'done'
type Beat = { readonly ms: number; readonly apply: () => void }

/** Estado de la escena. Cada campo arranca en su valor FINAL (ver arriba). */
type SceneState = {
  cursor1Arrived: boolean
  cursor1Pressed: boolean
  ripple1: number
  orderLine: boolean
  cursor2Arrived: boolean
  cursor2Pressed: boolean
  ripple2: number
  paid: boolean
  accountLine: boolean
  kitchenPressed: boolean
  kitchenRipple: number
  cooking: boolean
  notified: boolean
  motoArrived: boolean
  delivered: boolean
}

const FINAL_STATE: SceneState = {
  cursor1Arrived: true,
  cursor1Pressed: false,
  ripple1: 0,
  orderLine: true,
  cursor2Arrived: true,
  cursor2Pressed: false,
  ripple2: 0,
  paid: true,
  accountLine: true,
  kitchenPressed: false,
  kitchenRipple: 0,
  cooking: true,
  notified: true,
  motoArrived: true,
  delivered: true,
}

const START_STATE: SceneState = {
  cursor1Arrived: false,
  cursor1Pressed: false,
  ripple1: 0,
  orderLine: false,
  cursor2Arrived: false,
  cursor2Pressed: false,
  ripple2: 0,
  paid: false,
  accountLine: false,
  kitchenPressed: false,
  kitchenRipple: 0,
  cooking: false,
  notified: false,
  motoArrived: false,
  delivered: false,
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(callback: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}
function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}
/** `false` en el server: sin `matchMedia` ahí, y coincide con el default del HTML servido. */
function getReducedMotionServerSnapshot() {
  return false
}

/** Ease-out cúbico: la misma familia de "llega y frena" que `--ease-out-expo`, para el recorrido de la moto. */
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

const totalLabel = formatCentsCompact(HERO_ORDER.totalCents, HERO_ORDER.currency)
const subtotalLabel = formatCentsCompact(HERO_ORDER.subtotalCents, HERO_ORDER.currency)
const deliveryFeeLabel = formatCentsCompact(HERO_ORDER.deliveryFeeCents, HERO_ORDER.currency)
const itemsLine = HERO_ORDER.items.map((item) => `${item.quantity}× ${item.name}`).join(' · ')

export function HeroFlow() {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  )

  const [stepIndex, setStepIndex] = useState(LAST_STEP)
  const [scene, setScene] = useState<SceneState>(FINAL_STATE)
  const [phase, setPhase] = useState<ScenePhase>('idle')
  const [hasPlayed, setHasPlayed] = useState(false)
  // Solo para el instante del reinicio: sin esto, volver al cuadro 1 se vería
  // como los cinco cuadros deslizándose de golpe en vez de un corte.
  const [suppressTransition, setSuppressTransition] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const routeRef = useRef<SVGPathElement>(null)
  const routeDoneRef = useRef<SVGPathElement>(null)
  const motoRef = useRef<SVGGElement>(null)

  const phaseRef = useRef<ScenePhase>('idle')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const beatsRef = useRef<Beat[]>([])
  const nextBeatIndexRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const tickRef = useRef<((now: number) => void) | null>(null)
  const autoPausedRef = useRef(false)
  const intersectingRef = useRef(false)

  const patch = useCallback((next: Partial<SceneState>) => {
    setScene((prev) => ({ ...prev, ...next }))
  }, [])

  const bump = useCallback((key: 'ripple1' | 'ripple2' | 'kitchenRipple') => {
    setScene((prev) => ({ ...prev, [key]: prev[key] + 1 }))
  }, [])

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  /** Posiciona la moto y pinta la parte recorrida de la ruta para un progreso 0..1. */
  const placeMoto = useCallback((progress: number) => {
    const route = routeRef.current
    const moto = motoRef.current
    const done = routeDoneRef.current
    if (!route || !moto) return
    const length = route.getTotalLength()
    const at = Math.min(length, Math.max(0, progress * length))
    const point = route.getPointAtLength(at)
    const ahead = route.getPointAtLength(Math.min(length, at + 2))
    const angle = (Math.atan2(ahead.y - point.y, ahead.x - point.x) * 180) / Math.PI
    // La tangente se acota: la moto inclina la trompa en la subida y la bajada,
    // pero no gira como un avión — el dibujo es de perfil.
    const tilt = Math.max(-18, Math.min(18, angle))
    moto.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${tilt})`)
    if (done) done.style.strokeDashoffset = String(1 - progress)
  }, [])

  const showFinalState = useCallback(() => {
    setStepIndex(LAST_STEP)
    setScene(FINAL_STATE)
    setPhase('done')
    placeMoto(1)
  }, [placeMoto])

  const buildBeats = useCallback(
    (): Beat[] =>
      [
        { ms: CURSOR1_GO_MS, apply: () => patch({ cursor1Arrived: true }) },
        { ms: PRESS1_ON_MS, apply: () => patch({ cursor1Pressed: true }) },
        {
          ms: PRESS1_OFF_MS,
          apply: () => {
            patch({ cursor1Pressed: false })
            bump('ripple1')
          },
        },
        { ms: ORDER_LINE_MS, apply: () => patch({ orderLine: true }) },
        { ms: STEP_MS * 1, apply: () => setStepIndex(1) },
        { ms: CURSOR2_GO_MS, apply: () => patch({ cursor2Arrived: true }) },
        { ms: PRESS2_ON_MS, apply: () => patch({ cursor2Pressed: true }) },
        {
          ms: PRESS2_OFF_MS,
          apply: () => {
            patch({ cursor2Pressed: false })
            bump('ripple2')
          },
        },
        { ms: PAID_MS, apply: () => patch({ paid: true }) },
        { ms: ACCOUNT_LINE_MS, apply: () => patch({ accountLine: true }) },
        { ms: STEP_MS * 2, apply: () => setStepIndex(2) },
        { ms: KITCHEN_PRESS_ON_MS, apply: () => patch({ kitchenPressed: true }) },
        {
          ms: KITCHEN_PRESS_OFF_MS,
          apply: () => {
            patch({ kitchenPressed: false })
            bump('kitchenRipple')
          },
        },
        { ms: COOKING_MS, apply: () => patch({ cooking: true }) },
        { ms: STEP_MS * 3, apply: () => setStepIndex(3) },
        { ms: NOTIFY_MS, apply: () => patch({ notified: true }) },
        { ms: STEP_MS * 4, apply: () => setStepIndex(4) },
        { ms: MOTO_END_MS, apply: () => patch({ motoArrived: true }) },
        { ms: DELIVERED_MS, apply: () => patch({ delivered: true }) },
      ].sort((a, b) => a.ms - b.ms),
    [bump, patch],
  )

  const play = useCallback(() => {
    stopAnimation()
    setSuppressTransition(true)
    setStepIndex(0)
    setScene(START_STATE)
    setHasPlayed(true)
    placeMoto(0)
    beatsRef.current = buildBeats()
    nextBeatIndexRef.current = 0
    elapsedRef.current = 0
    lastFrameAtRef.current = null
    setPhase('playing')

    // Deja que el corte al cuadro 1 pinte SIN transición y recién entonces la
    // vuelve a habilitar; si no, los cinco cuadros se ven reacomodarse.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSuppressTransition(false))
    })

    const tick = (now: number) => {
      // El reloj avanza por deltas ACOTADOS, no por reloj de pared: si el
      // navegador congela los frames (pestaña tapada, ventana ocluida, una
      // captura de pantalla) sin avisar con `visibilitychange`, al volver la
      // escena sigue donde estaba en vez de saltar al final de un golpe.
      if (lastFrameAtRef.current !== null) {
        elapsedRef.current += Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      }
      lastFrameAtRef.current = now
      const elapsed = elapsedRef.current

      while (
        nextBeatIndexRef.current < beatsRef.current.length &&
        beatsRef.current[nextBeatIndexRef.current].ms <= elapsed
      ) {
        beatsRef.current[nextBeatIndexRef.current].apply()
        nextBeatIndexRef.current += 1
      }

      // La moto la mueve el reloj: sin estado de React por frame, solo el DOM.
      if (elapsed >= MOTO_START_MS && elapsed <= MOTO_END_MS + 32) {
        placeMoto(easeOutCubic(Math.min(1, (elapsed - MOTO_START_MS) / MOTO_TRAVEL_MS)))
      }

      if (elapsed >= HERO_FLOW_DURATION_MS) {
        showFinalState()
        return
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    tickRef.current = tick
    rafRef.current = requestAnimationFrame(tick)
  }, [buildBeats, placeMoto, showFinalState, stopAnimation])

  const pause = useCallback(
    (auto: boolean) => {
      if (phaseRef.current !== 'playing') return
      stopAnimation()
      lastFrameAtRef.current = null
      autoPausedRef.current = auto
      setPhase('paused')
    },
    [stopAnimation],
  )

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused' || !tickRef.current) return
    setPhase('playing')
    rafRef.current = requestAnimationFrame(tickRef.current)
  }, [])

  const tryAutoResume = useCallback(() => {
    if (phaseRef.current === 'paused' && autoPausedRef.current && !document.hidden && intersectingRef.current) {
      resume()
    }
  }, [resume])

  // Arranca al entrar en pantalla; el mismo observer pausa/retoma al salir y volver.
  useEffect(() => {
    if (reducedMotion) return
    const node = rootRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        intersectingRef.current = entry.isIntersecting
        if (entry.isIntersecting) {
          if (phaseRef.current === 'idle') {
            play()
          } else {
            tryAutoResume()
          }
        } else if (phaseRef.current === 'playing') {
          pause(true)
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [reducedMotion, play, pause, tryAutoResume])

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        pause(true)
      } else {
        tryAutoResume()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pause, tryAutoResume])

  useEffect(() => stopAnimation, [stopAnimation])

  const step = HERO_FLOW[stepIndex]
  const animated = hasPlayed && !reducedMotion
  const ticketLabel = scene.delivered
    ? `Entregado ${HERO_ORDER.timeline.delivered}`
    : scene.orderLine
      ? totalLabel
      : 'Armando…'

  const controlLabel = phase === 'playing' ? 'Pausar' : phase === 'paused' ? 'Seguir' : 'Ver de nuevo'
  const controlIcon =
    phase === 'playing' ? (
      <Pause className="size-4 shrink-0" aria-hidden />
    ) : phase === 'paused' ? (
      <Play className="size-4 shrink-0" aria-hidden />
    ) : (
      <RotateCcw className="size-4 shrink-0" aria-hidden />
    )
  const onControlClick = phase === 'playing' ? () => pause(false) : phase === 'paused' ? resume : play

  return (
    <div ref={rootRef} className={cn('flex flex-col gap-4', suppressTransition && 'hero-noanim')}>
      {/* Keyframes y transiciones propias de la escena. Los loops (vapor,
          medallón) solo corren en el cuadro activo y con la sartén "cocinando";
          el bloque global de reduced-motion en globals.css corta cualquier
          `animation` igual. */}
      <style>{`
        .hero-frame {
          position: absolute;
          inset: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          place-items: center;
          padding: 1rem;
          transition:
            transform var(--dur-slow) var(--ease-out-expo),
            opacity var(--dur-slow) var(--ease-out-expo),
            filter var(--dur-slow) var(--ease-out-expo);
        }
        .hero-frame[data-pos='past'] {
          transform: translate3d(-14%, 0, 0) scale(0.96);
          opacity: 0;
          filter: blur(2px);
          pointer-events: none;
        }
        .hero-frame[data-pos='active'] {
          transform: none;
          opacity: 1;
          filter: none;
          transition-delay: 120ms;
        }
        .hero-frame[data-pos='future'] {
          transform: translate3d(16%, 0, 0) scale(0.98);
          opacity: 0;
          pointer-events: none;
        }
        .hero-noanim .hero-frame,
        .hero-noanim .hero-cursor,
        .hero-noanim .hero-enter {
          transition: none !important;
        }
        .hero-cursor {
          transition:
            transform ${CURSOR_TRAVEL_MS}ms var(--ease-out-expo),
            opacity var(--dur-base) var(--ease-out-expo);
        }
        .hero-cursor[data-pressed='true'] {
          transition-duration: var(--dur-fast);
        }
        .hero-enter {
          transition:
            transform var(--dur-slow) var(--ease-out-expo),
            opacity var(--dur-slow) var(--ease-out-expo);
        }
        @keyframes hero-bump {
          0% { transform: scale(1); }
          40% { transform: scale(1.12); }
          100% { transform: scale(1); }
        }
        .hero-bump { animation: hero-bump var(--dur-base) var(--ease-out-expo) 1; }
        @keyframes hero-steam {
          0% { opacity: 0; transform: translate3d(0, 6px, 0) scale(0.9); }
          30% { opacity: 0.7; }
          100% { opacity: 0; transform: translate3d(0, -18px, 0) scale(1.05); }
        }
        @keyframes hero-patty {
          0%, 100% { transform: translateY(0) rotateX(0deg); }
          45% { transform: translateY(-10px) rotateX(180deg); }
          60% { transform: translateY(0) rotateX(180deg); }
        }
        .hero-patty { transform-box: fill-box; transform-origin: center; }
        [data-cooking='true'] .hero-patty { animation: hero-patty 1.6s var(--ease-out-quart) infinite; }
        [data-cooking='true'] .hero-steam { animation: hero-steam 1.5s var(--ease-out-quart) infinite; }
        @keyframes hero-pin-drop {
          0% { transform: translateY(-14px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .hero-pin-drop { animation: hero-pin-drop var(--dur-base) var(--ease-out-expo) 1 both; }
        @keyframes hero-ping {
          0% { transform: scale(0.4); opacity: 0.6; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        .hero-ping { transform-box: fill-box; transform-origin: center; animation: hero-ping var(--dur-slow) var(--ease-out-expo) 1 both; }
        @keyframes hero-check {
          from { stroke-dashoffset: 24; }
          to { stroke-dashoffset: 0; }
        }
        .hero-check { stroke-dasharray: 24; animation: hero-check var(--dur-base) var(--ease-out-expo) 1 both; }
      `}</style>

      {/* El mapa del flujo: siempre visible, sea cual sea el estado de la
          escena — es la lectura sin JS de los cinco cuadros. */}
      <ol className="flex items-start">
        {HERO_FLOW.map((flowStep, index) => {
          const stepState = stepIndex > index ? 'done' : stepIndex === index ? 'current' : 'todo'
          return (
            <li
              key={flowStep.id}
              aria-current={stepState === 'current' ? 'step' : undefined}
              className="flex flex-1 flex-col items-center gap-1.5 last:flex-none"
            >
              <div className="flex w-full items-center">
                {index > 0 ? (
                  <span
                    className={cn(
                      'h-0.5 flex-1 rounded-pill transition-colors duration-(--dur-slow)',
                      stepIndex >= index ? 'bg-primary' : 'bg-border',
                    )}
                  />
                ) : null}
                <StepMark state={stepState} />
                {index < HERO_FLOW.length - 1 ? (
                  <span
                    className={cn(
                      'h-0.5 flex-1 rounded-pill transition-colors duration-(--dur-slow)',
                      stepIndex > index ? 'bg-primary' : 'bg-border',
                    )}
                  />
                ) : null}
              </div>
              <span
                className={cn(
                  'text-xs font-medium transition-colors duration-(--dur-base)',
                  stepState === 'current' ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {flowStep.short}
              </span>
              <span className="tabular text-muted-foreground text-[11px] whitespace-nowrap">{flowStep.at}</span>
            </li>
          )
        })}
      </ol>

      {/* Título y frase del cuadro activo: región fija, con crossfade al cambiar. */}
      <div aria-live="polite" className="min-h-[4.75rem] sm:min-h-[4rem]">
        <p
          key={`${step.id}-title`}
          className={cn('display text-foreground text-lg font-semibold sm:text-xl', animated && 'landing-num-in')}
        >
          {step.title}
        </p>
        <p key={`${step.id}-caption`} className={cn('text-muted-foreground mt-1 text-sm', animated && 'landing-num-in')}>
          {step.caption}
        </p>
      </div>
      {stepIndex === LAST_STEP ? (
        <p
          key={`cierre-${hasPlayed}`}
          className={cn('text-(--brand-ink) -mt-2 text-sm font-semibold', animated && 'landing-msg-in')}
        >
          Nadie del local escribió un solo mensaje.
        </p>
      ) : null}

      {/* El escenario: decorativo y aria-hidden a propósito — el título y la
          frase de arriba ya narran cada cuadro para quien usa lector de
          pantalla. Los cinco cuadros están siempre montados, superpuestos, y
          se ordenan solo con transform/opacity/filter según la distancia a
          `stepIndex`. */}
      <Panel elevated={false} aria-hidden className="bg-muted/25 relative isolate h-64 overflow-hidden sm:h-60 lg:h-64">
        {HERO_FLOW.map((flowStep, index) => {
          const pos = index === stepIndex ? 'active' : index < stepIndex ? 'past' : 'future'
          return (
            <div
              key={flowStep.id}
              className="hero-frame"
              data-pos={pos}
              style={{ willChange: pos === 'active' && phase === 'playing' ? 'transform, opacity' : undefined }}
            >
              {flowStep.id === 'pide' ? (
                <PideFrame scene={scene} animated={animated} />
              ) : flowStep.id === 'paga' ? (
                <PagaFrame scene={scene} animated={animated} active={pos === 'active'} />
              ) : flowStep.id === 'cocina' ? (
                <CocinaFrame scene={scene} animated={animated} active={pos === 'active'} />
              ) : flowStep.id === 'listo' ? (
                <ListoFrame scene={scene} animated={animated} />
              ) : (
                <RepartoFrame
                  scene={scene}
                  animated={animated}
                  routeRef={routeRef}
                  routeDoneRef={routeDoneRef}
                  motoRef={motoRef}
                />
              )}
            </div>
          )
        })}

        {/* El ticket: persiste sobre los cinco cuadros, en la misma esquina, y
            late (`hero-bump`) cada vez que cambia lo que dice: se lee como que
            "viaja" con el pedido. */}
        <div
          key={ticketLabel}
          className={cn(
            'border-border bg-card/95 absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 rounded-pill border px-2.5 py-1 shadow-raise',
            animated && 'hero-bump',
          )}
        >
          <span className="tabular text-foreground text-[11px] font-semibold">#{HERO_ORDER.shortCode}</span>
          <span className="text-muted-foreground text-[11px]">·</span>
          <span className="tabular text-foreground text-[11px] font-semibold">{ticketLabel}</span>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">{DEMO_SCENE_CAPTION}</p>
        {!reducedMotion ? (
          <button
            type="button"
            onClick={onControlClick}
            className="border-border text-foreground hover:bg-muted touch-manipulation inline-flex h-11 shrink-0 items-center gap-2 rounded-pill border px-4 text-sm font-semibold transition-colors duration-(--dur-fast)"
          >
            {controlIcon}
            {controlLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Piezas compartidas por los cuadros
   ------------------------------------------------------------------------- */

/**
 * El cursor. Vive anclado al control que va a tocar (`absolute` sobre la
 * esquina del botón) y ARRANCA desplazado con `transform` a la esquina
 * opuesta del escenario; llegar es volver a `translate(0,0)`. Así el recorrido
 * es largo y visible, y el punto de llegada es exacto sin medir nada.
 */
function Cursor({
  arrived,
  pressed,
  from,
  className,
}: {
  arrived: boolean
  pressed: boolean
  /** Desde dónde viene, en px relativos al punto de llegada. */
  from: { x: number; y: number }
  className?: string
}) {
  return (
    <span
      className={cn('hero-cursor text-foreground pointer-events-none absolute z-20', className)}
      data-pressed={pressed}
      style={{
        transform: arrived
          ? pressed
            ? 'translate3d(0, 0, 0) scale(0.82)'
            : 'translate3d(0, 0, 0)'
          : `translate3d(${from.x}px, ${from.y}px, 0)`,
      }}
    >
      <MousePointer2
        className="size-5 fill-card drop-shadow-[0_2px_3px_rgb(0_0_0_/_0.35)]"
        strokeWidth={2}
        aria-hidden
      />
    </span>
  )
}

/** La onda que se expande desde un control al tocarlo. Se remonta con `key` para repetirse. */
function Ripple({ count, animated }: { count: number; animated: boolean }) {
  if (count === 0 || !animated) return null
  return <span key={count} className="landing-blink pointer-events-none absolute inset-0" />
}

/** Tilde que se dibuja (stroke) en vez de aparecer. */
function DrawnCheck({ className, animated }: { className?: string; animated: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-4', className)} fill="none" aria-hidden>
      <path
        d="M5 12.5 10 17.5 19 7"
        stroke="currentColor"
        strokeWidth={2.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(animated && 'hero-check')}
      />
    </svg>
  )
}

/* -------------------------------------------------------------------------
   Los cinco cuadros
   ------------------------------------------------------------------------- */

/** "Pide": la fila de producto con su foto, tal como en la vitrina, y el cursor que cruza y toca el "+". */
function PideFrame({ scene, animated }: { scene: SceneState; animated: boolean }) {
  const item = HERO_ORDER.items[0]
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="bg-card border-border shadow-raise relative flex items-center gap-3 rounded-(--radius) border p-3">
        <div className="h-16 w-16 shrink-0 sm:h-[4.5rem] sm:w-[4.5rem]">
          <PhotoFrame ratio="square" className="rounded-xl">
            <Image src={DEMO_PRODUCT_PHOTO} alt="" fill sizes="72px" className="object-cover" />
          </PhotoFrame>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-semibold">{item.name}</p>
          <p className="text-muted-foreground truncate text-xs">{item.description}</p>
          <p className="tabular text-(--brand-ink) mt-1 text-sm font-semibold">
            {formatCentsCompact(item.unitCents, HERO_ORDER.currency)}
          </p>
        </div>
        <span className="relative shrink-0">
          <span
            className={cn(
              iconButtonClass('primary'),
              'transition-transform duration-(--dur-fast)',
              scene.cursor1Pressed && 'scale-90',
            )}
          >
            <Plus className="size-4" strokeWidth={2.5} aria-hidden />
          </span>
          <Ripple count={scene.ripple1} animated={animated} />
          <Cursor
            arrived={scene.cursor1Arrived}
            pressed={scene.cursor1Pressed}
            from={{ x: -230, y: 110 }}
            className="top-5 left-5"
          />
        </span>
      </div>
      <div
        className={cn(
          'hero-enter flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1',
          scene.orderLine ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        )}
      >
        <p className="text-foreground min-w-0 truncate text-xs">{itemsLine}</p>
        <p className="tabular text-muted-foreground text-xs whitespace-nowrap">
          {subtotalLabel} + envío {deliveryFeeLabel} = <span className="text-foreground font-semibold">{totalLabel}</span>
        </p>
      </div>
    </div>
  )
}

/** "Paga": una hoja de pago genérica (texto plano, sin logo ni colores de terceros) que sube desde abajo y el cursor cobra. */
function PagaFrame({ scene, animated, active }: { scene: SceneState; animated: boolean; active: boolean }) {
  return (
    <div
      className={cn(
        'hero-enter bg-card border-border shadow-lift w-full max-w-[19rem] rounded-t-(--radius) rounded-b-xl border p-4',
        active ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
      )}
      style={{ transitionDelay: active ? '160ms' : '0ms' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide">Mercado Pago</p>
        <span className="bg-muted h-1 w-8 rounded-pill" />
      </div>
      <p className="tabular text-foreground mt-2 text-2xl font-semibold">{totalLabel}</p>
      <div className="border-border text-muted-foreground mt-3 flex items-center justify-between border-t border-b py-2 text-xs">
        <span>Tarjeta</span>
        <span className="tabular">···· 4242</span>
      </div>
      <div className="relative mt-3 flex min-h-11 items-center justify-between gap-3">
        <span
          className={cn(
            'hero-enter text-(--brand-ink) min-w-0 flex-1 text-[11px] font-medium',
            scene.accountLine ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0',
          )}
        >
          → a la cuenta de Mercado Pago del local
        </span>
        <span className="relative shrink-0">
          {scene.paid ? (
            <StatusPill
              tone="live"
              dot={false}
              className={cn('h-10 gap-1.5 px-4 text-sm whitespace-nowrap', animated && 'landing-msg-in')}
            >
              <DrawnCheck animated={animated} className="size-3.5" />
              Pagado {HERO_ORDER.paidAt}
            </StatusPill>
          ) : (
            <span
              className={cn(
                'bg-primary text-primary-foreground inline-flex h-10 items-center rounded-pill px-5 text-sm font-semibold transition-transform duration-(--dur-fast)',
                scene.cursor2Pressed && 'scale-95',
              )}
            >
              Pagar
            </span>
          )}
          <Ripple count={scene.ripple2} animated={animated} />
          <Cursor
            arrived={scene.cursor2Arrived}
            pressed={scene.cursor2Pressed}
            from={{ x: -140, y: -120 }}
            className="top-5 left-8"
          />
        </span>
      </div>
    </div>
  )
}

/** "Cocina": la tarjeta del panel entra al tablero, el mostrador la toma, y la sartén cocina al lado. */
function CocinaFrame({ scene, animated, active }: { scene: SceneState; animated: boolean; active: boolean }) {
  return (
    <div className="flex w-full items-center gap-4 sm:gap-5">
      <FryingPan cooking={scene.cooking && active} />
      <div
        className={cn(
          'hero-enter bg-card border-border shadow-raise min-w-0 flex-1 rounded-(--radius) border p-3',
          active ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0',
        )}
        style={{ transitionDelay: active ? '200ms' : '0ms' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="tabular text-foreground text-sm font-semibold">#{HERO_ORDER.shortCode}</span>
          <span className="tabular text-muted-foreground text-xs">
            {scene.cooking ? HERO_ORDER.timeline.preparing : HERO_ORDER.timeline.confirmed}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">{itemsLine}</p>
        <div className="relative mt-2.5 flex items-center justify-between gap-2">
          <StatusPill tone={scene.cooking ? 'live' : 'neutral'} dot>
            {scene.cooking ? 'En preparación' : 'Confirmado · pagado'}
          </StatusPill>
          {!scene.cooking ? (
            <span className="relative">
              <span
                className={cn(
                  'bg-foreground text-background inline-flex h-8 items-center rounded-pill px-3 text-xs font-semibold transition-transform duration-(--dur-fast)',
                  scene.kitchenPressed && 'scale-95',
                )}
              >
                Empezar a cocinar
              </span>
              <Ripple count={scene.kitchenRipple} animated={animated} />
            </span>
          ) : (
            <span className={cn('text-muted-foreground text-xs', animated && 'landing-msg-in')}>Cocinando</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** La sartén: SVG propio trazado a 2px, con el medallón que se da vuelta y el vapor que sube. */
function FryingPan({ cooking }: { cooking: boolean }) {
  return (
    <svg
      viewBox="0 0 120 120"
      data-cooking={cooking}
      className="text-foreground h-24 w-24 shrink-0 sm:h-28 sm:w-28"
      fill="none"
      aria-hidden
    >
      {/* Vapor: tres hilos con desfase. */}
      <g className="text-muted-foreground" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path className="hero-steam" d="M56 30 c -3 -5, 3 -8, 0 -14" style={{ animationDelay: '0s' }} />
        <path className="hero-steam" d="M68 32 c -3 -5, 3 -8, 0 -14" style={{ animationDelay: '0.45s' }} />
        <path className="hero-steam" d="M80 30 c -3 -5, 3 -8, 0 -14" style={{ animationDelay: '0.9s' }} />
      </g>
      {/* Mango. */}
      <path d="M6 70 H 30" stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
      <path d="M8 70 H 18" stroke="var(--background)" strokeWidth={2} strokeLinecap="round" />
      {/* Cuerpo: borde y fondo. */}
      <circle cx="68" cy="70" r="36" fill="var(--card)" stroke="currentColor" strokeWidth={2.5} />
      <circle cx="68" cy="70" r="29" stroke="currentColor" strokeWidth={1.25} opacity={0.45} />
      {/* Medallón: se da vuelta y cae. */}
      <g className="hero-patty">
        <ellipse cx="68" cy="70" rx="18" ry="11" fill="color-mix(in oklch, var(--foreground) 78%, var(--primary))" />
        <ellipse cx="68" cy="66" rx="18" ry="11" fill="color-mix(in oklch, var(--foreground) 62%, var(--primary))" />
        <path d="M56 64 Q 68 60 80 64" stroke="var(--primary)" strokeWidth={2} strokeLinecap="round" opacity={0.9} />
      </g>
    </svg>
  )
}

/** "Listo": la tarjeta pasa a Listo y el aviso baja al celular del cliente. */
function ListoFrame({ scene, animated }: { scene: SceneState; animated: boolean }) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div
        className={cn(
          'hero-enter bg-card border-border shadow-raise mx-auto w-full max-w-[19rem] rounded-2xl border px-3.5 py-3',
          scene.notified ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="bg-primary/12 text-(--brand-ink) flex size-8 shrink-0 items-center justify-center rounded-full">
            <Bell className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-foreground text-xs font-semibold">{HERO_ORDER.storeName}</p>
            <p className="text-muted-foreground text-xs">
              Tu pedido #{HERO_ORDER.shortCode} está listo · sale a repartir
            </p>
          </div>
          <span className="tabular text-muted-foreground ml-auto shrink-0 text-[11px]">{HERO_ORDER.timeline.ready}</span>
        </div>
      </div>
      <div className="bg-card border-border mx-auto flex w-full max-w-[19rem] items-center justify-between gap-2 rounded-(--radius) border p-3">
        <span className="tabular text-foreground text-sm font-semibold">#{HERO_ORDER.shortCode}</span>
        <StatusPill tone="live" dot={false} className={cn('gap-1.5', animated && 'landing-msg-in')}>
          <DrawnCheck animated={animated} className="size-3.5" />
          Listo {HERO_ORDER.timeline.ready}
        </StatusPill>
      </div>
    </div>
  )
}

/** "Reparto": la ruta esquemática, la moto que la recorre movida por el reloj, y el pin que cae al llegar. */
function RepartoFrame({
  scene,
  animated,
  routeRef,
  routeDoneRef,
  motoRef,
}: {
  scene: SceneState
  animated: boolean
  routeRef: React.RefObject<SVGPathElement | null>
  routeDoneRef: React.RefObject<SVGPathElement | null>
  motoRef: React.RefObject<SVGGElement | null>
}) {
  return (
    <div className="flex w-full flex-col items-center gap-1">
      {/* La ruta escala con el ancho del escenario (viewBox); la moto vive
          ADENTRO del mismo SVG, así que comparte coordenadas sin importar el
          tamaño renderizado. */}
      <svg viewBox="0 0 320 120" className="h-auto w-full max-w-[22rem]" fill="none" aria-hidden>
        {/* Ruta completa, tenue, y encima la parte recorrida en verde. `pathLength=1`
            normaliza el trazo para que el dashoffset vaya de 1 (nada) a 0 (todo)
            sin medir el path en el servidor. */}
        <path d={ROUTE_PATH} className="stroke-border" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="4 6" />
        <path
          ref={routeDoneRef}
          d={ROUTE_PATH}
          className="stroke-primary"
          strokeWidth={3}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          style={{ strokeDashoffset: scene.motoArrived ? 0 : 1 }}
        />
        <path ref={routeRef} d={ROUTE_PATH} stroke="none" />

        {/* El local, al inicio de la ruta. */}
        <g transform={`translate(${ROUTE_START.x} ${ROUTE_START.y})`}>
          <circle r="14" fill="var(--card)" className="stroke-border" strokeWidth={1.5} />
          <Store x={-8} y={-8} width={16} height={16} className="text-foreground" strokeWidth={2} aria-hidden />
          <text y="-22" textAnchor="middle" fontSize="10" fontWeight={600} className="fill-muted-foreground">
            Local
          </text>
        </g>

        {/* El destino: el pin cae y hace una onda cuando la moto llega. */}
        {/* El pin vive ARRIBA del punto de llegada, así la moto no lo tapa al frenar. */}
        <g transform={`translate(${ROUTE_END.x} ${ROUTE_END.y - 20})`}>
          {scene.motoArrived && animated ? (
            <circle key="ping" cy="-14" r="12" className="hero-ping stroke-primary" strokeWidth={2} />
          ) : null}
          <g className={cn(scene.motoArrived && animated && 'hero-pin-drop')}>
            <MapPin
              x={-14}
              y={-30}
              width={28}
              height={28}
              className={cn(scene.motoArrived ? 'text-(--brand-ink)' : 'text-muted-foreground')}
              strokeWidth={2}
              fill={scene.motoArrived ? 'color-mix(in oklch, var(--primary) 22%, transparent)' : 'none'}
              aria-hidden
            />
          </g>
        </g>

        {/* La moto: `transform` lo escribe el reloj de la escena (placeMoto). El
            valor inicial es el final, para el HTML servido. */}
        <g ref={motoRef} transform={`translate(${ROUTE_END.x} ${ROUTE_END.y})`}>
          <circle r="13" fill="var(--card)" className="stroke-border" strokeWidth={1.5} />
          <Motorbike x={-10} y={-10} width={20} height={20} className="text-foreground" strokeWidth={2} aria-hidden />
        </g>
      </svg>
      <div className="flex w-full max-w-[22rem] items-center justify-between gap-3 px-1">
        <p className="text-muted-foreground truncate text-xs">{HERO_ORDER.addressLine}</p>
        <p className="tabular text-foreground shrink-0 text-xs font-medium">
          {scene.delivered ? `Llegó ${HERO_ORDER.timeline.delivered}` : `Salió ${HERO_ORDER.timeline.on_the_way}`}
        </p>
      </div>
    </div>
  )
}
