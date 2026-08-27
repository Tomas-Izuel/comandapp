'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { toActionResult } from '@/lib/action-result'
import { createStoreWithOwner, setStoreStatus, getPlatformStoreById, resendOwnerInvite } from '@/models/platform.model'
import type { CreateStoreInput } from '@/models/schemas/platform.schema'
import type { ActionResult, StoreStatus } from '@/models/types'
import type { CreateStoreResult } from '@/controllers/platform.controller'

/** S-18: los `storeId` llegan tipados `number` solo por TypeScript. */
const storeIdSchema = z.number().int().positive()

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

export async function createStoreAction(input: CreateStoreInput): Promise<CreateStoreResult> {
  return toActionResult(async () => {
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
    const audit = await auditContext()
    await resendOwnerInvite(id, audit)
  }, 'platform.resendOwnerInvite')
}
