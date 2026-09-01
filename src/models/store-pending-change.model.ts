import 'server-only'

import { randomInt, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { hmacSha256 } from '@/lib/crypto/secrets'
import { DomainError } from '@/lib/errors'
import type { Json } from '@/lib/supabase/database.types'

/**
 * Cambios sensibles que esperan confirmación por mail.
 *
 * Toda esta tabla se toca con `createAdminClient()` porque no tiene un solo
 * grant para `authenticated` (ver la migración): si el browser del staff
 * pudiera leerla, `attempts` y `expiresAt` serían decorativos — con la
 * publishable key se le pega a PostgREST directo y se lee el `code_hash`.
 *
 * El permiso NO se resuelve acá: cada caller entra detrás de un
 * `requireStoreMembership(storeId, { role: 'owner' })` explícito. Este módulo
 * asume que eso ya pasó, igual que el resto de los modelos que usan el cliente
 * admin.
 */

/**
 * `'bank_account'` (transferencia): a diferencia de `'payment_credentials'`,
 * el payload de este kind NO va cifrado (`admin.actions.ts`,
 * `requestBankAccountChangeAction`) — el CBU se publica a los clientes, así
 * que cifrarlo acá daría una falsa sensación de secreto sin ganar nada. El
 * código de 6 dígitos sigue guardándose como HMAC, como siempre
 * (00-architecture.md §5.11).
 */
export type PendingChangeKind =
  | 'payment_credentials'
  | 'courier_payment_policy'
  | 'bank_account'
  /**
   * Activar un cupón, o cambiarlo de una forma que aumente la exposición de
   * plata (`requiresConfirmation()` de `src/lib/coupon.ts` es el criterio).
   *
   * Es el PRIMER kind que puede tener más de una instancia viva por tienda, y
   * por eso existe `subjectId`. Ver la nota de `createPendingChange`.
   */
  | 'coupon'

/** Diez minutos: alcanza para ir al mail desde el celular y no tanto como para dejar el código dando vueltas. */
const TTL_MINUTES = 10

/**
 * Cinco intentos por solicitud. Contra un código de 6 dígitos (un millón de
 * combinaciones) eso deja la probabilidad de acertar a ciegas en 1 en 200.000,
 * y el que se queda sin intentos tiene que pedir un código nuevo — lo que manda
 * otro mail al dueño, o sea que insistir hace ruido.
 */
const MAX_ATTEMPTS = 5

/**
 * El payload va tipado `Json` y no `Record<string, unknown>` a propósito: es lo
 * que se guarda en una columna `jsonb`, así que un `Date` o un `undefined`
 * adentro es un bug que tiene que aparecer en el borde y no al deserializar.
 */
export type PendingChangePayload = { [key: string]: Json | undefined }

export type PendingChange = {
  id: number
  storeId: number
  kind: PendingChangeKind
  payload: PendingChangePayload
  /** `null` para los tres kinds originales (una sola instancia por tienda). Para `coupon`, el id del cupón — hace falta para reenviar sin invalidar el pendiente de OTRO cupón (ver `createPendingChange`). */
  subjectId: number | null
}

/**
 * Código de 6 dígitos.
 *
 * `randomInt` del módulo `crypto` y no `Math.random()`: el segundo es un PRNG
 * determinístico. Y `randomInt` en vez de `randomBytes(4) % 1_000_000`, que es
 * el error clásico: el módulo sesga los valores bajos porque 2^32 no es
 * múltiplo de un millón. `randomInt` hace el rejection sampling adentro, igual
 * que el generador de `public_token` en Postgres.
 *
 * Se devuelve con ceros a la izquierda: `000123` es un código válido, y
 * recortarlo a `123` achica el espacio real.
 */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Comparación en tiempo constante de dos hashes base64url. */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  // `timingSafeEqual` tira si las longitudes difieren, y esa excepción sería
  // en sí misma un canal lateral. Como los dos lados son HMAC-SHA256 en
  // base64url, una longitud distinta solo puede venir de una fila corrupta.
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Crea la solicitud y devuelve el código EN CLARO, una sola vez, para que el
 * caller lo mande por mail. No queda en ningún lado más: en la fila va el HMAC.
 *
 * Invalida los pendientes anteriores del mismo `(storeId, kind, subjectId)`.
 * Sin eso se acumulan códigos vivos: alguien que pide tres veces seguidas
 * termina con tres códigos válidos a la vez, y cada uno con sus propios 5
 * intentos.
 *
 * ⚠️ **`subjectId` no es un parámetro de conveniencia: sin él los cupones se
 * pisan entre sí.** Los tres kinds originales tienen a lo sumo UNA cosa de esa
 * clase por tienda (una credencial de MP, una política de cobro, una cuenta
 * bancaria), así que invalidar por `(storeId, kind)` era exactamente correcto.
 * Con cupones no: el dueño activa el cupón A, después el B, y la invalidación
 * por `(storeId, 'coupon')` le mata el código de A **sin decirle nada**. El
 * síntoma es "tipeé el código que me llegó y no funciona", indistinguible de un
 * bug del segundo factor.
 *
 * ⚠️ Y va `.is('subject_id', null)`, nunca `.eq('subject_id', null)`: en
 * PostgREST un `eq` contra null no matchea ninguna fila, así que la
 * invalidación de los tres kinds originales dejaría de invalidar nada y
 * volverían los códigos acumulados — en silencio, porque el update devolvería
 * cero filas sin error.
 */
export async function createPendingChange(p: {
  storeId: number
  userId: string
  kind: PendingChangeKind
  payload: PendingChangePayload
  /** A qué entidad aplica. Hoy solo `coupon` lo usa; el resto va sin él. */
  subjectId?: number
}): Promise<{ id: number; code: string; expiresAt: string }> {
  const admin = createAdminClient()

  const supersede = admin
    .from('store_pending_changes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('store_id', p.storeId)
    .eq('kind', p.kind)
    .is('consumed_at', null)

  const { error: supersedeError } =
    p.subjectId === undefined
      ? await supersede.is('subject_id', null)
      : await supersede.eq('subject_id', p.subjectId)

  if (supersedeError) {
    throw new Error(`No se pudo invalidar la solicitud anterior: ${supersedeError.message}`)
  }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString()

  const { data, error } = await admin
    .from('store_pending_changes')
    .insert({
      store_id: p.storeId,
      requested_by: p.userId,
      kind: p.kind,
      subject_id: p.subjectId ?? null,
      payload: p.payload,
      code_hash: hmacSha256(code),
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (error) throw new Error(`No se pudo registrar la solicitud de cambio: ${error.message}`)

  return { id: data.id, code, expiresAt }
}

/**
 * Valida el código y consume la solicitud. Devuelve el payload para que el
 * caller aplique el cambio.
 *
 * La carrera se resuelve en Postgres, no con un `if`, por el mismo motivo que
 * la idempotencia del pedido: dos requests simultáneos con el código correcto
 * pasan los dos por un chequeo en memoria. Son dos escrituras condicionales:
 *
 * 1. `attempts + 1` con las condiciones de vida (no consumida, no vencida, con
 *    intentos). Cero filas ⇒ no hay nada que confirmar. Se incrementa ANTES de
 *    comparar el código: si se incrementara solo al fallar, un atacante que
 *    corta la conexión al ver la respuesta no gastaría intentos.
 * 2. `consumed_at = now()` con `consumed_at is null`. Cero filas ⇒ otro request
 *    ganó la carrera y ya lo aplicó.
 *
 * Los tres motivos de fallo del paso 1 —vencida, ya usada, sin intentos— llevan
 * el MISMO mensaje. Distinguirlos le dice a quien está sondeando en qué estado
 * quedó la solicitud.
 */
export async function consumePendingChange(p: {
  id: number
  storeId: number
  userId: string
  code: string
}): Promise<PendingChange> {
  const admin = createAdminClient()

  // `claim_store_pending_change` y no un `.update()` de PostgREST: PostgREST
  // solo asigna constantes, no sabe escribir `attempts = attempts + 1`, y
  // hacerlo leyendo-sumando-escribiendo desde acá pierde la carrera justo en el
  // caso que el contador tiene que frenar (ver la migración).
  const { data: claimed, error: liveError } = await admin.rpc('claim_store_pending_change', {
    p_id: p.id,
    p_store_id: p.storeId,
    p_user_id: p.userId,
  })

  if (liveError) throw new Error(`No se pudo validar el código: ${liveError.message}`)

  const live = claimed?.[0]
  if (!live) {
    throw new DomainError('Ese código venció o ya se usó. Pedí uno nuevo.', { status: 400, field: 'code' })
  }

  if (!hashesMatch(live.code_hash, hmacSha256(p.code))) {
    const left = MAX_ATTEMPTS - live.attempts
    throw new DomainError(
      left > 0
        ? `El código no coincide. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.`
        : 'El código no coincide y se agotaron los intentos. Pedí uno nuevo.',
      { status: 400, field: 'code' },
    )
  }

  const { data: consumed, error: consumeError } = await admin
    .from('store_pending_changes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', p.id)
    .is('consumed_at', null)
    .select('kind, payload, subject_id')
    .maybeSingle()

  if (consumeError) throw new Error(`No se pudo confirmar el cambio: ${consumeError.message}`)
  if (!consumed) {
    throw new DomainError('Ese código ya se usó.', { status: 409, field: 'code' })
  }

  return {
    id: p.id,
    storeId: p.storeId,
    kind: consumed.kind as PendingChangeKind,
    payload: (consumed.payload ?? {}) as PendingChangePayload,
    subjectId: consumed.subject_id,
  }
}

/**
 * Los datos de una solicitud viva, sin tocar `attempts`. Lo usa el reenvío de
 * código: necesita saber de qué cambio se trata para regenerarlo sin que el
 * dueño tenga que volver a cargar el token de Mercado Pago.
 */
export async function getLivePendingChange(p: {
  id: number
  storeId: number
  userId: string
}): Promise<PendingChange | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('store_pending_changes')
    .select('id, store_id, kind, payload, subject_id')
    .eq('id', p.id)
    .eq('store_id', p.storeId)
    .eq('requested_by', p.userId)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer la solicitud: ${error.message}`)
  if (!data) return null

  return {
    id: data.id,
    storeId: data.store_id,
    kind: data.kind as PendingChangeKind,
    payload: (data.payload ?? {}) as PendingChangePayload,
    subjectId: data.subject_id,
  }
}
