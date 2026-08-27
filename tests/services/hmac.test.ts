import { describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

// `hmac.ts` (y casi todo lo que importa) lleva `import 'server-only'` en la
// primera línea. Ese paquete tira a propósito salvo que el bundler resuelva
// la condición `react-server` (lo hace Next, no Vitest) — así que se noopea
// acá, dentro de nuestro propio archivo de test, sin tocar vitest.config.ts.
vi.mock('server-only', () => ({}))

const { signHmacSha256, timingSafeEqualString, verifyHmacSha256 } = await import('@/services/crypto/hmac')

/**
 * `src/services/crypto/hmac.ts` es la base de dos superficies de seguridad:
 * la verificación del webhook de Mercado Pago y la firma que sale hacia los
 * POS. Un bug acá se propaga a las dos.
 */
describe('verifyHmacSha256', () => {
  const secret = 'un-secreto-de-tienda'
  const payload = 'id:123;request-id:abc;ts:1700000000;'

  it('acepta la firma correcta calculada con el mismo secreto', () => {
    const expected = createHmac('sha256', secret).update(payload).digest('hex')
    expect(verifyHmacSha256(payload, secret, expected)).toBe(true)
  })

  it('rechaza una firma que difiere en un solo byte', () => {
    const expected = createHmac('sha256', secret).update(payload).digest('hex')
    // Cambia el último nibble hex, sin tocar el largo: sigue siendo hex válido.
    const lastChar = expected.at(-1)
    const flipped = lastChar === '0' ? '1' : '0'
    const tampered = expected.slice(0, -1) + flipped
    expect(tampered).not.toBe(expected)
    expect(verifyHmacSha256(payload, secret, tampered)).toBe(false)
  })

  it('rechaza una firma de largo distinto sin tirar (el chequeo de largo va antes de timingSafeEqual)', () => {
    const expected = createHmac('sha256', secret).update(payload).digest('hex')
    const shorter = expected.slice(0, -2) // hex válido, pero de otro largo
    expect(() => verifyHmacSha256(payload, secret, shorter)).not.toThrow()
    expect(verifyHmacSha256(payload, secret, shorter)).toBe(false)
  })

  it('rechaza input que no sea hexadecimal', () => {
    expect(verifyHmacSha256(payload, secret, 'no-es-hex-esto-tiene-una-z')).toBe(false)
    expect(verifyHmacSha256(payload, secret, '')).toBe(false)
  })

  it('signHmacSha256 produce exactamente lo que espera verifyHmacSha256 con el mismo secreto', () => {
    const signature = signHmacSha256(payload, secret)
    expect(verifyHmacSha256(payload, secret, signature)).toBe(true)
  })
})

describe('timingSafeEqualString', () => {
  it('acepta dos strings iguales', () => {
    expect(timingSafeEqualString('mismo-secreto-cron', 'mismo-secreto-cron')).toBe(true)
  })

  it('rechaza dos strings distintos del mismo largo', () => {
    expect(timingSafeEqualString('secreto-cron-aaaa', 'secreto-cron-bbbb')).toBe(false)
  })

  it('rechaza strings de largo distinto sin tirar', () => {
    expect(() => timingSafeEqualString('corto', 'un-secreto-mucho-mas-largo')).not.toThrow()
    expect(timingSafeEqualString('corto', 'un-secreto-mucho-mas-largo')).toBe(false)
  })
})
