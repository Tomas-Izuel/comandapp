import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { signHmacSha256 } from '@/services/crypto/hmac'
import { serverEnv } from '@/lib/env.server'
import { log } from '@/lib/log'
import type { RateLimitBucket, RateLimitDecision } from '@/models/types'

/**
 * Única puerta a `public.rate_limits`. Es un modelo, no un controller: acceso
 * a Postgres y nada más — no arma mensajes de UI ni tira `RateLimitError`. El
 * llamador decide qué hacer con la decisión (ver `RateLimitError` en
 * `src/lib/errors.ts`).
 *
 * SEGURIDAD DEL SUJETO: acá entra el valor CRUDO (email, teléfono, IP) y lo
 * que viaja a Postgres es su HMAC-SHA256 en hex, nunca el valor en claro. Si
 * la tabla guardara el email o el teléfono, un dump la convierte en un índice
 * buscable de todos los clientes del SaaS — un contador de rate limit no es
 * motivo para crear un registro de PII nuevo. Se usa `signHmacSha256` (el
 * mismo HMAC que ya firma los webhooks de POS/Mercado Pago) en vez del
 * `hmacSha256` de `store_pending_changes`: ese devuelve base64url, y acá hace
 * falta hex de 64 chars para que el resultado case con el criterio de
 * aceptación de T2 y con el comentario de la migración
 * (`20260829150000_rate_limits.sql`, "HMAC en hex, NUNCA el valor crudo").
 *
 * NORMALIZACIÓN: `trim().toLowerCase()` sobre el sujeto antes de hashear, sin
 * distinguir bucket. Alcanza para que `"  Foo@Bar.COM "` y `"foo@bar.com"`
 * caigan en el mismo balde (el caso que pide el criterio de aceptación), es
 * inocuo para una IP o un `store_id` numérico, y no reimplementa acá la
 * normalización de teléfono a E.164 —esa lógica ya vive en `phoneSchema`
 * (`src/models/schemas/order.schema.ts`) con las trampas de Córdoba
 * documentadas ahí— así que quien llame con un bucket de teléfono tiene que
 * pasar el valor ya normalizado por ese schema. Ver el dev log de T2 para el
 * detalle de esta decisión.
 */

/** Se usa la misma clave que cifra las credenciales de cobro: ya existe, ya se rota igual, y no suma un secreto nuevo al proyecto. */
function hashSubject(rawSubject: string): string {
  const key = serverEnv().CREDENTIALS_ENCRYPTION_KEY
  if (!key) {
    // Sin la clave no hay forma segura de derivar el sujeto: no hay fallback
    // que guarde el valor en claro. Se trata como cualquier otro fallo de la
    // ruta hacia Postgres (ver el try/catch de abajo).
    throw new Error('CREDENTIALS_ENCRYPTION_KEY no está configurada: no se puede hashear el sujeto del rate limit.')
  }
  const normalized = rawSubject.trim().toLowerCase()
  return signHmacSha256(normalized, key)
}

/**
 * Kill-switch de emergencia. El default es `'true'` (limitando) y vive en el
 * schema de `env.server.ts`: apagar por accidente es peor que prender por
 * accidente.
 */
function isRateLimitingEnabled(): boolean {
  return serverEnv().RATE_LIMIT_ENABLED !== 'false'
}

/**
 * Con el limitador apagado, `remaining` es el límite entero y no `Infinity`:
 * `Infinity` no sobrevive un `JSON.stringify` —sale `null`— y este valor puede
 * terminar en un header o en un body. Un número real y honesto no tiene ese
 * problema.
 */
function unlimited(limit: number): RateLimitDecision {
  return { allowed: true, remaining: limit, retryAfterSeconds: 0 }
}

/**
 * Segundos de `Retry-After` cuando se niega por un fallo de infraestructura
 * (no por haber llegado al límite real). No sale de Postgres —que es
 * justamente lo que falló— así que es un valor fijo y corto: negar una
 * escritura sensible por un hipo transitorio de la base tiene sentido, pero
 * no hay motivo para hacer esperar minutos a quien la pida de nuevo.
 */
const FAIL_CLOSED_RETRY_AFTER_SECONDS = 10

/**
 * Consume una llamada de un balde y devuelve si entra.
 *
 * `onError` decide qué pasa si la RPC no responde (o falta la clave de
 * hasheo): 'allow' dejar pasar sin contar la llamada, 'deny' bloquear como si
 * se hubiera llegado al límite. Default 'allow' para que un bucket nuevo
 * agregado sin pensar no corte una venta. **Quién pasa 'deny' es el
 * llamador (T3/T4), no este modelo: acá no se sabe en qué superficie está.**
 *
 * LA REGLA DEL REPO ("un falso positivo es peor que un falso negativo") ESTÁ
 * CALIBRADA PARA EL CAMINO DE COMPRA, Y AHÍ LA RESPUESTA ES CASI SIEMPRE
 * 'allow' POR UN MOTIVO QUE CONVIENE DEJAR ESCRITO: esos baldes protegen
 * operaciones que TAMBIÉN necesitan Postgres. Crear un pedido, buscar por
 * token, confirmar un cambio de pagos — si la base no responde, la operación
 * de fondo falla igual, así que negar por el rate limiter no cambia nada:
 * es una decisión sin consecuencia real, y 'allow' evita sumar un motivo de
 * rechazo más a un fallo que ya iba a fallar solo.
 *
 * DONDE SÍ TIENE CONSECUENCIA, Y POR ESO SE INVIERTE, ES `magic_link:*`:
 * `signInWithOtp` lo atiende Supabase Auth, un servicio aparte de esta tabla,
 * que puede seguir mandando mails perfectamente aunque la RPC de acá falle.
 * Con 'allow' ahí, un error transitorio de Postgres —agotamiento de
 * conexiones, no hace falta una caída total— abre la puerta a quemar los 30
 * mensajes/hora de TODO el proyecto (ver `magic_link:global` en
 * `rate-limit-policy.ts`), que es justo el ataque que ese balde vino a
 * frenar. El costo de 'deny' ahí es casi nulo: si la base no responde,
 * `/admin` no sirve para nada aunque el magic link entre, así que negarlo no
 * le saca nada a nadie y protege la cuota para cuando la base vuelva.
 *
 * Guía para quien cablee los buckets de `rate-limit-policy.ts` (T3/T4):
 *   - `onError: 'deny'`   → `magic_link:email`, `magic_link:email:day`,
 *                           `magic_link:ip`, `magic_link:global`,
 *                           `payment_change:store`.
 *   - `onError: 'allow'` (default) → todo el resto.
 */
export async function consumeRateLimit(input: {
  bucket: RateLimitBucket
  subject: string
  limit: number
  windowSeconds: number
  onError?: 'allow' | 'deny'
}): Promise<RateLimitDecision> {
  if (!isRateLimitingEnabled()) return unlimited(input.limit)

  const onError = input.onError ?? 'allow'

  try {
    const subjectHash = hashSubject(input.subject)
    const admin = createAdminClient()

    const { data, error } = await admin.rpc('consume_rate_limit', {
      p_bucket: input.bucket,
      p_subject: subjectHash,
      p_window_seconds: input.windowSeconds,
      p_limit: input.limit,
    })

    if (error) throw error

    const row = data?.[0]
    if (!row) throw new Error('consume_rate_limit no devolvió ninguna fila')

    return {
      allowed: row.allowed,
      remaining: Math.max(0, input.limit - row.count),
      retryAfterSeconds: row.retry_after_seconds,
    }
  } catch (err) {
    log.error('rate-limit', `no se pudo evaluar el balde "${input.bucket}"`, err, { onError })

    if (onError === 'deny') {
      return { allowed: false, remaining: 0, retryAfterSeconds: FAIL_CLOSED_RETRY_AFTER_SECONDS }
    }
    // Fail-open: no se cuenta esta llamada contra el límite, así que el
    // "remaining" honesto es el límite entero, no un número inventado.
    return unlimited(input.limit)
  }
}
