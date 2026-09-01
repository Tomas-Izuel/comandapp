import { storeUrl } from '@/lib/urls'
import { describeDiscount } from '@/lib/coupon'
import { firstToken } from './format'
import type { Coupon, StoreCustomer } from '@/models/types'

/**
 * Los DOS mensajes precargados de la Entrega A (00-architecture.md §5.5.1),
 * más el tercero que suma T4B (`buildCustomerCouponMessage`): mandar un cupón
 * puntual, elegido por el dueño desde el menú de `coupon-whatsapp-menu.tsx`.
 * Sin segmento de campaña de por medio a propósito (decisión del dueño: la
 * reactivación —y el cupón puntual— son un mensaje uno a uno, no un envío
 * masivo).
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

/**
 * El tercer mensaje (§5.5.1, T4B): el dueño eligió un cupón `active` del menú
 * de `coupon-whatsapp-menu.tsx` para mandárselo a ESTE cliente puntual — es
 * el único camino por el que un cupón llega a alguien sin gastar cupo de
 * mail, y a 15 mails/día va a ser el más usado.
 *
 * `describeDiscount()` de `src/lib/coupon.ts`: nunca se arma la frase del
 * descuento acá — es la misma función que usa el panel y el mail de campaña.
 */
export function buildCustomerCouponMessage(
  customer: StoreCustomer,
  storeName: string,
  storeSlug: string,
  coupon: Coupon,
): string {
  const nombre = firstToken(customer.displayName)
  const link = storeUrl(storeSlug, '/')
  return `¡Hola ${nombre}! Desde ${storeName} te dejamos un cupón: ${coupon.code}, ${describeDiscount(coupon)} de descuento. Lo cargás en el checkout de ${link}`
}
