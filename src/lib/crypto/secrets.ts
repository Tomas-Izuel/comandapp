import 'server-only'

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { serverEnv } from '@/lib/env.server'
import { DomainError } from '@/lib/errors'

/**
 * Cifrado de los secretos que guardamos por tienda.
 *
 * El access token de Mercado Pago de cada local se guardaba en texto plano. El
 * aislamiento por grants estaba bien —solo `service_role` lee la tabla— pero eso
 * no cubre un `pg_dump`, un backup, la consola de Studio ni una secret key
 * filtrada: cualquiera de esos expone los tokens de producción de TODOS los
 * locales, y con un token de MP se pueden hacer reembolsos y consultar cobros.
 * Es el activo más sensible del sistema y era el que menos protección tenía.
 *
 * AES-256-GCM: da confidencialidad y además autentica, así que un ciphertext
 * manipulado falla al descifrar en vez de devolver basura.
 *
 * Formato: `v1.<iv>.<authTag>.<ciphertext>`, todo en base64url. El prefijo de
 * versión es lo que permite rotar el algoritmo más adelante sin adivinar.
 */

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // el tamaño que recomienda NIST para GCM
const KEY_BYTES = 32

function readKey(): Buffer | null {
  const raw = serverEnv().CREDENTIALS_ENCRYPTION_KEY
  if (!raw) return null

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY tiene ${key.length} bytes y se esperaban ${KEY_BYTES}. ` +
        'Generá una con: openssl rand -base64 32',
    )
  }
  return key
}

export function hasEncryptionKey(): boolean {
  return readKey() !== null
}

/**
 * Cifra un secreto. Tira si no hay clave configurada: guardar credenciales de
 * cobro en claro tiene que ser imposible, no un fallback silencioso.
 */
export function encryptSecret(plaintext: string): string {
  const key = readKey()
  if (!key) {
    throw new DomainError(
      'No se puede guardar la credencial: falta CREDENTIALS_ENCRYPTION_KEY en el servidor.',
      { status: 500 },
    )
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

/**
 * Descifra un secreto.
 *
 * Un valor sin el prefijo de versión es una fila anterior a esta migración, que
 * quedó en texto plano: se devuelve tal cual para no romper los locales que ya
 * tenían Mercado Pago conectado. Se vuelve a guardar cifrado la próxima vez que
 * el dueño toque el formulario.
 */
export function decryptSecret(stored: string | null): string | null {
  if (stored == null || stored === '') return null
  if (!stored.startsWith(`${VERSION}.`)) return stored

  const [, ivPart, tagPart, dataPart] = stored.split('.')
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('credencial cifrada con formato inválido')
  }

  const key = readKey()
  if (!key) {
    throw new Error(
      'Hay credenciales cifradas en la base pero falta CREDENTIALS_ENCRYPTION_KEY: sin la clave no se pueden leer.',
    )
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8')
}

/** Los últimos 4 caracteres, para mostrar "conectado ••••1234" sin descifrar de más. */
export function lastFour(value: string | null): string | null {
  if (!value || value.length < 4) return null
  return value.slice(-4)
}

/**
 * HMAC-SHA256 de un valor de vida corta, con la misma clave del cifrado.
 *
 * Es para los códigos de confirmación de `store_pending_changes`, no para
 * contraseñas: por eso HMAC y no bcrypt/argon2. Un código de 6 dígitos tiene un
 * millón de posibilidades, así que un hash lento no compra nada frente a un
 * atacante que tenga el hash — lo que lo protege de verdad es que vence a los
 * 10 minutos y admite 5 intentos, y eso se cuenta en la base. Lo que sí compra
 * el HMAC es que el hash **no se puede recalcular sin la clave**: un dump de la
 * tabla no permite ir de `code_hash` al código probando el millón de valores,
 * que es exactamente lo que pasaría con un SHA-256 pelado.
 *
 * Devuelve base64url para poder compararlo con `timingSafeEqual` sin
 * sorpresas de longitud.
 */
export function hmacSha256(value: string): string {
  const key = readKey()
  if (!key) {
    throw new DomainError(
      'No se puede generar el código de confirmación: falta CREDENTIALS_ENCRYPTION_KEY en el servidor.',
      { status: 500 },
    )
  }
  return createHmac('sha256', key).update(value, 'utf8').digest('base64url')
}
