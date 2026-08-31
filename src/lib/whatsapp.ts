/**
 * Arma el deep link `https://wa.me/...` a partir de un teléfono ya
 * normalizado a E.164. Puro y sin `server-only` a propósito: los tres
 * consumidores (`order-card.tsx`, `transfer-tray.tsx`,
 * `history-list.tsx`, todos en `views/admin/`) son Client Components que ya
 * reciben el teléfono en las props — no hay nada que resolver en el
 * servidor para construir esta URL.
 *
 * `wa.me` no acepta el `+` del E.164 ni separadores: solo dígitos. Antes de
 * este módulo, ese `replace(/\D/g, '')` estaba escrito a mano en tres
 * lugares (acá, `transfer-tray.tsx` y `store-dock.tsx` de la vitrina); con
 * un cuarto call site sumándose en esta misma tanda (T6), la duplicación ya
 * no se justifica. `store-dock.tsx` queda afuera de esta extracción porque
 * no es dueño exclusivo de este slice — sigue construyendo el link a mano,
 * es candidato a adoptar este helper el día que alguien lo toque.
 */
export function whatsappHref(phoneE164: string, text?: string): string {
  const digits = phoneE164.replace(/\D/g, '')
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`
}
