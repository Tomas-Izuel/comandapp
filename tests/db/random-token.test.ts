import { describe, expect, it } from 'vitest'
import { dbAvailable, sql } from './helpers'

/**
 * P-11 — `private.random_token` es CSPRNG, no `random()`.
 *
 * `random()` es xoroshiro128**, un PRNG determinístico que la doc de Postgres
 * marca explícitamente como no apto para criptografía. `public_token` es la
 * ÚNICA credencial de un pedido (va en la URL y en el localStorage del
 * cliente), y `short_code` usa el mismo generador y se canta en el
 * mostrador: hay salidas públicas del PRNG. Ahora usa `gen_random_bytes` de
 * pgcrypto.
 *
 * No se puede probar "es criptográficamente seguro" desde un test — eso es
 * una propiedad del algoritmo, no del output. Lo que sí se puede verificar:
 * largo correcto, alfabeto correcto y ausencia de colisiones en una muestra
 * grande. No escribe nada: es de solo lectura, no hace falta transacción.
 */
describe.skipIf(!dbAvailable)('private.random_token — CSPRNG', () => {
  const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

  it('500 llamadas dan 500 tokens de 24 caracteres, todos distintos y dentro del alfabeto', () => {
    const out = sql(`select string_agg(private.random_token(24), ',') from generate_series(1, 500);`)
    const tokens = out.split(',')

    expect(tokens).toHaveLength(500)
    expect(new Set(tokens).size).toBe(500) // sin colisiones

    for (const token of tokens) {
      expect(token).toHaveLength(24)
      for (const char of token) {
        expect(ALPHABET.includes(char)).toBe(true)
      }
    }
  })

  it('el alfabeto no tiene caracteres ambiguos (0, 1, i, l, o) — es para cantar en el mostrador', () => {
    for (const ambiguous of ['0', '1', 'i', 'l', 'o']) {
      expect(ALPHABET.includes(ambiguous)).toBe(false)
    }
  })
})
