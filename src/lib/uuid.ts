/**
 * UUID v4 para el browser, sin depender de contexto seguro.
 *
 * `crypto.randomUUID()` **solo existe en secure context** (HTTPS o
 * `localhost`). Abrir la app desde un celular real por la IP de LAN
 * —`http://192.168.x.x:3000`, que es EL flujo de prueba de este producto,
 * porque el 90% de los pedidos entra desde un teléfono— no es secure context,
 * así que ahí `crypto.randomUUID` es `undefined` y el checkout se caía con
 * `TypeError: crypto.randomUUID is not a function` justo al confirmar el
 * pedido. Lo mismo pasa en cualquier navegador viejo (Safari < 15.4).
 *
 * `crypto.getRandomValues()` SÍ está disponible fuera de secure context —a
 * diferencia de `randomUUID` y de `crypto.subtle`—, así que el fallback no
 * baja la calidad de la aleatoriedad: sigue siendo un CSPRNG.
 *
 * **No hay fallback a `Math.random()`, y eso es deliberado.** Este UUID es la
 * clave de idempotencia del pedido, y hay un índice único en
 * `orders(store_id, idempotency_key)`: cuando el insert choca con `23505`,
 * `createOrder` devuelve **el pedido que ya existía** en vez de un error (ver
 * CLAUDE.md § "Un pedido, una vez"). O sea que adivinar una clave ajena no
 * produce un error: produce el pedido de otro cliente. La clave tiene que ser
 * impredecible, no solo única, así que si no hay CSPRNG preferimos fallar
 * fuerte y visible antes que emitir una clave adivinable.
 */
export function randomUuidV4(): string {
  const webCrypto = globalThis.crypto

  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    // Versión 4 y variante RFC 4122, igual que lo que emite `randomUUID()`:
    // el servidor valida el formato con `z.uuid()`, así que un hex suelto no
    // pasaría.
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error(
    'Este navegador no expone una fuente de aleatoriedad criptográfica, así que no se puede generar la clave del pedido de forma segura.',
  )
}
