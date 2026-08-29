'use server'

import { z } from 'zod'
import { requireStoreMembership } from '@/models/store.model'
import { inviteCourier, setCourierActive, resendCourierInvite } from '@/models/courier.model'
import { inviteCourierSchema, type InviteCourierInput } from '@/models/schemas/courier.schema'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'
import { RateLimitError } from '@/lib/errors'
import { toActionResult } from '@/lib/action-result'
import type { ActionResult, InviteCourierResult, RateLimitBucket } from '@/models/types'

/** S-18: `storeId`/`courierId` llegan tipados solo por TypeScript — un Server
 * Action es un endpoint HTTP más. */
const storeIdSchema = z.number().int().positive()
const courierIdSchema = z.number().int().positive()

/**
 * Frase legible en español para el mensaje de un `RateLimitError` (T4).
 * Duplicada (no exportada) en cada `.actions.ts` de esta tarea — ver el
 * comentario largo en `admin.actions.ts` sobre por qué no vive en un lugar
 * compartido.
 */
function humanizeRetryAfter(seconds: number): string {
  if (seconds < 60) return 'unos segundos'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} hora${hours === 1 ? '' : 's'}`
}

/** Consume un balde y tira `RateLimitError` (429, mensaje en interfaz) si ya no queda cupo. */
async function consumeOrThrow(
  bucket: RateLimitBucket,
  subject: string,
  message: (retryAfterSeconds: number) => string,
): Promise<void> {
  const policy = RATE_LIMIT_POLICY[bucket]
  const decision = await consumeRateLimit({ bucket, subject, ...policy })
  if (!decision.allowed) {
    throw new RateLimitError(message(decision.retryAfterSeconds), decision.retryAfterSeconds)
  }
}

/**
 * Devuelve `InviteCourierResult` (no `void`): el repartidor puede quedar
 * creado con `emailSent: false` si Resend falló, y la UI necesita ese dato
 * para ofrecer un reenvío en vez de mostrar "invitado" sin más. Ver el
 * comentario de `inviteCourier` en `courier.model.ts`.
 *
 * El rate limit va ACÁ y no en el modelo (T4): acá ya corrió
 * `requireStoreMembership`, así que no se gasta cupo por una request que ni
 * siquiera está autorizada.
 */
export async function inviteCourierAction(
  storeId: number,
  input: InviteCourierInput,
): Promise<ActionResult<InviteCourierResult>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id, { role: 'owner' })
    const parsed = inviteCourierSchema.parse(input)

    await consumeOrThrow(
      'courier_invite:store',
      String(id),
      (s) => `Ya invitaste demasiados repartidores en la última hora. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
    )
    // Clave = store_id + email (00-architecture.md §5.3): así el tope de
    // invitaciones repetidas a UNA persona no se confunde con el tope general
    // de invitaciones del local.
    await consumeOrThrow(
      'courier_invite:email',
      `${id}:${parsed.email}`,
      (s) => `Ya invitaste a esa persona hace poco. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
    )

    return await inviteCourier(id, parsed)
  }, 'staff.inviteCourier')
}

export async function setCourierActiveAction(
  storeId: number,
  courierId: number,
  isActive: boolean,
): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const member = courierIdSchema.parse(courierId)
    await requireStoreMembership(id, { role: 'owner' })
    await setCourierActive(id, member, isActive)
  }, 'staff.setCourierActive')
}

/**
 * Solo gatea contra `courier_invite:store`, no contra `courier_invite:email`:
 * ese segundo balde existe para frenar invitaciones repetidas a UNA casilla, y
 * acá el email ni siquiera es un parámetro — conseguirlo implicaría repetir en
 * esta acción la misma búsqueda (`store_members` + `auth.admin.getUserById`)
 * que ya hace `resendCourierInvite` en el modelo. El bucket por tienda (10/hora)
 * ya alcanza para el criterio de aceptación de esta acción.
 */
export async function resendCourierInviteAction(storeId: number, courierId: number): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const member = courierIdSchema.parse(courierId)
    await requireStoreMembership(id, { role: 'owner' })

    await consumeOrThrow(
      'courier_invite:store',
      String(id),
      (s) => `Ya invitaste demasiados repartidores en la última hora. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
    )

    await resendCourierInvite(id, member)
  }, 'staff.resendCourierInvite')
}
