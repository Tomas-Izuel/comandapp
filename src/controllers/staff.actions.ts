'use server'

import { z } from 'zod'
import { requireStoreMembership } from '@/models/store.model'
import { inviteCourier, setCourierActive, resendCourierInvite } from '@/models/courier.model'
import { inviteCourierSchema, type InviteCourierInput } from '@/models/schemas/courier.schema'
import { toActionResult } from '@/lib/action-result'
import type { ActionResult, InviteCourierResult } from '@/models/types'

/** S-18: `storeId`/`courierId` llegan tipados solo por TypeScript — un Server
 * Action es un endpoint HTTP más. */
const storeIdSchema = z.number().int().positive()
const courierIdSchema = z.number().int().positive()

/**
 * Devuelve `InviteCourierResult` (no `void`): el repartidor puede quedar
 * creado con `emailSent: false` si Resend falló, y la UI necesita ese dato
 * para ofrecer un reenvío en vez de mostrar "invitado" sin más. Ver el
 * comentario de `inviteCourier` en `courier.model.ts`.
 */
export async function inviteCourierAction(
  storeId: number,
  input: InviteCourierInput,
): Promise<ActionResult<InviteCourierResult>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id, { role: 'owner' })
    const parsed = inviteCourierSchema.parse(input)
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

export async function resendCourierInviteAction(storeId: number, courierId: number): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const member = courierIdSchema.parse(courierId)
    await requireStoreMembership(id, { role: 'owner' })
    await resendCourierInvite(id, member)
  }, 'staff.resendCourierInvite')
}
