import 'server-only'

import { z } from 'zod'
import { CONFLICT_FIELD } from '@/lib/conflict'
import { isDomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import type { ActionResult } from '@/models/types'

/**
 * La única traducción excepción → `ActionResult`.
 *
 * Había cuatro copias de esta función (una por archivo de acciones) con TRES
 * mensajes genéricos distintos para el mismo caso y dos formas de aplanar un
 * `ZodError`. La próxima regla transversal —loguear con request id, tratar el
 * 409 distinto— habría que recordarla en cuatro lugares.
 *
 * Este archivo NO lleva `'use server'` a propósito: un módulo de acciones solo
 * puede exportar funciones async, así que los helpers viven afuera y se
 * importan. Lo hace `server-only` en cambio, porque nada de esto tiene sentido
 * en el browser.
 */

const GENERIC = 'No pudimos procesar la operación. Probá de nuevo en un momento.'

function fromZod(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const field = issue.path.filter((p) => typeof p === 'string').at(-1)
    const key = typeof field === 'string' ? field : '_'
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
  }

  return {
    ok: false,
    // El primer mensaje es el que se muestra arriba del formulario; el resto
    // queda por campo para que el input correcto pueda marcarse.
    error: error.issues[0]?.message ?? 'Revisá los datos del formulario',
    fieldErrors,
  }
}

/**
 * Corre la operación y traduce cualquier salida a un `ActionResult` seguro.
 *
 * - `DomainError`: su mensaje ES la interfaz, se muestra tal cual. Si además es
 *   un 409, se marca con `CONFLICT_FIELD`.
 * - `ZodError`: mensajes por campo, que es lo que un formulario necesita.
 * - Cualquier otra cosa: es un fallo nuestro. Se loguea con contexto y el
 *   cliente recibe algo genérico — nunca el mensaje crudo de Postgres.
 */
export async function toActionResult<T>(
  run: () => Promise<T>,
  context: string,
  fields?: { storeId?: number | null; orderId?: number | null },
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (err) {
    if (err instanceof z.ZodError) return fromZod(err)

    if (isDomainError(err)) {
      return {
        ok: false,
        error: err.message,
        ...(err.status === 409
          ? { fieldErrors: { [CONFLICT_FIELD]: [err.message] } }
          : err.field
            ? { fieldErrors: { [err.field]: [err.message] } }
            : {}),
      }
    }

    log.error(context, 'la acción falló', err, fields)
    return { ok: false, error: GENERIC }
  }
}
