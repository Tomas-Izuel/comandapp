import { formatCentsCompact } from '@/lib/money'
import type { CourierAvailability, DeliveryQuote, StoreDelivery } from '@/models/types'

/**
 * La aritmética del envío propio.
 *
 * Puro y sin `server-only` a propósito: el formulario de Ajustes muestra "así
 * se ve" sin un round-trip, y el servidor usa exactamente la misma función para
 * cobrar. Dos implementaciones del mismo cálculo es cómo el cliente termina
 * viendo un número y pagando otro.
 *
 * Acá no se consulta nada: la disponibilidad de repartidores llega como
 * argumento. Eso es lo que mantiene esto testeable y fuera de `priceCart`,
 * que valoriza el carrito contra la base y no tiene por qué saber si el pedido
 * se retira o se envía.
 */

/** El envío es gratis a partir de `freeFromCents`. 0 = nunca gratis. */
export function deliveryFeeFor(delivery: StoreDelivery, subtotalCents: number): number {
  if (!delivery.enabled) return 0
  if (delivery.freeFromCents > 0 && subtotalCents >= delivery.freeFromCents) return 0
  return delivery.feeCents
}

/**
 * Minutos de viaje según la carga.
 *
 * Con todos los repartidores en la calle el próximo pedido espera a que
 * alguno vuelva, así que el local configura un segundo número para ese caso.
 */
export function deliveryMinutesFor(delivery: StoreDelivery, freeCouriers: number): number {
  return freeCouriers > 0 ? delivery.minutes : delivery.busyMinutes
}

/**
 * El bloque completo que el checkout necesita para pintar la elección.
 *
 * El orden de las reglas de disponibilidad importa: el primero que pega es el
 * mensaje que ve el cliente, y va de lo más estructural a lo más circunstancial.
 *
 * `allCouriersBusy` NUNCA apaga `available`. Es una decisión de producto
 * explícita: se avisa y se deja pedir. Un repartidor puede liberarse en cinco
 * minutos y bloquear la venta cuesta más que la demora.
 */
export function buildDeliveryQuote(params: {
  delivery: StoreDelivery
  subtotalCents: number
  availability: CourierAvailability
  currency: string
}): DeliveryQuote {
  const { delivery, subtotalCents, availability, currency } = params

  const feeCents = deliveryFeeFor(delivery, subtotalCents)
  const missingForFreeCents =
    delivery.freeFromCents > 0 ? Math.max(0, delivery.freeFromCents - subtotalCents) : 0
  const missingForMinimumCents = Math.max(0, delivery.minOrderCents - subtotalCents)
  const allCouriersBusy = availability.activeCouriers > 0 && availability.freeCouriers === 0

  const base = {
    enabled: delivery.enabled,
    feeCents,
    freeFromCents: delivery.freeFromCents,
    missingForFreeCents,
    minOrderCents: delivery.minOrderCents,
    missingForMinimumCents,
    minutesToAdd: deliveryMinutesFor(delivery, availability.freeCouriers),
    allCouriersBusy,
    totalWithDeliveryCents: subtotalCents + feeCents,
  }

  // El local no hace envíos: la opción ni se dibuja, así que no hay motivo que
  // explicar. Un "no disponible" sobre algo que el local nunca ofreció es ruido.
  if (!delivery.enabled) {
    return { ...base, available: false, unavailableReason: null }
  }

  // Activó el envío pero todavía no invitó a nadie. Es un estado de onboarding
  // real —el toggle y la primera invitación son dos pasos— y el cliente merece
  // saber por qué la opción está apagada.
  if (availability.activeCouriers === 0) {
    return {
      ...base,
      available: false,
      unavailableReason: 'Este local todavía no tiene repartidores disponibles',
    }
  }

  if (missingForMinimumCents > 0) {
    return {
      ...base,
      available: false,
      unavailableReason: `Para pedir con envío el mínimo es ${formatCentsCompact(delivery.minOrderCents, currency)}. Te faltan ${formatCentsCompact(missingForMinimumCents, currency)}.`,
    }
  }

  return { ...base, available: true, unavailableReason: null }
}

/**
 * El link que abre la app de navegación del repartidor, en modo vehículo.
 *
 * Solo la calle y número, más las entre-calles si las hay: `unit` ("3º B") y
 * `notes` ("portón negro") no son geocodificables y meterlos en el destino hace
 * que Maps no encuentre nada. El portal los muestra aparte, en grande, que es
 * lo que el repartidor necesita leer cuando ya llegó.
 *
 * Se arma en el SERVIDOR y viaja lista: es un dato del pedido, no una decisión
 * de la vista.
 */
export function navigationUrlFor(addressLine: string, storeAddress: string | null): string {
  // La dirección del local desambigua la ciudad: "Colón 1234" existe en medio
  // país, y Maps sin contexto elige mal.
  const city = storeAddress?.split(',').slice(1).join(',').trim()
  const destination = city ? `${addressLine}, ${city}` : addressLine
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
}
