'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { DomainError, RateLimitError } from '@/lib/errors'
import { toActionResult } from '@/lib/action-result'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'
import {
  createStoreWithOwner,
  setStoreStatus,
  getPlatformStoreById,
  resendOwnerInvite,
  requirePlatformAdmin,
} from '@/models/platform.model'
import type { CreateStoreInput } from '@/models/schemas/platform.schema'
import type { ActionResult, RateLimitBucket, StoreStatus } from '@/models/types'
import type { CreateStoreResult } from '@/controllers/platform.controller'

/** S-18: los `storeId` llegan tipados `number` solo por TypeScript. */
const storeIdSchema = z.number().int().positive()

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

const ownerInviteAdminMessage = (s: number) =>
  `Ya diste de alta o reenviaste demasiadas invitaciones esta hora. Probá de nuevo en ${humanizeRetryAfter(s)}.`

/**
 * IP y user agent reales del navegador que disparó la acción, para
 * `platform_audit_log` (S-14). Antes `recordAudit` recibía `ip` opcional y
 * NINGÚN caller lo pasaba; para un backoffice que puede suspender el local de
 * otra persona, la IP es lo primero que se pide en un incidente.
 */
async function auditContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  return {
    ip: forwarded?.split(',')[0]?.trim() || null,
    userAgent: h.get('user-agent'),
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/backoffice/login')
}

/**
 * `owner_invite:store` no se puede consumir acá todavía: la tienda no existe
 * hasta que `createStoreWithOwner` la crea. La superficie de abuso real en
 * este camino es "un admin da de alta tiendas (= invitaciones) en ráfaga", y
 * eso lo cubre `owner_invite:admin`, keyed por el admin de la sesión.
 * `resendOwnerInviteAction` es quien consume `owner_invite:store`, una vez
 * que el `store_id` ya existe.
 */
export async function createStoreAction(input: CreateStoreInput): Promise<CreateStoreResult> {
  return toActionResult(async () => {
    const { userId } = await requirePlatformAdmin()
    await consumeOrThrow('owner_invite:admin', userId, ownerInviteAdminMessage)

    const audit = await auditContext()
    const { storeId } = await createStoreWithOwner(input, audit)
    revalidatePath('/backoffice/tiendas')
    return { storeId }
  }, 'platform.createStore')
}

/**
 * Suspender apaga la web pública de otra persona: exige escribir el slug
 * exacto como confirmación, revisado acá antes de tocar nada. No es
 * redundante con la validación del model — esa valida la FORMA del status,
 * esta valida que quien apreta el botón leyó qué tienda es.
 */
export async function setStoreStatusAction(
  storeId: number,
  status: StoreStatus,
  slugConfirmation: string,
): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)

    const store = await getPlatformStoreById(id)
    if (!store) throw new DomainError('No se encontró la tienda', { status: 404 })
    if (store.slug !== slugConfirmation.trim().toLowerCase()) {
      throw new DomainError('El slug escrito no coincide con el de la tienda', {
        status: 400,
        field: 'slugConfirmation',
      })
    }

    const audit = await auditContext()
    await setStoreStatus(id, status, audit)
    revalidatePath('/backoffice/tiendas')
    revalidatePath(`/backoffice/tiendas/${id}`)
  }, 'platform.setStoreStatus')
}

/**
 * Reenvía la invitación al panel desde el detalle de la tienda. `storeIdSchema`
 * valida la FORMA (S-18: `storeId` llega tipado `number` solo por TypeScript);
 * la existencia de la tienda y del dueño las verifica `resendOwnerInvite` en
 * el model, junto con `requirePlatformAdmin()`.
 */
export async function resendOwnerInviteAction(storeId: number): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const { userId } = await requirePlatformAdmin()

    await consumeOrThrow(
      'owner_invite:store',
      String(id),
      (s) => `Ya reenviaste demasiadas invitaciones para esta tienda. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
    )
    await consumeOrThrow('owner_invite:admin', userId, ownerInviteAdminMessage)

    const audit = await auditContext()
    await resendOwnerInvite(id, audit)
  }, 'platform.resendOwnerInvite')
}
