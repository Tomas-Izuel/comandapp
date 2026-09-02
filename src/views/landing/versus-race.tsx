'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Paperclip, Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCentsCompact } from '@/lib/money'
import { Panel, StatusPill } from '@/views/shared/surfaces'
import { OrderSteps } from '@/views/shared/order-status'
import type { OrderStatus } from '@/models/schemas/order.schema'
import { DEMO_ORDER, DEMO_SCENE_CAPTION, DEMO_THREAD, type DemoMessage } from '@/lib/landing'

/**
 * "La carrera": el mismo pedido corriendo por los dos caminos a la vez, con
 * UN solo reloj de escena manejando las dos horas visibles (ver
 * `00-architecture.md` § Sincronía). Todo lo que esta isla dramatiza está
 * en `DEMO_THREAD` y `DEMO_ORDER.timeline` — nada se inventa acá.
 *
 * La única aritmética propia es la COMPRESIÓN de tiempo: 38 minutos de guion
 * (21:20 → 21:58, el rango real del hilo) se estiran a `SCENE_MS` de reloj de
 * pared. Cada evento (mensaje o cambio de estado) dispara cuando el reloj de
 * escena cruza SU hora real, así que el carril de ComandApp —que termina a
 * las 21:41— se queda quieto mientras el de WhatsApp sigue corriendo hasta
 * las 21:58: la misma proporción que en la vida real, nada hardcodeado por
 * carril.
 */

/** Duración total de la escena. ~8s: comprime 38 minutos de guion en algo que se mira de un tirón. */
const SCENE_MS = 8000

type RaceOrderStatus = Extract<OrderStatus, 'confirmed' | 'preparing' | 'ready'>

/** `idle`: todavía no entró en pantalla. Autoplay > 5s necesita poder pausarse — de ahí `paused`. */
type ScenePhase = 'idle' | 'playing' | 'paused' | 'done'

function parseMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

const SCRIPT_START_MIN = parseMinutes(DEMO_THREAD[0].at)
const SCRIPT_END_MIN = parseMinutes(DEMO_THREAD[DEMO_THREAD.length - 1].at)
const SCRIPT_SPAN_MIN = SCRIPT_END_MIN - SCRIPT_START_MIN
const READY_MIN = parseMinutes(DEMO_ORDER.timeline.ready)

/** Minutos de guion → ms de escena. Lineal: es lo que hace que un solo reloj sirva para los dos carriles. */
function sceneMsFor(hhmm: string): number {
  return ((parseMinutes(hhmm) - SCRIPT_START_MIN) / SCRIPT_SPAN_MIN) * SCENE_MS
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.floor(totalMinutes % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

type Beat =
  | { readonly ms: number; readonly kind: 'typing' }
  | { readonly ms: number; readonly kind: 'message'; readonly index: number }
  | { readonly ms: number; readonly kind: 'status'; readonly status: RaceOrderStatus }

/**
 * El guion completo, ordenado por hora de disparo. `beatMs` es la cadencia
 * `--dur-beat` del sistema (se lee del DOM al montar; 700 es el respaldo si
 * por lo que sea la variable no está): el indicador de "escribiendo" del
 * local dura exactamente un beat antes de que su mensaje aparezca.
 */
function buildBeats(beatMs: number): Beat[] {
  const beats: Beat[] = []

  DEMO_THREAD.forEach((message, index) => {
    const ms = sceneMsFor(message.at)
    if (message.from === 'local') {
      beats.push({ ms: Math.max(0, ms - beatMs), kind: 'typing' })
    }
    beats.push({ ms, kind: 'message', index })
  })

  beats.push({ ms: sceneMsFor(DEMO_ORDER.timeline.preparing), kind: 'status', status: 'preparing' })
  beats.push({ ms: sceneMsFor(DEMO_ORDER.timeline.ready), kind: 'status', status: 'ready' })

  return beats.sort((a, b) => a.ms - b.ms)
}

const INITIAL_TIMESTAMPS: Partial<Record<RaceOrderStatus, string>> = { confirmed: DEMO_ORDER.timeline.confirmed }
const FINAL_TIMESTAMPS: Partial<Record<RaceOrderStatus, string>> = {
  confirmed: DEMO_ORDER.timeline.confirmed,
  preparing: DEMO_ORDER.timeline.preparing,
  ready: DEMO_ORDER.timeline.ready,
}

/**
 * `matchMedia` es estado de un sistema externo (el navegador), no del
 * componente: `useSyncExternalStore` es la forma que React recomienda para
 * suscribirse a esto, en vez de un `useState` + `setState` síncrono adentro
 * de un efecto (dispara `react-hooks/set-state-in-effect`, y además deja una
 * ventana real: el efecto que arma el `IntersectionObserver` de abajo podía
 * correr en el MISMO commit con el valor de clausura `reducedMotion=false`
 * viejo, antes de que el re-render con el valor correcto lo desmontara).
 * Con `useSyncExternalStore` el valor real ya está disponible en el primer
 * render del cliente, así que ese efecto nunca ve un valor stale. Mismo
 * patrón que `hero-flow.tsx` y `events-demo.tsx`. El snapshot del servidor es
 * `false`: ahí no existe `window`, y coincide con el default que ya hacía
 * falta para el HTML servido.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function getReducedMotionServerSnapshot() {
  return false
}

function TypingBeats() {
  return (
    <span className="landing-typing inline-flex items-center gap-1" role="presentation">
      <span className="bg-muted-foreground/70 size-1.5 rounded-full" />
      <span className="bg-muted-foreground/70 size-1.5 rounded-full" />
      <span className="bg-muted-foreground/70 size-1.5 rounded-full" />
    </span>
  )
}

function ChatBubble({
  message,
  animated,
}: {
  message: DemoMessage
  /** Falso con reduced motion: la burbuja ya está en su estado final, sin entrada. */
  animated: boolean
}) {
  const isLocal = message.from === 'local'
  return (
    <div className={cn('flex flex-col gap-1', isLocal ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm',
          isLocal ? 'bg-primary/12 text-foreground' : 'bg-card border-border border text-foreground',
          animated && 'landing-msg-in',
        )}
      >
        {message.attachment ? (
          <span className="flex items-center gap-1.5">
            <Paperclip className="size-3.5 shrink-0" aria-hidden />
            {message.text}
          </span>
        ) : (
          message.text
        )}
      </div>
      <span className="tabular text-muted-foreground px-1 text-[0.6875rem]">{message.at}</span>
    </div>
  )
}

export function VersusRace() {
  const sectionRef = useRef<HTMLDivElement>(null)

  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  )

  // Todo arranca en su valor FINAL — el pedido entregado, los dos relojes en
  // la hora de "listo" — igual que `hero-flow.tsx`/`events-demo.tsx`: es lo
  // que garantiza que el HTML servido, y el primer paint de un cliente con
  // `prefers-reduced-motion` (que por eso nunca llama a `play()`, ver el
  // guard del efecto de abajo), muestren la carrera COMPLETA en vez de un
  // tablero a medio armar. `play()` es quien la vacía con `resetToStart()`
  // para animarla desde el principio, nunca al revés.
  const [messages, setMessages] = useState<DemoMessage[]>(() => [...DEMO_THREAD])
  const [typing, setTyping] = useState(false)
  const [orderStatus, setOrderStatus] = useState<RaceOrderStatus>('ready')
  const [orderTimestamps, setOrderTimestamps] =
    useState<Partial<Record<RaceOrderStatus, string>>>(FINAL_TIMESTAMPS)
  const [leftClock, setLeftClock] = useState(DEMO_THREAD[DEMO_THREAD.length - 1].at)
  const [rightClock, setRightClock] = useState(DEMO_ORDER.timeline.ready)
  const [phase, setPhase] = useState<ScenePhase>('idle')
  // Arranca en `false` a propósito: distingue "los mensajes ya vienen en el
  // HTML servido, en su estado final" (sin `landing-msg-in`, para no repetir
  // el hallazgo 1 de esta misma ronda: una clase de entrada nunca en el HTML
  // servido) de "los mensajes están apareciendo porque `play()` corrió". Solo
  // `play()` la sube — igual que `hero-flow.tsx`.
  const [hasPlayed, setHasPlayed] = useState(false)

  const phaseRef = useRef<ScenePhase>('idle')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const beatsRef = useRef<Beat[]>([])
  const beatMsRef = useRef(700)
  const nextBeatIndexRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const runningSinceRef = useRef<number | null>(null)
  const elapsedAtPauseRef = useRef(0)
  const tickRef = useRef<((now: number) => void) | null>(null)

  const applyBeat = useCallback((beat: Beat) => {
    if (beat.kind === 'typing') {
      setTyping(true)
      return
    }
    if (beat.kind === 'message') {
      setTyping(false)
      setMessages((prev) => [...prev, DEMO_THREAD[beat.index]])
      return
    }
    setOrderStatus(beat.status)
    setOrderTimestamps((prev) => ({ ...prev, [beat.status]: DEMO_ORDER.timeline[beat.status] }))
  }, [])

  const showFinalState = useCallback(() => {
    setMessages([...DEMO_THREAD])
    setTyping(false)
    setOrderStatus('ready')
    setOrderTimestamps(FINAL_TIMESTAMPS)
    setLeftClock(DEMO_THREAD[DEMO_THREAD.length - 1].at)
    setRightClock(DEMO_ORDER.timeline.ready)
    setPhase('done')
  }, [])

  const resetToStart = useCallback(() => {
    setMessages([])
    setTyping(false)
    setOrderStatus('confirmed')
    setOrderTimestamps(INITIAL_TIMESTAMPS)
    setLeftClock(DEMO_THREAD[0].at)
    setRightClock(DEMO_THREAD[0].at)
  }, [])

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const play = useCallback(() => {
    stopAnimation()
    resetToStart()
    setHasPlayed(true)
    nextBeatIndexRef.current = 0
    elapsedAtPauseRef.current = 0
    runningSinceRef.current = null
    setPhase('playing')

    const tick = (now: number) => {
      if (runningSinceRef.current === null) runningSinceRef.current = now
      const elapsed = now - runningSinceRef.current + elapsedAtPauseRef.current

      while (
        nextBeatIndexRef.current < beatsRef.current.length &&
        beatsRef.current[nextBeatIndexRef.current].ms <= elapsed
      ) {
        applyBeat(beatsRef.current[nextBeatIndexRef.current])
        nextBeatIndexRef.current += 1
      }

      if (elapsed >= SCENE_MS) {
        showFinalState()
        return
      }

      const leftMinutes = SCRIPT_START_MIN + (elapsed / SCENE_MS) * SCRIPT_SPAN_MIN
      setLeftClock(formatMinutes(leftMinutes))
      setRightClock(formatMinutes(Math.min(leftMinutes, READY_MIN)))

      rafRef.current = requestAnimationFrame(tick)
    }

    tickRef.current = tick
    rafRef.current = requestAnimationFrame(tick)
  }, [applyBeat, resetToStart, showFinalState, stopAnimation])

  /**
   * Pausar/reanudar comparten el mismo mecanismo de acumulación de tiempo que
   * usa el corte por pestaña oculta más abajo: al pausar se suma lo corrido a
   * `elapsedAtPauseRef` y se corta el reloj de arranque; al reanudar se pide
   * un nuevo frame con el `tick` ya armado, que retoma justo donde quedó.
   *
   * Esto no es un lujo: un autoplay de ~8s sin forma de detenerlo a mitad de
   * camino es exactamente lo que las pautas de accesibilidad piden evitar.
   */
  const pause = useCallback(() => {
    if (phaseRef.current !== 'playing') return
    stopAnimation()
    if (runningSinceRef.current !== null) {
      elapsedAtPauseRef.current += performance.now() - runningSinceRef.current
      runningSinceRef.current = null
    }
    setPhase('paused')
  }, [stopAnimation])

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused' || !tickRef.current) return
    setPhase('playing')
    rafRef.current = requestAnimationFrame(tickRef.current)
  }, [])

  // El guion se arma una sola vez, con la cadencia real de `--dur-beat` (el
  // token vive en `[data-comandapp]`; 700 es el respaldo si el CSS todavía no
  // aplicó cuando corre este efecto).
  useEffect(() => {
    const raw = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dur-beat'), 10)
    beatMsRef.current = Number.isFinite(raw) && raw > 0 ? raw : 700
    beatsRef.current = buildBeats(beatMsRef.current)
  }, [])

  // Arranca una sola vez al entrar en pantalla. Con reduced motion el guard
  // de abajo corta antes de armar el observer: como el estado ya nace en su
  // valor final (ver arriba), no hace falta ningún efecto aparte que "fuerce"
  // el estado terminado — no hay nada que forzar.
  useEffect(() => {
    if (reducedMotion) return
    const node = sectionRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          play()
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [play, reducedMotion])

  // Pausa mientras la pestaña está oculta; retoma exactamente donde quedó.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        pause()
      } else if (phaseRef.current === 'paused' && tickRef.current) {
        setPhase('playing')
        rafRef.current = requestAnimationFrame(tickRef.current)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [pause])

  useEffect(() => stopAnimation, [stopAnimation])

  const messageCount = messages.length
  const animated = hasPlayed && !reducedMotion

  return (
    <div ref={sectionRef} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-start">
        {/* Carril izquierdo: hoy, por WhatsApp. */}
        <Panel className="flex flex-col p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="display text-foreground text-base font-semibold sm:text-lg">Hoy, por WhatsApp</h3>
            <span className="tabular text-muted-foreground text-sm">{leftClock}</span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs" aria-live="polite">
            {messageCount} {messageCount === 1 ? 'mensaje' : 'mensajes'} · nadie cocinó todavía
          </p>

          <div className="bg-muted mt-3 flex min-h-[27rem] flex-col justify-end gap-2 rounded-2xl p-3 sm:min-h-[24rem] sm:p-4">
            <div className="flex flex-col gap-2">
              {messages.map((message) => (
                <ChatBubble key={message.at} message={message} animated={animated} />
              ))}
              {typing ? (
                <div className="flex justify-end">
                  <div className="bg-primary/12 flex items-center rounded-2xl px-3.5 py-2.5">
                    <TypingBeats />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>

        {/* Carril derecho: el mismo pedido, con ComandApp. */}
        <Panel className="flex flex-col p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="display text-foreground text-base font-semibold sm:text-lg">Con ComandApp</h3>
            <span className="tabular text-muted-foreground text-sm">{rightClock}</span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">0 mensajes</p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-foreground text-sm font-medium">
              <span className="tabular">#{DEMO_ORDER.shortCode}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="tabular">{formatCentsCompact(DEMO_ORDER.totalCents, DEMO_ORDER.currency)}</span>
            </p>
            <StatusPill tone="live" dot>
              Pagado {DEMO_ORDER.paidAt}
            </StatusPill>
          </div>

          {/*
           * Sin `min-h` acá: a diferencia del chat, `OrderSteps` nunca agrega
           * ni saca filas —son siempre los mismos cuatro pasos cambiando de
           * estado—, así que no hay salto de layout que prevenir y forzar una
           * altura mínima solo dejaba aire de sobra debajo de "Entregado".
           */}
          <div className="pt-5">
            <OrderSteps status={orderStatus} deliveryMethod={DEMO_ORDER.deliveryMethod} timestamps={orderTimestamps} />
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">{DEMO_SCENE_CAPTION}</p>
        {!reducedMotion ? (
          <button
            type="button"
            onClick={phase === 'playing' ? pause : phase === 'paused' ? resume : play}
            className="border-border text-foreground hover:bg-muted inline-flex h-11 shrink-0 items-center gap-2 rounded-pill border px-4 text-sm font-semibold transition-colors duration-(--dur-fast)"
          >
            {phase === 'playing' ? (
              <Pause className="size-4 shrink-0" aria-hidden />
            ) : phase === 'paused' ? (
              <Play className="size-4 shrink-0" aria-hidden />
            ) : (
              <RotateCcw className="size-4 shrink-0" aria-hidden />
            )}
            {phase === 'playing' ? 'Pausar' : phase === 'paused' ? 'Seguir' : 'Ver de nuevo'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
