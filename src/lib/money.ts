/**
 * Todo el dinero de la app son centavos enteros (bigint en Postgres, number acá).
 * Nunca float: 0.1 + 0.2 !== 0.3 y en un total de pedido eso es plata real.
 *
 * La única conversión a decimal ocurre en el borde con Mercado Pago, que espera
 * un número con centavos.
 */

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER

export function assertCents(value: number, label = 'monto'): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_CENTS) {
    throw new Error(`${label} inválido: se esperaban centavos enteros no negativos, llegó ${value}`)
  }
  return value
}

/** Centavos → "$ 7.800,00" */
export function formatCents(cents: number, currency = 'ARS', locale = 'es-AR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

/** Centavos → "$ 7.800" (sin decimales; en ARS los centavos no existen en la práctica) */
export function formatCentsCompact(cents: number, currency = 'ARS', locale = 'es-AR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

/** Centavos → decimal para la API de Mercado Pago. */
export function centsToDecimal(cents: number): number {
  return Math.round(assertCents(cents)) / 100
}

/**
 * Decimal de Mercado Pago → centavos.
 *
 * Valida el resultado: un `transaction_amount` que llega como `null`, negativo o
 * absurdo tiene que romper acá y no convertirse en un total de pedido.
 */
export function decimalToCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`monto decimal inválido: ${amount}`)
  }
  return assertCents(Math.round(amount * 100))
}

/**
 * Multiplica centavos por un factor decimal sin pasar por float.
 *
 * `Math.ceil(20 * 1.1)` da 23 porque `20 * 1.1 === 22.000000000000004`. Se opera
 * en puntos base (enteros) y se redondea una sola vez, al final.
 */
export function scaleUpInt(value: number, factor: number): number {
  const basisPoints = Math.round(factor * 10_000)
  return Math.ceil((value * basisPoints) / 10_000)
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + assertCents(value), 0)
}
