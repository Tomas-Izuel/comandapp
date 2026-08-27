import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `serverEnv()` cachea el parseo del `process.env` en una variable de módulo
 * (`src/lib/env.server.ts`), así que el primer test que lo importe congela el
 * resultado para todos los que vengan después. La única forma de simular
 * "sin CREDENTIALS_ENCRYPTION_KEY" vs. "con una clave válida" en el mismo
 * archivo es resetear el registro de módulos e importar de nuevo en cada
 * test — `import()` dinámico en vez de un `import` estático de arriba.
 *
 * El resto de las variables requeridas por `serverSchema` no importan para
 * estos tests, pero son obligatorias igual: sin ellas `serverEnv()` tira
 * "Variables de entorno inválidas" antes de llegar a `CREDENTIALS_ENCRYPTION_KEY`.
 */
const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SECRET_KEY: 'secret-key',
  NEXT_PUBLIC_SITE_URL: 'https://example.com',
  CRON_SECRET: 'cron-secret',
}

const ENV_KEYS = [...Object.keys(BASE_ENV), 'CREDENTIALS_ENCRYPTION_KEY'] as const
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

function validKey(): string {
  return randomBytes(32).toString('base64')
}

/** Resetea el cache de módulos, fija el entorno y reimporta `secrets.ts` fresco. */
async function loadSecrets(encryptionKey: string | undefined) {
  vi.resetModules()
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  if (encryptionKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
  else process.env.CREDENTIALS_ENCRYPTION_KEY = encryptionKey

  return import('@/lib/crypto/secrets')
}

describe('encryptSecret / decryptSecret — S-08: credenciales de cobro cifradas en reposo', () => {
  it('hace round-trip: descifrar lo que se cifró da el texto original', async () => {
    const { encryptSecret, decryptSecret } = await loadSecrets(validKey())
    const plaintext = 'APP_USR-1234567890-mp-access-token'

    const stored = encryptSecret(plaintext)
    expect(stored).not.toBe(plaintext)
    expect(decryptSecret(stored)).toBe(plaintext)
  })

  it('el ciphertext lleva el prefijo de versión v1.', async () => {
    const { encryptSecret } = await loadSecrets(validKey())
    expect(encryptSecret('algo')).toMatch(/^v1\./)
  })

  it('compatibilidad hacia atrás: un valor SIN el prefijo v1. se devuelve tal cual (texto plano viejo)', async () => {
    const { decryptSecret } = await loadSecrets(validKey())
    // Esto es lo que permite que una tienda que conectó Mercado Pago antes de
    // esta migración siga funcionando sin re-cargar sus credenciales.
    const legacyPlaintext = 'TEST-0000-old-style-token'
    expect(decryptSecret(legacyPlaintext)).toBe(legacyPlaintext)
  })

  it('decryptSecret(null) da null y decryptSecret("") da null', async () => {
    const { decryptSecret } = await loadSecrets(validKey())
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret('')).toBeNull()
  })

  it('sin clave configurada, encryptSecret TIRA — nunca hay un camino silencioso a guardar en claro', async () => {
    const { encryptSecret } = await loadSecrets(undefined)
    expect(() => encryptSecret('un secreto cualquiera')).toThrow()
  })

  it('sin clave configurada, hasEncryptionKey() da false', async () => {
    const { hasEncryptionKey } = await loadSecrets(undefined)
    expect(hasEncryptionKey()).toBe(false)
  })

  it('con clave configurada, hasEncryptionKey() da true', async () => {
    const { hasEncryptionKey } = await loadSecrets(validKey())
    expect(hasEncryptionKey()).toBe(true)
  })

  it('un ciphertext con el authTag manipulado falla al descifrar (AES-GCM autentica)', async () => {
    const { encryptSecret, decryptSecret } = await loadSecrets(validKey())
    const stored = encryptSecret('access-token-real')

    const [version, iv, authTag, data] = stored.split('.')
    const tamperedTag = flipMiddleChar(authTag)
    const tampered = [version, iv, tamperedTag, data].join('.')

    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('un ciphertext con los datos manipulados falla al descifrar', async () => {
    const { encryptSecret, decryptSecret } = await loadSecrets(validKey())
    const stored = encryptSecret('access-token-real')

    const [version, iv, authTag, data] = stored.split('.')
    const tamperedData = flipMiddleChar(data)
    const tampered = [version, iv, authTag, tamperedData].join('.')

    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('descifrar con una clave DISTINTA a la que cifró también falla (autenticación, no solo confidencialidad)', async () => {
    const { encryptSecret } = await loadSecrets(validKey())
    const stored = encryptSecret('access-token-real')

    const { decryptSecret } = await loadSecrets(validKey()) // otra clave, otro módulo fresco
    expect(() => decryptSecret(stored)).toThrow()
  })

  it('una clave de largo incorrecto tira un error explícito, no falla en silencio', async () => {
    const shortKey = randomBytes(16).toString('base64') // 16 bytes, no los 32 que exige AES-256
    const { encryptSecret } = await loadSecrets(shortKey)
    expect(() => encryptSecret('x')).toThrow(/32/)
  })

  it('sin clave, decryptSecret de un valor cifrado (v1.) también tira: no hay forma de leerlo', async () => {
    // Se cifra con una clave...
    const { encryptSecret } = await loadSecrets(validKey())
    const stored = encryptSecret('access-token-real')

    // ...y se intenta descifrar en un proceso sin la clave configurada.
    const { decryptSecret } = await loadSecrets(undefined)
    expect(() => decryptSecret(stored)).toThrow()
  })

  it('un ciphertext con formato roto (faltan segmentos) tira', async () => {
    const { decryptSecret } = await loadSecrets(validKey())
    expect(() => decryptSecret('v1.solo-un-segmento')).toThrow()
  })
})

describe('lastFour', () => {
  it('devuelve los últimos 4 caracteres de un valor largo', async () => {
    const { lastFour } = await loadSecrets(validKey())
    expect(lastFour('APP_USR-1234567890')).toBe('7890')
  })

  it('da null para null', async () => {
    const { lastFour } = await loadSecrets(validKey())
    expect(lastFour(null)).toBeNull()
  })

  it('da null para un string más corto que 4 caracteres', async () => {
    const { lastFour } = await loadSecrets(validKey())
    expect(lastFour('abc')).toBeNull()
  })

  it('da null para un string vacío', async () => {
    const { lastFour } = await loadSecrets(validKey())
    expect(lastFour('')).toBeNull()
  })

  it('un string de exactamente 4 caracteres se devuelve completo', async () => {
    const { lastFour } = await loadSecrets(validKey())
    expect(lastFour('abcd')).toBe('abcd')
  })
})

/**
 * Cambia un carácter base64url en el MEDIO del string, no en el último.
 *
 * El último carácter de un grupo base64 puede llevar bits de padding que se
 * descartan al decodificar (p. ej. el authTag de 16 bytes no es múltiplo de
 * 3, así que su último char tiene bits sin usar): tocar justo ahí podría no
 * cambiar ni un solo byte real y el test de manipulación daría falso
 * negativo. Un carácter del medio siempre mapea a bits que sí importan.
 */
function flipMiddleChar(s: string): string {
  const chars = s.split('')
  const i = Math.floor(chars.length / 2)
  chars[i] = chars[i] === 'A' ? 'B' : 'A'
  return chars.join('')
}
