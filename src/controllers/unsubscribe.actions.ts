'use server'

import { headers } from 'next/headers'
import { DomainError, RateLimitError } from '@/lib/errors'
import { toActionResult } from '@/lib/action-result'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'
import { findCustomerByUnsubscribeToken, optOutByToken } from '@/models/customer.model'
import type { ActionResult, UnsubscribeTarget } from '@/models/types'

/**
 * `/baja/[token]`, ruta pública de nivel raíz (§5.12.2 del plan). Lo único que
 * autoriza acá es el token — mismo modelo que `/pedido/[token]`. Sin sesión,
 * sin `requireStoreMembership`: cualquiera con el link puede darse de baja a
 * SÍ MISMO (el que recibió el mail), nunca a otro cliente ni ver nada de otra
 * tienda.
 *
 * `humanizeRetryAfter` está duplicada a propósito, mismo criterio que
 * `admin.actions.ts`/`platform.actions.ts`/`staff.actions.ts`: un `.actions.ts`
 * con `'use server'` en la primera línea solo puede EXPORTAR funciones async,
 * así que este helper no puede vivir en un módulo compartido que las cuatro
 * importen como export.
 */
function humanizeRetryAfter(seconds: number): string {
  if (seconds < 60) return 'unos segundos'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} hora${hours === 1 ? '' : 's'}`
}

async function clientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * Balde `unsubscribe:ip` (fail-open): `/baja/[token]` recibe tokens desde un
 * endpoint público, o sea superficie de sondeo del espacio de tokens. Laxo a
 * propósito —mismo criterio que `receipt:ip`— porque el CGNAT móvil argentino
 * hace que varios clientes reales compartan IP de salida, y el peor caso de
 * dejar pasar de más es mucho menos grave que bloquear a alguien que solo
 * quiere darse de baja de un mail que recibió.
 */
async function consumeUnsubscribeBudget(): Promise<void> {
  const policy = RATE_LIMIT_POLICY['unsubscribe:ip']
  const decision = await consumeRateLimit({
    bucket: 'unsubscribe:ip',
    subject: await clientIp(),
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
  })
  if (!decision.allowed) {
    throw new RateLimitError(
      `Estás haciendo esto muy seguido. Esperá ${humanizeRetryAfter(decision.retryAfterSeconds)} y volvé a intentar.`,
      decision.retryAfterSeconds,
    )
  }
}

/**
 * Lo que la página de `/baja/[token]` necesita para el paso de `GET`: a qué
 * local pertenece el token y si ya estaba dado de baja, para no ofrecer un
 * botón que no hace nada. RFC 8058 exige que el `GET` NO dé de baja por sí
 * solo —los escáneres de link de los clientes de mail hacen GET de todo—, así
 * que esta acción es de solo lectura.
 */
export async function getUnsubscribeTargetAction(token: string): Promise<ActionResult<UnsubscribeTarget>> {
  return toActionResult(async () => {
    await consumeUnsubscribeBudget()
    const target = await findCustomerByUnsubscribeToken(token)
    if (!target) throw new DomainError('Este link de baja no es válido', { status: 404 })
    return target
  }, 'unsubscribe.getTarget')
}

/**
 * La baja en sí, disparada por el botón de la página (el `POST` de RFC 8058).
 * Idempotente: confirmar dos veces no cambia nada y no es un error — un link
 * de mail se puede abrir más de una vez.
 */
export async function confirmUnsubscribeAction(token: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await consumeUnsubscribeBudget()
    await optOutByToken(token)
  }, 'unsubscribe.confirm')
}
