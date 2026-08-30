import { forwardRef } from 'react'

/**
 * La pista horizontal del horario semanal (reposo de `ScheduleEditor`).
 *
 * Reemplaza siete tarjetas apiladas (~140px cada una) por siete filas de
 * ~52-60px: el horario se lee como forma, no como siete líneas de texto que
 * hay que leer una por una. Ver el brief de superficie
 * (`.impeccable/surfaces/src-views-admin-ajustes-schedule-editor-tsx.md`)
 * para las tres objeciones que la dirección tuvo que resolver.
 *
 * Vive en su propio archivo porque el cálculo del eje + el layout responsive
 * de la fila ya es suficiente lógica como para no mezclarla con la
 * orquestación de `schedule-editor.tsx` (que sigue dueña del estado y de la
 * edición). Nada de acá toca Supabase ni conoce `StoreHoursData`: recibe
 * minutos ya parseados.
 */

export type Axis = { start: number; end: number }

/** Debajo de esto un local de un solo turno dibujaría una barra que ocupa toda la pista. */
const MIN_AXIS_SPAN_HOURS = 8

/**
 * El eje se deriva de los datos: de la apertura más temprana al cierre más
 * tardío de TODA la semana (no por día — es un solo eje compartido por las
 * siete pistas), redondeado a horas enteras. `null` cuando no hay ni un rango
 * cargado: ese es el borde que resuelve el aviso de "siempre abierta" en vez
 * de un eje 00:00–24:00 clavado.
 *
 * El "cierre" de un rango que cruza la medianoche ya viene expresado como
 * minutos > 1440 en `durationMinutes` (ver `draftRangeToDuration`), así que
 * `opensAtMinute + durationMinutes` cae naturalmente después de la marca de
 * 24h sin ningún caso especial acá — es lo que hace que el viernes 19:00–02:00
 * empuje el eje hasta 26 (02:00 del día siguiente) solo.
 */
export function computeWeekAxis(
  ranges: { opensAtMinute: number; durationMinutes: number }[],
): Axis | null {
  if (ranges.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const range of ranges) {
    const startHour = range.opensAtMinute / 60
    const endHour = startHour + range.durationMinutes / 60
    if (startHour < min) min = startHour
    if (endHour > max) max = endHour
  }
  const start = Math.floor(min)
  const end = Math.max(Math.ceil(max), start + MIN_AXIS_SPAN_HOURS)
  return { start, end }
}

/** Hora del eje (puede superar 24) devuelta como reloj de pared, ej. 26 → "02:00". */
export function formatAxisHour(hour: number): string {
  const normalized = ((Math.round(hour * 60) % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * Fila en reposo de un día: etiqueta + pista dibujada + horas en texto plano.
 * Es un `<button>`, no una tarjeta con un botón adentro — toda la fila abre
 * la edición de ESE día.
 *
 * Mobile-first vía `@container` (el mismo patrón que `product-card.tsx` y
 * `branding-form.tsx`): el corte es por el ANCHO DE LA FILA, no por el
 * viewport, así que se apila igual adentro de un panel angosto aunque la
 * ventana sea grande. Bajo `@min-[26rem]` (416px) pasa a una sola línea:
 * etiqueta ~90px + pista flexible + horas a la derecha — los ~640px de
 * contenido del formulario de admin alcanzan sobrados para eso.
 *
 * Reenvía el `ref` al `<button>` real: `WeekEditor` lo necesita para devolver
 * el foco acá cuando el panel del día se cierra (03-review.md, hallazgo #2 —
 * sin esto el foco queda huérfano en `<body>` al tocar "Listo" con teclado).
 */
export const DayBar = forwardRef<
  HTMLButtonElement,
  {
    label: string
    summary: string
    ranges: { opensAtMinute: number; durationMinutes: number }[]
    axis: Axis | null
    onOpen: () => void
  }
>(function DayBar({ label, summary, ranges, axis, onOpen }, ref) {
  // El marcador de medianoche solo tiene sentido si el eje efectivamente la
  // cruza (24 cae estrictamente adentro). Si el local nunca pasa la
  // medianoche, el eje nunca supera 24 y el marcador no se dibuja solo.
  const showsMidnight = axis !== null && axis.start < 24 && axis.end > 24
  const midnightLeft = showsMidnight ? ((24 - axis.start) / (axis.end - axis.start)) * 100 : null

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`${label}, ${summary}`}
      className="border-border bg-card hover:bg-muted focus-visible:ring-ring @container flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none @min-[26rem]:flex-nowrap"
    >
      <span className="w-full shrink-0 text-sm font-semibold @min-[26rem]:w-[5.5rem]">{label}</span>
      <span className="tabular order-2 ml-auto text-sm text-muted-foreground @min-[26rem]:order-3 @min-[26rem]:ml-0 @min-[26rem]:w-auto @min-[26rem]:shrink-0 @min-[26rem]:text-right">
        {summary}
      </span>
      {/* Decorativa: el dato accesible es el texto de arriba, no este rectángulo. */}
      <div
        aria-hidden
        className="bg-muted relative order-3 h-6 w-full shrink-0 basis-full overflow-hidden rounded-pill @min-[26rem]:order-2 @min-[26rem]:h-5 @min-[26rem]:w-auto @min-[26rem]:basis-auto @min-[26rem]:flex-1"
      >
        {axis
          ? ranges.map((range, index) => {
              const startHour = range.opensAtMinute / 60
              const endHour = startHour + range.durationMinutes / 60
              const span = axis.end - axis.start
              const left = ((startHour - axis.start) / span) * 100
              const width = ((endHour - startHour) / span) * 100
              return (
                <div
                  key={index}
                  className="bg-primary absolute inset-y-0 rounded-pill"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              )
            })
          : null}
        {midnightLeft !== null ? (
          <div className="bg-border absolute inset-y-0 w-px" style={{ left: `${midnightLeft}%` }} />
        ) : null}
      </div>
    </button>
  )
})
