/**
 * Puerto de geocodificación.
 *
 * Existe por la misma razón que `notifier.port.ts` y `PosAdapter`: el proveedor
 * es una decisión que puede cambiar (hoy Nominatim, mañana Google si hace falta
 * mejor cobertura y hay presupuesto) y el resto de la app no tiene por qué
 * enterarse.
 *
 * El contrato dice explícitamente que el resultado es una PROPUESTA. Nadie lo
 * guarda directo: en direcciones argentinas —calles repetidas entre
 * localidades, numeraciones que el geocoder no conoce, barrios cerrados— el
 * resultado cae a cuadras de distancia con frecuencia. El dueño confirma
 * arrastrando el pin y eso es lo que se persiste.
 */

export type GeocodeCandidate = {
  latitude: number
  longitude: number
  /** Cómo entendió el proveedor la dirección. Se muestra para que el dueño pueda descartar un match obviamente equivocado. */
  label: string
}

export interface Geocoder {
  /** Devuelve como mucho `limit` candidatos, el mejor primero. Lista vacía si no encontró nada: no es un error. */
  search(query: string, limit?: number): Promise<GeocodeCandidate[]>
}
