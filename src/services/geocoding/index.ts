import 'server-only'

import { createNominatimGeocoder } from './nominatim.adapter'
import type { Geocoder } from './geocoder.port'

export type { Geocoder, GeocodeCandidate } from './geocoder.port'

let cached: Geocoder | null = null

/**
 * Un solo proveedor por ahora. La forma de fábrica se mantiene igual que en
 * `services/payments` y `services/notifications` para que cambiarlo sea una
 * línea acá y nada más — es la misma razón por la que existe el puerto.
 */
export function getGeocoder(): Geocoder {
  cached ??= createNominatimGeocoder()
  return cached
}
