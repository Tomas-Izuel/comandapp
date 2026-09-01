'use server'

import { revalidatePath } from 'next/cache'
import { requireStoreMembership } from '@/models/store.model'
import { updateCustomerNotes, setCustomerOptOut } from '@/models/customer.model'
import { storeIdSchema, customerIdSchema, customerNotesSchema } from '@/models/schemas/customer.schema'
import { toActionResult } from '@/lib/action-result'
import type { ActionResult } from '@/models/types'

/**
 * Las dos acciones del dueño sobre el padrón de `/admin/clientes` (T1A):
 * editar la nota interna y dar de baja/alta a mano un cliente de las promos.
 *
 * Cada una repite `requireStoreMembership(storeId, { role: 'owner' })`
 * explícito: `customer.model.ts` no chequea permiso —solo escribe con el
 * cliente admin y `store_id` explícito— así que el gate vive acá, igual que
 * `updateStoreProfileAction` en `admin.actions.ts`.
 */

export async function updateCustomerNotesAction(storeId: number, customerId: number, notes: string): Promise<ActionResult<void>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      await requireStoreMembership(id, { role: 'owner' })
      const parsedCustomerId = customerIdSchema.parse(customerId)
      const parsedNotes = customerNotesSchema.parse(notes)
      await updateCustomerNotes(id, parsedCustomerId, parsedNotes)
      revalidatePath('/admin/clientes')
    },
    'customers.updateNotes',
    { storeId },
  )
}

export async function setCustomerOptOutAction(storeId: number, customerId: number, optedOut: boolean): Promise<ActionResult<void>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      await requireStoreMembership(id, { role: 'owner' })
      const parsedCustomerId = customerIdSchema.parse(customerId)
      await setCustomerOptOut(id, parsedCustomerId, optedOut)
      revalidatePath('/admin/clientes')
    },
    'customers.setOptOut',
    { storeId },
  )
}
