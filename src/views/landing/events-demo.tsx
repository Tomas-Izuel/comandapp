'use client'

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { DEMO_EVENTS, DEMO_SCENE_CAPTION } from '@/lib/landing'
import { cn } from '@/lib/utils'

/**
 * Cadencia entre eventos de la escena. Tiene que coincidir con `--dur-beat`
 * de `globals.css`. No se lee la custom property en runtime (una lectura de
 * `getComputedStyle` de más, para un número que no cambia) — se duplica a
 * propósito, mismo criterio que otras constantes triplicadas en este repo
 * (`humanizeRetryAfter`, `ALLOWED_TRANSITIONS`).
 */
const BEAT_MS = 700
const TOTAL = DEMO_EVENTS.length

/**
 * `matchMedia` es estado de un sistema externo (el navegador), no del
 * componente: `useSyncExternalStore` es la forma que React recomienda para
 * suscribirse a algo así, en vez de un `useState` + `setState` adentro de un
 * efecto (que además dispara la regla `react-hooks/set-state-in-effect`). El
 * snapshot del servidor es `false` porque ahí no existe `window` — coincide
 * con el default que ya necesitábamos para que el HTML servido muestre el
 * log completo.
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

/**
 * "El pedido sale por eventos hacia tu sistema": el log del outbox del
 * pedido #A2A1 apareciendo fila por fila, una sola vez, al entrar en
 * pantalla.
 *
 * Estrategia sin JS: el estado inicial de React ya muestra las CINCO filas y
 * los CINCO tildes (`revealedRows`/`revealedChecks` arrancan en `TOTAL`), así
 * que quien no corre JS ve el log completo servido por el servidor — nada
 * queda oculto esperando un script que no va a llegar. El log se "vacía" recién
 * dentro de `play()`, que SOLO se llama desde el callback del
 * `IntersectionObserver` (cuando la sección entra en pantalla) o desde el
 * botón "Ver de nuevo" — nunca desde el cuerpo de un efecto. Eso es a
 * propósito, no solo estilo: `react-hooks/set-state-in-effect` (la regla
 * nueva del plugin) marca como error un `setState` síncrono adentro de un
 * efecto que solo deriva estado de otro estado — el patrón correcto es
 * moverlo a un callback real (evento del DOM, timer, observer), que es
 * justamente `play()`. Con `reducedMotion` en `true`, la guarda del efecto de
 * abajo nunca deja que `play()` se llame, así que el log queda completo para
 * siempre y no hace falta una rama aparte para "reduced motion".
 */
export function EventsDemo() {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  )
  const [revealedRows, setRevealedRows] = useState(TOTAL)
  const [revealedChecks, setRevealedChecks] = useState(TOTAL)
  const [hasPlayed, setHasPlayed] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef(0)
  const captionId = useId()

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const advance = useCallback(() => {
    const tick = tickRef.current
    setRevealedRows(Math.min(TOTAL, tick + 1))
    if (tick > 0) setRevealedChecks(Math.min(TOTAL, tick))
    tickRef.current += 1
    if (tickRef.current > TOTAL) stopTimer()
  }, [stopTimer])

  const play = useCallback(() => {
    stopTimer()
    tickRef.current = 0
    setRevealedRows(0)
    setRevealedChecks(0)
    setHasPlayed(true)
    advance()
    timerRef.current = setInterval(advance, BEAT_MS)
  }, [advance, stopTimer])

  // Dispara la escena una sola vez, al entrar en pantalla.
  useEffect(() => {
    if (reducedMotion || hasPlayed) return
    const node = rootRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          play()
          observer.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [reducedMotion, hasPlayed, play])

  // Nadie mira una escena que se reproduce en una pestaña en segundo plano, y
  // retomarla con los timers vencidos larga todas las filas de golpe.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        stopTimer()
      } else if (timerRef.current === null && hasPlayed && tickRef.current > 0 && tickRef.current <= TOTAL) {
        timerRef.current = setInterval(advance, BEAT_MS)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stopTimer()
    }
  }, [stopTimer, advance, hasPlayed])

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <h3 className="display text-lg font-semibold">El pedido sale por eventos hacia tu sistema</h3>
      <p className="text-muted-foreground text-sm">
        Cada cambio de estado queda anotado y se entrega al software de gestión que el local ya usa, sea cual sea: no
        hay que migrar de sistema ni cargar nada dos veces.
      </p>
      <p id={captionId} className="text-muted-foreground text-xs italic">
        {DEMO_SCENE_CAPTION}
      </p>

      <ol
        aria-describedby={captionId}
        aria-label="Eventos del pedido #A2A1 entregados al sistema del local"
        className="border-border divide-border flex flex-col divide-y rounded-(--radius) border"
      >
        {DEMO_EVENTS.map((event, index) => {
          const rowVisible = index < revealedRows
          const checkVisible = index < revealedChecks
          return (
            <li
              key={event.event}
              className={cn(
                'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm',
                !rowVisible && 'invisible',
                rowVisible && hasPlayed && !reducedMotion && 'landing-row-in',
              )}
            >
              <div className="flex min-w-0 flex-1 items-baseline gap-3">
                <span className="tabular text-muted-foreground shrink-0 text-xs">{event.at}</span>
                <span className="font-mono text-foreground shrink-0 text-xs">{event.event}</span>
                <span className="text-muted-foreground truncate">{event.detail}</span>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 items-center justify-center rounded-full border transition-colors duration-(--dur-fast)',
                    checkVisible ? 'border-(--brand-ink) bg-(--brand-ink)' : 'border-border',
                  )}
                >
                  {checkVisible ? <Check className="text-background size-2.5" strokeWidth={3} /> : null}
                </span>
                <span className={checkVisible ? 'text-(--brand-ink)' : 'text-muted-foreground'}>→ tu sistema</span>
              </span>
            </li>
          )
        })}
      </ol>

      {!reducedMotion ? (
        <button
          type="button"
          onClick={play}
          className="border-border bg-card text-foreground hover:bg-muted inline-flex h-11 w-fit items-center gap-2 self-start rounded-pill border px-4 text-sm font-medium transition-colors duration-(--dur-fast)"
        >
          <RotateCcw className="size-4" aria-hidden />
          Ver de nuevo
        </button>
      ) : null}
    </div>
  )
}
