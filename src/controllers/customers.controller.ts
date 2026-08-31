import 'server-only'

import { requireStoreMembership } from '@/models/store.model'
import { getCustomerDirectory } from '@/models/customer.model'
import type { CustomerDirectory } from '@/models/types'

/**
 * Lectura de `/admin/clientes` (T1A). Nombre y forma fijados por el hilo
 * principal para calcar `getBankAccountStatus`/`getStoreScheduleForAdmin`
 * (`admin.controller.ts`): recibe un `storeId` ya resuelto por la page —que
 * hace su propio gate de sesión, mismo patrón que
 * `src/app/admin/(app)/repartidores/page.tsx` con `resolveStaffSession()`—
 * y NO vuelve a resolver de qué tienda se trata ni quién es el usuario desde
 * cero.
 *
 * Lo que SÍ hace, y por eso el controller no es indirección sin valor: repite
 * `requireStoreMembership(storeId, { role: 'owner' })` como defensa en
 * profundidad, igual que las dos funciones que calca. `CLAUDE.md` es
 * explícito ("cada page y server action de /admin y /backoffice verifica de
 * nuevo") — confiar en que la page de arriba ya filtró sería apoyar la
 * seguridad de esta lectura en un redirect ajeno. La RPC
 * `store_customer_directory` vuelve a verificar `is_store_owner` una tercera
 * vez adentro de Postgres, que es la defensa real; este chequeo es la que da
 * un `DomainError` legible en vez de un `42501` crudo si algo llama a este
 * controller sin pasar por la page.
 */
export async function getCustomerDirectoryForStore(storeId: number): Promise<CustomerDirectory> {
  await requireStoreMembership(storeId, { role: 'owner' })
  return getCustomerDirectory(storeId)
}
