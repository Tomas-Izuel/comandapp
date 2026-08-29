import 'server-only'

import { z } from 'zod'
import { log } from '@/lib/log'
import type { Geocoder, GeocodeCandidate } from './geocoder.port'

/**
 * Nominatim (OpenStreetMap). Sin API key, sin cuenta, sin facturación.
 *
 * Corre SOLO en el servidor, y no es una preferencia de arquitectura: la
 * política de uso de Nominatim exige identificar la aplicación con un
 * `User-Agent` propio, y un `fetch` desde el browser no puede setear ese
 * header. Además, llamarlo desde el cliente mandaría la IP del dueño a un
 * tercero por cada tecla.
 *
 * El límite de la política es 1 request por segundo. Acá eso alcanza de sobra:
 * el geocodificador solo se invoca cuando alguien toca "Buscar" en Ajustes —
 * un dueño, cada tanto—, nunca mientras tipea.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'burger-shop/1.0 (panel de administración de locales)'
const TIMEOUT_MS = 5_000

/**
 * Solo los tres campos que se usan. Un `safeParse` por elemento y no un cast:
 * es una respuesta de un tercero, y `lat`/`lon` vienen como STRING en el JSON
 * de Nominatim — un cast dejaría pasar strings donde el dominio espera número
 * y el pin terminaría en `NaN, NaN`.
 */
const nominatimResultSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  display_name: z.string().min(1),
})

export function createNominatimGeocoder(): Geocoder {
  return {
    async search(query: string, limit = 5): Promise<GeocodeCandidate[]> {
      const trimmed = query.trim()
      if (trimmed.length < 3) return []

      const url = new URL(NOMINATIM_URL)
      url.searchParams.set('q', trimmed)
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 10)))
      // Sesga hacia Argentina sin cerrar la puerta: un local en la frontera o
      // una prueba con una dirección de afuera sigue funcionando, pero
      // "Av. Colón 1234" deja de resolver a Colón, Panamá.
      url.searchParams.set('countrycodes', 'ar')
      url.searchParams.set('addressdetails', '0')

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // El resultado de una dirección no cambia de un minuto al otro, y
          // esto ahorra pegarle al servicio si el dueño toca "Buscar" dos veces.
          next: { revalidate: 86_400 },
        })

        if (!response.ok) {
          log.error('geocoding.nominatim', 'respuesta no OK del geocodificador', undefined, {
            status: response.status,
          })
          return []
        }

        const body: unknown = await response.json()
        if (!Array.isArray(body)) return []

        return body.flatMap((row): GeocodeCandidate[] => {
          const parsed = nominatimResultSchema.safeParse(row)
          if (!parsed.success) return []
          return [{ latitude: parsed.data.lat, longitude: parsed.data.lon, label: parsed.data.display_name }]
        })
      } catch (err) {
        // Timeout, DNS, el servicio caído. No poder proponer un punto no es un
        // error del dueño ni rompe nada: puede arrastrar el pin a mano.
        log.error('geocoding.nominatim', 'no se pudo geocodificar la dirección', err)
        return []
      }
    },
  }
}
