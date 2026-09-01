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

/**
 * Porcentaje entero de un monto en centavos, redondeando SIEMPRE PARA ABAJO.
 *
 * `scaleUpInt()` NO sirve para esto y la diferencia es plata: hace `Math.ceil`,
 * que está bien para un ETA —redondear un minuto para arriba es honesto— y mal
 * para un descuento, porque redondear el regalo para arriba lo paga el local.
 *
 * La MISMA fórmula vive en SQL, adentro de `public.create_order`, como
 * `(subtotal * percent) / 100` con división entera. Están escritas dos veces a
 * propósito, igual que `ALLOWED_TRANSITIONS`: ésta muestra el número antes de
 * comprar, la de Postgres es la que cobra y rechaza al llamador si no
 * coinciden. Hay un test de paridad, y no es decorativo: con subtotal 833333 y
 * 15%, el valor exacto es 124999.95 → 124999 acá y 124999 allá; un `ceil`
 * devolvería 125000 y `create_order` respondería CPN09.
 *
 * `percent` se espera entero de 1 a 100 (`coupons_shape_check` lo garantiza en
 * la base). Se opera con enteros y se divide una sola vez.
 */
export function percentOfCentsDown(cents: number, percent: number): number {
  return Math.floor((assertCents(cents) * Math.trunc(percent)) / 100)
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + assertCents(value), 0)
}
