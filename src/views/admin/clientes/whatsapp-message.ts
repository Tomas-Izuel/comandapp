import { storeUrl } from '@/lib/urls'
import { firstToken } from './format'
import type { StoreCustomer } from '@/models/types'

/**
 * Los DOS mensajes precargados de la Entrega A (00-architecture.md §5.5.1).
 * El tercero —mandar un cupón puntual— lo suma T4B cuando el menú de
 * cupones exista en esta misma fila; hasta entonces el botón de WhatsApp
 * elige entre estos dos según lo que la fila ya sabe, sin segmento de
 * campaña de por medio (decisión del dueño: la reactivación es un mensaje
 * uno a uno, no un envío masivo).
 *
 * Cuatro reglas duras, y las cuatro se respetan acá:
 * 1. Nunca la plata del cliente — `totalSpentCents` no aparece en ningún
 *    template, aunque la fila lo tenga a mano.
 * 2. Nunca un hecho que no tenemos (nada de "sabemos que te gustan las
 *    dobles": el producto no registra eso).
 * 3. Suena a persona: rioplatense, sin "usted", sin mayúsculas de asunto.
 * 4. Arranca editable: esto es el PREFILL que cae en el campo de texto de
 *    `wa.me`, no lo que se manda — el dueño lo lee y lo retoca antes.
 */
export function buildCustomerWhatsappMessage(customer: StoreCustomer, storeName: string, storeSlug: string): string {
  const nombre = firstToken(customer.displayName)

  // Disparador de reactivación: 30 días o más sin comprar (§5.5.1). Es el
  // único de los dos casos que necesita un link, porque el objetivo es que
  // vuelva a mirar la carta.
  if (customer.daysSinceLastOrder !== null && customer.daysSinceLastOrder >= 30) {
    const link = storeUrl(storeSlug, '/')
    return `¡Hola ${nombre}! Somos de ${storeName}. Hace un rato que no te vemos por acá — si te dan ganas, la carta está en ${link}`
  }

  // Default: un saludo simple, sin inventar contexto que no tenemos.
  return `¡Hola ${nombre}! Somos de ${storeName}.`
}
