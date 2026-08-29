'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Input de plata: agrupa miles a la argentina (`100000` centavos → `1.000`) y
 * muestra el `$` como afijo fuera del valor. Reemplaza las tres
 * implementaciones sueltas que había (product-drawer, settings-form,
 * option-groups-editor) — todas mostraban el número pelado, ilegible en un
 * local que carga precios de cinco y seis cifras.
 *
 * Decisión de formato (documentada porque es el tipo de trampa que este repo
 * comenta): con agrupación automática de miles, el `.` que tipea el usuario
 * NO puede ser el separador decimal — sería ambiguo entre "punto de miles que
 * ya puso el sistema" y "coma que quiso poner el usuario", y le cobraría 1
 * peso a quien tipeó "1.000" queriendo mil pesos. Por eso el punto es SIEMPRE
 * de miles (se ignora al parsear, sea que lo haya insertado el formateo o que
 * lo haya tipeado el usuario) y el decimal se tipea con `,`, que es el
 * separador decimal real en es-AR.
 */

const MAX_DECIMAL_DIGITS = 2

// Hoisteadas al módulo: crear un RegExp en cada tecla tipeada es descartable.
const LEADING_ZEROS_RE = /^0+(?=\d)/
const THOUSANDS_RE = /\B(?=(\d{3})+(?!\d))/g

/** Agrupa una cadena de dígitos en miles: "15234" → "15.234". */
function groupThousands(digits: string): string {
  if (digits === '') return ''
  // Ceros a la izquierda no aportan nada mientras se sigue tipeando ("01" → "1"),
  // pero un único "0" se deja tal cual.
  const stripped = digits.replace(LEADING_ZEROS_RE, '')
  return stripped.replace(THOUSANDS_RE, '.')
}

/**
 * Reduce lo que sea que haya en el `<input>` (incluidos los puntos de miles
 * que el propio formateo insertó) a solo lo que importa para el valor: signo
 * opcional al inicio, dígitos, y como mucho una coma con hasta 2 decimales.
 * Todo lo demás —puntos incluidos— se descarta en silencio.
 */
function sanitizeRawInput(raw: string, allowNegative: boolean): string {
  let out = ''
  let isNegative = false
  let seenComma = false
  let decimalDigits = 0
  for (const ch of raw) {
    if (ch === '-') {
      if (allowNegative && out === '' && !isNegative) isNegative = true
      continue
    }
    if (ch === ',') {
      if (!seenComma) {
        out += ','
        seenComma = true
      }
      continue
    }
    if (ch >= '0' && ch <= '9') {
      if (seenComma) {
        if (decimalDigits < MAX_DECIMAL_DIGITS) {
          out += ch
          decimalDigits++
        }
      } else {
        out += ch
      }
      continue
    }
    // Puntos de miles (los nuestros o los que el usuario haya tipeado) y
    // cualquier otro carácter: ignorados.
  }
  return (isNegative ? '-' : '') + out
}

/**
 * Ancla el caret en "caracteres significativos" (todo lo que sobrevive al
 * saneo: dígitos, la coma decimal y el signo) y NO en dígitos.
 *
 * Contar solo dígitos no puede expresar "el caret quedó justo después del
 * signo" ni "justo después de la coma": un `-` o una `,` recién tipeados
 * suman cero dígitos, así que el ancla calculada apunta ANTES de ese
 * carácter y la tecla siguiente lo desplaza o —en el caso del signo— lo hace
 * caer fuera de la posición inicial que exige `sanitizeRawInput`, y se
 * pierde en silencio. El síntoma real fue exactamente ese: tipear "-200"
 * terminaba guardando "+200".
 *
 * El display y el saneado difieren únicamente en los puntos de miles (que el
 * saneado no tiene), así que contar "todo menos el `.`" es un mapeo exacto
 * entre ambas cadenas y trata al signo y a la coma igual que a un dígito.
 */
function significantBefore(raw: string, caret: number, allowNegative: boolean): number {
  return sanitizeRawInput(raw.slice(0, caret), allowNegative).length
}

/**
 * Índice en `display` inmediatamente después del n-ésimo carácter
 * significativo (1-indexado): el `.` de miles no cuenta, así que el caret
 * nunca queda parado sobre un separador que el usuario no tipeó. Ver el
 * comentario de `significantBefore` sobre por qué "dígito" no alcanza como
 * unidad de conteo acá.
 */
function indexAfterNSignificant(display: string, n: number): number {
  if (n <= 0) return 0
  let count = 0
  for (let i = 0; i < display.length; i++) {
    if (display[i] !== '.') {
      count++
      if (count === n) return i + 1
    }
  }
  return display.length
}

/** Borrador saneado → centavos enteros. Nunca queda un float a mitad de camino. */
function sanitizedToCents(sanitized: string): number {
  const isNegative = sanitized.startsWith('-')
  const unsigned = isNegative ? sanitized.slice(1) : sanitized
  const commaIndex = unsigned.indexOf(',')
  const intPart = commaIndex === -1 ? unsigned : unsigned.slice(0, commaIndex)
  const decPart = commaIndex === -1 ? '' : unsigned.slice(commaIndex + 1)
  const pesos = intPart === '' ? 0 : Math.round(parseInt(intPart, 10))
  const centavos = decPart === '' ? 0 : Math.round(parseInt(decPart.padEnd(MAX_DECIMAL_DIGITS, '0'), 10))
  const total = pesos * 100 + centavos
  return isNegative && total !== 0 ? -total : total
}

/** Borrador saneado → lo que se ve en el campo mientras se tipea. */
function sanitizedToDisplay(sanitized: string): string {
  const isNegative = sanitized.startsWith('-')
  const unsigned = isNegative ? sanitized.slice(1) : sanitized
  const commaIndex = unsigned.indexOf(',')
  const hasComma = commaIndex !== -1
  const intPart = hasComma ? unsigned.slice(0, commaIndex) : unsigned
  const decPart = hasComma ? unsigned.slice(commaIndex + 1) : ''
  const groupedInt = groupThousands(intPart)
  let out = (isNegative ? '-' : '') + groupedInt
  if (hasComma) out += ',' + decPart
  return out
}

/** Centavos enteros → borrador canónico. Para el valor inicial y para cuando `cents` cambia desde afuera. */
export function formatCentsForInput(cents: number): string {
  const rounded = Math.round(cents)
  const isNegative = rounded < 0
  const abs = Math.abs(rounded)
  const pesos = Math.floor(abs / 100)
  const centavos = abs % 100
  const groupedPesos = groupThousands(String(pesos)) || '0'
  const decimalStr = centavos > 0 ? ',' + String(centavos).padStart(2, '0') : ''
  return (isNegative ? '-' : '') + groupedPesos + decimalStr
}

/** Lo que tipea el usuario → centavos enteros (satura decimales a 2 y descarta el signo si `allowNegative` es falso). */
export function parseInputToCents(raw: string, allowNegative = false): number {
  return sanitizedToCents(sanitizeRawInput(raw, allowNegative))
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('es-AR', { style: 'currency', currency }).formatToParts(0)
    return parts.find((part) => part.type === 'currency')?.value ?? '$'
  } catch {
    // Código de moneda que Intl no reconoce: no vale la pena armar un mapa a mano.
    return '$'
  }
}

export function MoneyInput({
  id,
  cents,
  onCentsChange,
  currency = 'ARS',
  allowNegative = false,
  invalid,
  errorId,
  className,
  ...props
}: {
  id?: string
  cents: number
  onCentsChange: (cents: number) => void
  currency?: string
  allowNegative?: boolean
  invalid?: boolean
  errorId?: string
  className?: string
} & Omit<React.ComponentProps<typeof Input>, 'id' | 'value' | 'onChange' | 'type' | 'inputMode'>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(() => formatCentsForInput(cents))

  // Último valor que ESTE componente emitió. Sirve para distinguir "el padre
  // me está pasando de vuelta lo que yo mismo mandé" (no tocar el borrador,
  // puede tener una coma final o un "-" solo a mitad de tipeo) de "el padre
  // cambió `cents` por su cuenta" (reset() de react-hook-form, valor que
  // llega del servidor): ahí sí hay que reflejarlo.
  const lastEmittedRef = useRef(cents)

  // Caracteres significativos a la izquierda del caret al momento de tipear,
  // para reposicionarlo después de reformatear. "Significativo" y no "dígito"
  // a propósito: ver `significantBefore`.
  const caretAnchorRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (cents !== lastEmittedRef.current) {
      setDraft(formatCentsForInput(cents))
      lastEmittedRef.current = cents
    }
  }, [cents])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el || caretAnchorRef.current === null) return
    // Solo repositionar si el campo lo sigue teniendo enfocado: un cambio
    // externo no debería robar el foco ni el caret de otro elemento.
    if (document.activeElement === el) {
      const pos = indexAfterNSignificant(draft, caretAnchorRef.current)
      el.setSelectionRange(pos, pos)
    }
    caretAnchorRef.current = null
  }, [draft])

  const symbol = useMemo(() => currencySymbol(currency), [currency])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const rawValue = e.target.value
    const caretPos = e.target.selectionStart ?? rawValue.length

    // Reformatear en cada tecla mueve el caret al final si se deja librado al
    // navegador. La técnica: contar caracteres SIGNIFICATIVOS a la izquierda
    // del caret ANTES de reformatear (acá, sobre el valor crudo que el
    // navegador ya editó), y después de escribir el valor formateado
    // reposicionarlo en el índice que deja esa misma cantidad a su izquierda
    // — nunca restaurar el índice crudo, que ya no significa lo mismo en la
    // cadena reagrupada.
    caretAnchorRef.current = significantBefore(rawValue, caretPos, allowNegative)

    const sanitized = sanitizeRawInput(rawValue, allowNegative)
    const nextCents = sanitizedToCents(sanitized)

    setDraft(sanitizedToDisplay(sanitized))
    lastEmittedRef.current = nextCents
    onCentsChange(nextCents)
  }

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="tabular text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 select-none"
      >
        {symbol}
      </span>
      <Input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        aria-invalid={invalid || undefined}
        aria-describedby={errorId}
        onChange={handleChange}
        className={cn('tabular pl-6', className)}
        {...props}
      />
    </div>
  )
}
