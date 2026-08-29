/**
 * Dos clases de error, y la diferencia importa en el borde HTTP.
 *
 * `DomainError` es una condición de negocio que el usuario tiene que ver:
 * "esta tienda no acepta pago al retirar", "ese producto ya no está
 * disponible". Su mensaje es parte de la interfaz.
 *
 * Cualquier otro error es un fallo nuestro —Postgres, red, un bug— y su
 * mensaje NO se muestra: se loguea del lado del servidor y el cliente recibe
 * algo genérico. Un `catch` que devuelve `err.message` sin distinguir termina
 * mandándole al browser el detalle de una constraint de Postgres.
 */

import { log } from '@/lib/log'

export class DomainError extends Error {
  readonly status: number
  /** Campo del formulario al que corresponde, si aplica. */
  readonly field?: string

  constructor(message: string, options?: { status?: number; field?: string }) {
    super(message)
    this.name = 'DomainError'
    this.status = options?.status ?? 400
    this.field = options?.field
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError
}

/**
 * Un límite de uso alcanzado. Es una `DomainError` y no un fallo interno a
 * propósito: el mensaje es interfaz —la persona tiene que entender que esperó
 * poco, no que algo se rompió— y por eso viaja al cliente como los demás.
 *
 * `retryAfterSeconds` sale del balde en Postgres y va tal cual al header
 * `Retry-After`. Un 429 sin ese dato obliga al cliente a adivinar cuándo
 * reintentar, y lo que hace un cliente que adivina es reintentar en loop, que
 * es justo lo que el límite venía a frenar.
 */
export class RateLimitError extends DomainError {
  readonly retryAfterSeconds: number

  constructor(message: string, retryAfterSeconds: number, options?: { field?: string }) {
    super(message, { status: 429, field: options?.field })
    this.name = 'RateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof RateLimitError
}

export type ApiErrorBody = {
  error: string
  field?: string
}

const GENERIC = 'No pudimos procesar el pedido. Probá de nuevo en un momento.'

/**
 * Traduce cualquier excepción a una respuesta segura.
 *
 * `context` va al log del servidor para poder rastrear el fallo real sin que el
 * cliente vea nada de eso.
 */
export function toApiError(err: unknown, context: string): { body: ApiErrorBody; status: number } {
  if (isDomainError(err)) {
    return { body: { error: err.message, ...(err.field ? { field: err.field } : {}) }, status: err.status }
  }

  log.error(context, 'error interno en el borde HTTP', err)
  return { body: { error: GENERIC }, status: 500 }
}

/**
 * Mensaje de validación seguro a partir de un ZodError.
 *
 * Devuelve el mensaje del primer issue y el campo, y **nunca** el array de
 * issues completo: eso expone rutas internas y, con `.strict()`, hasta el
 * nombre de la clave rechazada. Si el issue es de una clave desconocida, ni
 * siquiera se nombra: un cliente legítimo no puede producir eso, así que el
 * detalle solo le sirve a quien está probando el endpoint.
 */
type ZodLikeIssue = { code: string; message: string; path: readonly PropertyKey[] }
type ZodLike = { issues: readonly ZodLikeIssue[] }

/**
 * Acepta el `ZodError` completo además del array de issues.
 *
 * Cada route handler venía adaptando `parsed.error.issues` a mano —con el mismo
 * cast de `path`, copiado— antes de poder llamar acá. El contrato angosto era la
 * causa de la duplicación, así que se ensancha en un solo lugar.
 */
export function zodToApiError(input: ZodLike | readonly ZodLikeIssue[]): {
  body: ApiErrorBody
  status: number
} {
  // `Array.isArray` sobre una union que incluye `readonly T[]` narrowea a
  // `any[]` y contagia `any` a todo lo que sigue. Discriminar por la propiedad
  // conserva los tipos.
  const issues: readonly ZodLikeIssue[] = 'issues' in input ? input.issues : input
  const first = issues[0]
  if (!first) return { body: { error: 'Revisá los datos del pedido' }, status: 400 }

  if (first.code === 'unrecognized_keys') {
    log.error('validation', 'payload con claves desconocidas', undefined, { code: first.code })
    return { body: { error: 'El pedido llegó con un formato inválido' }, status: 400 }
  }

  const field = first.path.filter((p): p is string => typeof p === 'string').at(-1)
  return {
    body: { error: first.message, ...(typeof field === 'string' ? { field } : {}) },
    status: 400,
  }
}
