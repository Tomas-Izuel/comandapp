/**
 * Helpers puros de presentación del padrón. Locales a esta carpeta a
 * propósito: `daysSinceLastOrder` ya llega DERIVADO desde
 * `store_customer_directory` (ver el comentario en `models/types.ts`), así
 * que lo único que falta acá es convertirlo a la frase que lee el dueño — no
 * hay nada de fecha genérica que valga la pena sumar a `src/lib/dates.ts`
 * por esto, y ese archivo no es de este slice.
 */

/** La columna "Última compra" de §5.5: la única señal de churn de la tabla. */
export function relativeLastOrderLabel(daysSinceLastOrder: number | null): string {
  if (daysSinceLastOrder === null) return 'Nunca compró'
  if (daysSinceLastOrder === 0) return 'Hoy'
  if (daysSinceLastOrder === 1) return 'Ayer'
  return `Hace ${daysSinceLastOrder} días`
}

/**
 * `{nombre}` en los mensajes de WhatsApp es SOLO el primer token de
 * `displayName` (§5.5.1): la gente escribe "Juan Pérez" y nadie saluda por
 * apellido.
 */
export function firstToken(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName
}
