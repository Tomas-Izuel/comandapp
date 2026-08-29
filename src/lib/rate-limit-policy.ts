import type { RateLimitBucket } from '@/models/types'

/**
 * Los números del rate limiting, en un solo lugar.
 *
 * Sin runtime de red y sin `server-only`: son constantes, y que el cliente
 * pueda importarlas no expone nada — el límite lo aplica el servidor, y saber
 * cuál es no ayuda a esquivarlo.
 *
 * CALIBRACIÓN: en el camino de compra, un falso positivo es peor que un falso
 * negativo. Bloquear un pedido que se estaba pagando es plata perdida y un
 * cliente enojado, mientras que dejar pasar un pedido de más solo cuesta una
 * preferencia de Mercado Pago. Por eso los límites del checkout son generosos
 * y `order:store` no bloquea: solo loguea.
 *
 * El otro eje de calibración es el CGNAT móvil argentino: el 90% de los pedidos
 * entra desde un celular, y muchos clientes reales comparten IP de salida. Un
 * límite por IP agresivo bloquea gente que está pagando, no atacantes.
 */
export const RATE_LIMIT_POLICY: Record<RateLimitBucket, { limit: number; windowSeconds: number }> = {
  // --- Magic link: la única puerta a /admin -------------------------------
  //
  // `magic_link:global` es la pieza clave del free tier y NO es un límite de
  // abuso: es un PRESUPUESTO. Supabase impone 30 mensajes/hora para todo el
  // proyecto al conectar SMTP propio, y esa cuota la comparten el magic link
  // anónimo y las invitaciones que manda el backoffice. Sin tope global, un
  // anónimo que conozca dos emails la agota solo —y con una sola tienda en QC
  // los emails que existen son básicamente dos— y deja sin acceso a /admin a
  // todas las tiendas a la vez. Con el global en 15, el endpoint anónimo no
  // puede consumir más de la mitad, y la otra mitad queda reservada para los
  // caminos autenticados, que son los que nunca pueden fallar.
  'magic_link:email': { limit: 2, windowSeconds: 15 * 60 },
  'magic_link:email:day': { limit: 5, windowSeconds: 24 * 60 * 60 },
  'magic_link:ip': { limit: 10, windowSeconds: 15 * 60 },
  'magic_link:global': { limit: 15, windowSeconds: 60 * 60 },

  // --- Seguimiento y compra ------------------------------------------------
  //
  // `lookup:ip` es más ajustado que el resto porque el endpoint acepta hasta 50
  // tokens por request: una sola llamada ya es 50 sondeos.
  'lookup:ip': { limit: 20, windowSeconds: 60 },
  'order:phone': { limit: 5, windowSeconds: 10 * 60 },
  // NO BLOQUEA. Es un detector de anomalía por tienda: 300 pedidos en 10
  // minutos en un local que hace 40 por noche es una señal, pero cortar la
  // venta de un local que se hizo viral por una alerta es exactamente el error
  // que no podemos cometer. Se loguea y se avisa; la decisión es humana.
  'order:store': { limit: 300, windowSeconds: 10 * 60 },

  // --- Invitaciones y cambios sensibles ------------------------------------
  //
  // Todos mandan mail y todos son autenticados, así que el sujeto es la tienda
  // o el admin, nunca la IP: acá sí sabemos quién es.
  'courier_invite:store': { limit: 10, windowSeconds: 60 * 60 },
  'courier_invite:email': { limit: 3, windowSeconds: 60 * 60 },
  'owner_invite:store': { limit: 5, windowSeconds: 60 * 60 },
  'owner_invite:admin': { limit: 20, windowSeconds: 60 * 60 },
  'payment_change:store': { limit: 3, windowSeconds: 60 * 60 },
  'support:store': { limit: 1, windowSeconds: 2 * 60 },
  'support:store:day': { limit: 10, windowSeconds: 24 * 60 * 60 },
}
