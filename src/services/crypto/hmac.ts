import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC-SHA256 compartido por el adapter de Mercado Pago (verifica la firma
 * del webhook entrante) y el de POS (firma lo que salimos a entregar).
 * Centralizado acá para no reimplementar la comparación en tiempo constante
 * en dos lugares — es la parte fácil de hacer mal.
 */

export function signHmacSha256(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Compara la firma calculada contra la recibida en tiempo constante.
 *
 * Un `===` filtra, por cuánto tarda en responder, en qué byte empezó a
 * diferir la firma recibida de la esperada — en teoría alcanza para
 * reconstruirla byte a byte. `timingSafeEqual` no depende del contenido, solo
 * del largo, así que ese chequeo se hace antes y aparte (un largo distinto ya
 * significa "inválida", no hace falta comparar byte a byte para saberlo).
 */
export function verifyHmacSha256(payload: string, secret: string, expected: string): boolean {
  if (!/^[0-9a-f]+$/i.test(expected)) return false

  const computed = signHmacSha256(payload, secret)
  const computedBuffer = Buffer.from(computed, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')

  if (computedBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(computedBuffer, expectedBuffer)
}

/**
 * Compara dos strings arbitrarios (no necesariamente hex) en tiempo
 * constante. Para secretos compartidos como `CRON_SECRET`, donde un `===`
 * filtra por timing en qué byte empezó a diferir el valor recibido.
 *
 * El chequeo de largo previo es aparte a propósito: `timingSafeEqual` tira
 * si los buffers no miden lo mismo, y el largo de un secreto fijo no es en sí
 * mismo información sensible (a diferencia de su contenido).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
