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
 * Paso entre marcas de hora, según cuánto span cubre el eje. Sin esto, un
 * local de un turno corto (span mínimo, 8h) amontona marcas cada hora, y una
 * semana con jornadas largas (span 18h+) se queda con dos marcas nada más.
 */
function tickStepHours(span: number): number {
  if (span <= 10) return 2
  if (span <= 18) return 3
  return 4
}

/**
 * Marcas de hora INTERNAS del eje (nunca los bordes: el marco de la pista ya
 * los señala). Comparten cálculo entre las siete pistas — mismo `axis`, mismo
 * paso, mismas posiciones — así que leídas una debajo de la otra forman una
 * sola grilla en vez de siete franjas mudas. Es lo que responde "¿qué hora es
 * esta posición?" sin agregar una fila de horas aparte arriba del grupo.
 */
export function hourTicks(axis: Axis): number[] {
  const step = tickStepHours(axis.end - axis.start)
  const ticks: number[] = []
  for (let hour = Math.ceil(axis.start / step) * step; hour < axis.end; hour += step) {
    if (hour > axis.start) ticks.push(hour)
  }
  return ticks
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
      {/*
        Decorativa: el dato accesible es el texto de arriba, no este
        rectángulo (`aria-hidden` en el contenedor entero).

        `border` en vez de solo `bg-muted`: con un turno que cubre casi todo
        el eje la barra se comía la pista entera y no quedaba forma de ver
        dónde terminaba el "marco" — con el borde, la pista se sigue leyendo
        como pista aunque la barra la llene.

        `isolate` acota el `mix-blend-difference` del marcador de medianoche a
        ESTE rectángulo: sin eso el blend compone contra lo que sea que quede
        detrás en el layout, no solo contra esta pista.
      */}
      <div
        aria-hidden
        className="bg-muted border-border relative isolate order-3 h-6 w-full shrink-0 basis-full overflow-hidden rounded-md border @min-[26rem]:order-2 @min-[26rem]:h-5 @min-[26rem]:w-auto @min-[26rem]:basis-auto @min-[26rem]:flex-1"
      >
        {/*
          Marcas de hora compartidas por las siete pistas (`hourTicks`, mismo
          `axis` en las siete): sin ninguna referencia de "qué hora es esta
          posición" la barra era pura decoración con forma de dato. Van ANTES
          que los turnos a propósito: donde hay un turno, el turno tapa la
          marca — no hace falta reforzar lo que la barra ya dice.
        */}
        {axis
          ? hourTicks(axis).map((hour) => (
              <div
                key={hour}
                className="bg-foreground/15 absolute inset-y-0 w-px"
                style={{ left: `${((hour - axis.start) / (axis.end - axis.start)) * 100}%` }}
              />
            ))
          : null}
        {/*
          Un día CERRADO (`ranges` vacío) con eje presente dibuja la grilla de
          marcas pero ningún turno: se distingue de un vistazo de la semana
          SIN eje (`axis === null`, ninguna marca, rectángulo liso), que es un
          estado distinto — "no cargaste nada todavía", no "este día no abre".
        */}
        {axis
          ? ranges.map((range, index) => {
              const startHour = range.opensAtMinute / 60
              const endHour = startHour + range.durationMinutes / 60
              const span = axis.end - axis.start
              const left = ((startHour - axis.start) / span) * 100
              const width = ((endHour - startHour) / span) * 100
              return (
                // `max(...px)`: un turno de 30min en un eje de 18h da un ancho
                // sub-pixel que el navegador redondea a invisible. El piso en
                // píxeles garantiza que TODO turno cargado se vea, aunque sea
                // corto — visible pero mal ubicado es un dato; invisible no es
                // nada.
                //
                // Radio: `min(var(--radius-sm), 3px)`, no un píxel suelto ni
                // el token de la escala tal cual. `--radius-sm` es
                // `calc(var(--radius) * 0.6)` ≈ 8.4px con el `--radius` de
                // 0.875rem del proyecto — en una barra de 20-24px de alto eso
                // es casi la mitad de su altura, o sea la misma cápsula que
                // `rounded-pill` que este cambio vino a sacar. El `min()`
                // sigue anclado al token (si `--radius` bajara, el radio de
                // la barra bajaría con él) pero pone el mismo techo prolijo
                // que ya usa `button.tsx` para sus tamaños chicos
                // (`rounded-[min(var(--radius-md),10px)]`), en vez de inventar
                // un valor sin relación con la escala.
                <div
                  key={index}
                  className="bg-primary absolute inset-y-0 rounded-[min(var(--radius-sm),3px)]"
                  style={{ left: `${left}%`, width: `max(${width}%, 6px)` }}
                />
              )
            })
          : null}
        {midnightLeft !== null ? (
          // `mix-blend-difference` en vez de un color fijo: un `bg-border`
          // sobre `bg-primary` (turno cruzando la medianoche) quedaba gris
          // claro sobre oscuro y casi no se notaba, y sobre `bg-muted` era gris
          // sobre gris. El blend invierte lo que tenga debajo, así que el
          // marcador se ve siempre, esté parado sobre turno o sobre pista
          // vacía, en claro o en oscuro.
          //
          // El riesgo real de `difference` es que sobre un color CROMÁTICO da
          // un tono fuera de paleta (magenta, verde ácido) que cambia con el
          // tema. Acá no pasa: `--primary`, `--muted`, `--border` y
          // `--foreground` de /admin son OKLCH con croma 0 (grises puros — no
          // hay tema de marca en Operate), y este relleno también
          // (`oklch(0.65 0 0)`). La resta de dos grises da otro gris: no hay
          // canal de color que difiera entre R, G y B, así que no hay forma
          // de que salga un matiz. Verificado a mano (02-development):
          // ~rgb(120,120,120) sobre el primary claro, ~rgb(86,86,86) sobre el
          // oscuro — limpio en los dos temas. Si `/admin` alguna vez suma un
          // acento cromático a estos tokens, este cálculo hay que rehacerlo.
          <div
            className="absolute inset-y-0 w-[1.5px] mix-blend-difference"
            style={{ left: `${midnightLeft}%`, backgroundColor: 'oklch(0.65 0 0)' }}
          />
        ) : null}
      </div>
    </button>
  )
})
