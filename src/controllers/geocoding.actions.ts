'use server'

import { z } from 'zod'
import { toActionResult } from '@/lib/action-result'
import { requireStoreMembership } from '@/models/store.model'
import { getGeocoder, type GeocodeCandidate } from '@/services/geocoding'
import type { ActionResult } from '@/models/types'

/**
 * Buscar la dirección en el mapa.
 *
 * En archivo propio y no en `admin.actions.ts` a propósito: esto no toca la
 * tienda ni escribe nada, solo consulta un servicio externo. Mantenerlo
 * separado también evita que el único punto de la app que habla con un
 * geocodificador quede escondido entre veinte acciones de ABM.
 *
 * Exige membresía igual que cualquier acción del panel. Sin eso, el endpoint
 * es un proxy de geocodificación abierto contra Nominatim que cualquiera puede
 * invocar desde el browser — y el que se queda sin servicio por abuso de la
 * cuota somos nosotros, no quien lo abusa.
 */

const searchSchema = z.object({
  storeId: z.coerce.number().int().positive(),
  query: z.string().trim().min(3, 'Escribí al menos 3 caracteres').max(200),
})

export async function geocodeAddressAction(p: {
  storeId: number
  query: string
}): Promise<ActionResult<{ candidates: GeocodeCandidate[] }>> {
  return toActionResult(
    async () => {
      const { storeId, query } = searchSchema.parse(p)
      await requireStoreMembership(storeId)

      const candidates = await getGeocoder().search(query)
      return { candidates }
    },
    'geocoding.searchAddress',
    { storeId: p.storeId },
  )
}
