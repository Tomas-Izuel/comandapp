import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { StoreBankAccount, StoreBankAccountAdmin } from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

/**
 * `store_bank_accounts`: el CBU/CVU/alias del local, más lo que NUNCA sale al
 * borde público (`holder_tax_id`, `holder_match`, `checked_at`).
 *
 * Cero grants de INSERT/UPDATE/DELETE para nadie que no sea `service_role`
 * (T0): toda escritura de acá es admin client, y NINGUNA función de este
 * archivo verifica permisos — eso es del caller, igual que `markPaidInStore`
 * (`order.model.ts`). Todo camino de escritura pasa por
 * `requireStoreMembership(storeId, { role: 'owner' })` en `admin.actions.ts`,
 * y el cambio de CBU/alias además por el código de 6 dígitos.
 */

type BankAccountRow = Database['public']['Tables']['store_bank_accounts']['Row']

function toAdminBankAccount(row: BankAccountRow): StoreBankAccountAdmin {
  return {
    cbu: row.cbu,
    alias: row.alias,
    holderName: row.holder_name,
    bankName: row.bank_name,
    holderTaxId: row.holder_tax_id,
    isActive: row.is_active,
    holderMatch: row.holder_match as StoreBankAccountAdmin['holderMatch'],
    checkedAt: row.checked_at,
  }
}

/**
 * La cuenta PÚBLICA: exactamente las cinco columnas con `grant select` para
 * `anon`/`authenticated` (`store_id` + estas cuatro). Cliente de SESIÓN, no
 * admin — la policy de RLS (`is_active` y la tienda `active`) es la que
 * decide si la fila existe para este lector.
 *
 * `select('*')` acá daría `permission denied`: el grant es por columna, no
 * por tabla (00-architecture.md §5.2). Es exactamente lo que se rompe si
 * alguien "simplifica" a `*` — no lo hagas.
 */
export async function getPublicBankAccount(storeId: number): Promise<StoreBankAccount | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('store_bank_accounts')
    .select('store_id, cbu, alias, holder_name, bank_name')
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer la cuenta bancaria: ${error.message}`)
  if (!data) return null

  return { cbu: data.cbu, alias: data.alias, holderName: data.holder_name, bankName: data.bank_name }
}

/**
 * La misma cuenta con todo lo que el panel del dueño necesita, incluido lo
 * que nunca sale al borde. Cliente ADMIN: la tabla no tiene ninguna policy de
 * SELECT para `authenticated` (T0), así que el permiso lo resuelve el caller
 * (`requireStoreMembership`), no RLS — igual que `getPaymentConnectionStatus`
 * en `admin.controller.ts`.
 */
export async function getBankAccountForAdmin(storeId: number): Promise<StoreBankAccountAdmin | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('store_bank_accounts').select('*').eq('store_id', storeId).maybeSingle()

  if (error) throw new Error(`No se pudo leer la cuenta bancaria: ${error.message}`)
  if (!data) return null

  return toAdminBankAccount(data)
}

/**
 * Lo que hace falta para reemplazar la cuenta entera. `null` en vez de
 * `undefined` en cada campo opcional a propósito: es lo que va directo a la
 * fila de Postgres, y `BankAccountInput` (schema) usa `undefined` para "no
 * cargado" porque así es como Zod maneja un campo `.optional()` — la
 * conversión la hace el caller (`admin.actions.ts`) al armar este objeto.
 */
export type BankAccountWrite = {
  cbu: string | null
  alias: string | null
  holderName: string
  holderTaxId: string | null
  bankName: string | null
  holderMatch: 'match' | 'mismatch' | 'unavailable' | null
  checkedAt: string | null
}

/**
 * Alta o reemplazo completo de la cuenta. Se llama SIEMPRE desde
 * `confirmPendingChangeAction`, o sea detrás del código de 6 dígitos —
 * nunca directo desde una acción que solo pidió el cambio.
 *
 * `is_active: true` SIEMPRE, incluso si la fila ya existía y estaba apagada:
 * cambiar de CBU con el código es "un alta" (00-architecture.md §5.11) — el
 * dueño que confirma un cambio de cuenta con el segundo factor está pidiendo
 * que esa cuenta vuelva a ser la que cobra, no dejándola como estaba.
 */
export async function upsertBankAccount(storeId: number, row: BankAccountWrite): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('store_bank_accounts').upsert(
    {
      store_id: storeId,
      cbu: row.cbu,
      alias: row.alias,
      holder_name: row.holderName,
      holder_tax_id: row.holderTaxId,
      bank_name: row.bankName,
      holder_match: row.holderMatch,
      checked_at: row.checkedAt,
      is_active: true,
    },
    { onConflict: 'store_id' },
  )

  if (error) throw new Error(`No se pudo guardar la cuenta bancaria: ${error.message}`)
}

/**
 * Apagar o prender el medio de pago. NO pide código (00-architecture.md
 * §5.11): el código protege el DESTINO de la plata, y esto no lo cambia —
 * solo la disponibilidad del método, una decisión que el dueño tiene derecho
 * a tomar rápido y sin esperar un mail.
 */
export async function setBankAccountActive(storeId: number, isActive: boolean): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('store_bank_accounts').update({ is_active: isActive }).eq('store_id', storeId)

  if (error) throw new Error(`No se pudo actualizar el estado de la cuenta bancaria: ${error.message}`)
}

/** Igual que apagar: no pide código. Borrar la fila apaga `transfer_payment_enabled` por el trigger (T0). */
export async function deleteBankAccount(storeId: number): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('store_bank_accounts').delete().eq('store_id', storeId)

  if (error) throw new Error(`No se pudo borrar la cuenta bancaria: ${error.message}`)
}
