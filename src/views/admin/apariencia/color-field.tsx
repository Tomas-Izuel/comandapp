'use client'

import { useId, useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { contrastRatio, ensureContrast, hexToOklch, oklchToCss } from '@/lib/color'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Cuánto se movió la lightness entre el color elegido y el corregido. Por
 * debajo de esto es ruido de redondeo, no una corrección real que valga la
 * pena anunciarle al dueño.
 */
const CORRECTION_EPSILON = 0.004

/**
 * Cuando `against` está presente, este campo es un texto que se pinta SOBRE
 * ese color de fondo (`color_foreground` sobre `color_background`,
 * `color_primary_foreground` sobre `color_primary`) — exactamente el mismo
 * par que corrige `buildThemeCss()` con `ensureContrast()`. El swatch de acá
 * no muestra el hex crudo: muestra el resultado ya corregido, porque eso es
 * lo que el sitio va a mostrar. Mostrar el crudo sería mentirle al dueño
 * sobre su propio color.
 */
export function ColorField({
  label,
  value,
  onChange,
  error,
  against,
  hint,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
  error?: string
  against?: string
  hint?: string
}) {
  const [draft, setDraft] = useState(value)
  const inputId = useId()
  const errorId = `${inputId}-error`

  function commit(next: string) {
    setDraft(next)
    if (HEX_RE.test(next)) onChange(next)
  }

  const invalid = !HEX_RE.test(draft)

  const correction = useMemo(() => {
    if (!against || invalid || !HEX_RE.test(against)) return null
    try {
      const foreground = hexToOklch(value)
      const background = hexToOklch(against)
      const corrected = ensureContrast(foreground, background, 4.5)
      const ratio = contrastRatio(corrected, background)
      const wasCorrected = Math.abs(corrected.l - foreground.l) > CORRECTION_EPSILON
      return {
        backgroundCss: oklchToCss(background),
        correctedCss: oklchToCss(corrected),
        ratio,
        wasCorrected,
      }
    } catch {
      return null
    }
  }, [against, invalid, value])

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={HEX_RE.test(draft) ? draft : value}
          onChange={(e) => commit(e.target.value)}
          aria-label={`${label} (selector)`}
          className="border-input h-9 w-9 shrink-0 cursor-pointer rounded-md border p-0.5"
        />
        <Input
          id={inputId}
          value={draft}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setDraft(HEX_RE.test(draft) ? draft : value)}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className={cn('h-9 font-mono text-sm', invalid && 'text-destructive')}
        />
        {correction ? (
          <span
            aria-hidden
            className="border-border flex h-9 shrink-0 items-center justify-center rounded-md border px-2 text-xs font-semibold"
            style={{ background: correction.backgroundCss, color: correction.correctedCss }}
          >
            Aa
          </span>
        ) : null}
      </div>
      {invalid ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error ?? 'Tiene que ser un hex de 6 dígitos, por ejemplo #f97316'}
        </p>
      ) : correction ? (
        <p className="text-muted-foreground text-xs">
          {correction.wasCorrected
            ? `Este color no se lee bien encima: el sitio lo corrige a lo que ves en "Aa" para llegar a un contraste de ${correction.ratio.toFixed(1)}:1.`
            : `Contraste con el fondo: ${correction.ratio.toFixed(1)}:1 — se muestra tal cual lo elegiste.`}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  )
}
