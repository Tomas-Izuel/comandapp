/**
 * Los hechos de la landing de ComandApp, en un solo lugar.
 *
 * No es "constantes de UI": es el contrato de lo que la página AFIRMA. El
 * precio, el número de WhatsApp y el nombre del producto aparecen en más de
 * una sección y además viajan al JSON-LD y a la metadata de OpenGraph, así
 * que tenerlos duplicados en cuatro componentes garantiza que un día el
 * `<meta>` diga un precio y el cuerpo otro.
 *
 * Regla dura de esta superficie, heredada de PRODUCT.md: **acá no entra una
 * sola cifra de uso, testimonio, logo de cliente ni caso de éxito.** No
 * existen. Si algún día existen, entran por este archivo y con fuente.
 *
 * Sin `server-only` a propósito: la landing es estática y algunos de estos
 * valores los consume markup que también corre en el cliente.
 */

import type { StoreDelivery } from '@/models/types'
import { scaleUpInt } from '@/lib/money'

/** Nombre del producto, tal como se escribe siempre. */
export const PRODUCT_NAME = 'ComandApp'

/**
 * El número de contacto, en los dos formatos que hacen falta.
 *
 * `wa` lleva el **9** después del 54: sin él, `wa.me` no resuelve un celular
 * argentino. `display` es el formato que lee una persona. Si alguna vez el
 * número cambia, cambian los dos.
 */
export const CONTACT = {
  wa: '5492996201979',
  display: '+54 9 299 620-1979',
  email: 'hola@comandapp.ar',
} as const

/**
 * El mensaje con el que abre WhatsApp. Va prearmado porque el dueño que toca
 * el botón no tiene que redactar nada: el objetivo es que llegue un mensaje,
 * no que el visitante piense cómo empezarlo.
 */
export const WHATSAPP_MESSAGE = `Hola! Tengo un local y quiero ver ${PRODUCT_NAME}.`

/** El href del CTA. Una sola función para que el mensaje no se bifurque. */
export function whatsappHref(message: string = WHATSAPP_MESSAGE): string {
  return `https://wa.me/${CONTACT.wa}?text=${encodeURIComponent(message)}`
}

/**
 * El precio, decidido por el dueño del producto el 2026-09-01.
 *
 * `IVA_DISCLOSED` está en `false` y es deliberado: todavía no está definido si
 * los $59.999 son finales o + IVA, y un dueño de local lo pregunta siempre.
 * Mientras esté en `false` la página **no dice nada** sobre IVA — no lo afirma
 * ni lo niega. Inventarlo sería una afirmación comercial falsa.
 */
export const PRICING = {
  trialDays: 15,
  monthlyCents: 5_999_900,
  monthlyMultiStoreCents: 5_000_000,
  currency: 'ARS',
  IVA_DISCLOSED: false,
} as const

/**
 * Cada captura del producto lleva su ticket de origen. Es lo que convierte
 * "no tenemos evidencia de uso" en honestidad visible en vez de en un hueco:
 * la pantalla es real, los datos no son de un local real, y se dice.
 */
export const SCREENSHOT_CAPTION = 'Captura real del producto · datos de demostración'

export type Screenshot = {
  /** Ruta bajo `public/`. */
  readonly src: string
  readonly width: number
  readonly height: number
  /** Alt real y descriptivo: qué se ve, no "captura de pantalla". */
  readonly alt: string
  /** De quién es esta pantalla, en la voz de la página. */
  readonly who: string
  /** La única frase que la pantalla tiene que probar. */
  readonly claim: string
}

export type Faq = {
  readonly q: string
  readonly a: string
}

/* ---------------------------------------------------------------------------
   Ronda 2 (2026-09-02): "la página es la demo".

   Todo lo que sigue es el guion de UN solo pedido, el #A2A1, que cruza la
   página entera: es el que se ve en las capturas reales (`pantalla-cocina.png`
   lo lista "hace 6 min", `pantalla-seguimiento.png` lo muestra hecho a las
   21:20 con listo aprox. a las 21:44), el que corre la carrera contra el hilo
   de WhatsApp, y el que dispara los eventos hacia el sistema del local.

   Un solo pedido en toda la página no es un capricho de coherencia: es lo que
   hace que cada sección se lea como una ESTACIÓN del mismo recorrido y no como
   una tarjeta suelta con datos inventados distintos. Si cambiás un número acá,
   cambia en todas las secciones a la vez; ninguna lo hardcodea.

   Nada de esto es evidencia de uso. Es una ESCENA DE DEMOSTRACIÓN, y toda
   sección que la dramatice lo dice con `DEMO_SCENE_CAPTION`.
   --------------------------------------------------------------------------- */

/** El epígrafe de toda escena dramatizada (la carrera, el log de eventos). */
export const DEMO_SCENE_CAPTION = 'Escena de demostración · no es un caso real'

export type DemoOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready'

/**
 * El pedido de la página. Coincide con `pantalla-seguimiento.png`: 1× Bacon
 * Bomb + 1× Papas Cheddar, $16.700, retiro en el local, hecho a las 21:20.
 * Las horas del `timeline` son las del ciclo de COCINA (el reloj del pedido);
 * `paidAt` es el reloj del DINERO, que va aparte — misma regla que el
 * producto real.
 */
export const DEMO_ORDER = {
  shortCode: 'A2A1',
  storeName: 'La Birra Burgers',
  customerFirstName: 'Camila',
  deliveryMethod: 'pickup',
  currency: 'ARS',
  items: [
    { name: 'Bacon Bomb', quantity: 1, unitCents: 1_050_000 },
    { name: 'Papas Cheddar', quantity: 1, unitCents: 620_000 },
  ],
  subtotalCents: 1_670_000,
  totalCents: 1_670_000,
  placedAt: '21:20',
  paidAt: '21:20',
  /** ETA congelado al crear el pedido, como hace `create_order`. */
  etaMinutes: 24,
  etaAt: '21:44',
  timeline: {
    pending: '21:20',
    confirmed: '21:20',
    preparing: '21:21',
    ready: '21:41',
  } satisfies Record<DemoOrderStatus, string>,
} as const

export type DemoOrder = typeof DEMO_ORDER

/**
 * El hilo de WhatsApp de HOY para ese mismo pedido, con la hora de cada
 * mensaje. Las horas son la dramatización de lo que PRODUCT.md describe
 * ("alguien contesta" cuando puede, en hora pico): el cliente escribe a las
 * 21:20 igual que en ComandApp, y el local le confirma que está listo a las
 * 21:58. La carrera compara los dos relojes.
 *
 * Deliberadamente NO es una captura ni clona la interfaz de WhatsApp: no
 * existe una conversación real que fotografiar, y la paleta es la de
 * ComandApp para que se lea como EL FLUJO y no como la app de un tercero.
 */
export type DemoMessage = {
  readonly from: 'cliente' | 'local'
  readonly text: string
  readonly at: string
  readonly attachment?: boolean
}

export const DEMO_THREAD: readonly DemoMessage[] = [
  { from: 'cliente', text: 'Hola, ¿están abiertos?', at: '21:20' },
  { from: 'local', text: 'Sí! ¿Qué querés pedir?', at: '21:27' },
  { from: 'cliente', text: 'Una Bacon Bomb y unas Papas Cheddar, para retirar', at: '21:28' },
  { from: 'local', text: 'Son $16.700. Te paso el alias para transferir', at: '21:33' },
  { from: 'cliente', text: 'Comprobante.jpg', at: '21:36', attachment: true },
  { from: 'local', text: 'Dale, ya te confirmo', at: '21:44' },
  { from: 'local', text: '¡Ya está listo!', at: '21:58' },
]

/** Lo que ese hilo le cuesta al local, más allá de cada mensaje. */
export const THREAD_COSTS = [
  'Ocupa a una persona entera en la hora pico.',
  'Se cae cuando entran cinco pedidos juntos.',
  'Pierde ventas mientras nadie contesta.',
  'No deja un solo dato del pedido.',
] as const

/**
 * Las cinco estaciones del recorrido del pedido, en el orden en que pasan.
 * Cada una es una captura REAL del producto (con datos de demostración) y la
 * única frase que esa pantalla tiene que probar. `id` es estable: lo usa la
 * barra de progreso y el ancla del recorrido.
 */
export type JourneyStation = {
  readonly id: 'compra' | 'cocina' | 'espera' | 'reparto' | 'caja'
  readonly who: string
  readonly title: string
  readonly claim: string
  /** Dos o tres hechos concretos que se ven en la captura. Sin adjetivos. */
  readonly facts: readonly string[]
  readonly screen: Screenshot
}

export const JOURNEY: readonly JourneyStation[] = [
  {
    id: 'compra',
    who: 'El que compra',
    title: 'Arma el pedido desde el navegador',
    claim: 'Sin bajar una app ni crear una cuenta. Paga con Mercado Pago o reserva y paga al retirar.',
    facts: [
      'La carta con la marca del local: logo, colores y fotos.',
      'Ve los minutos estimados y el mínimo antes de elegir.',
      'El carrito queda en su celular por si vuelve mañana.',
    ],
    screen: {
      src: '/landing/pantalla-cliente.png',
      width: 720,
      height: 1560,
      alt: 'La carta de un local abierta en el celular, con productos y el carrito',
      who: 'El que compra',
      claim: 'Arma el pedido y paga sin bajar una app ni crear una cuenta.',
    },
  },
  {
    id: 'cocina',
    who: 'El mostrador',
    title: 'Lo ve entrar ya pagado',
    claim: 'Lo mueve de estado con un toque. Nadie tipea un mensaje.',
    facts: [
      'Tres columnas: confirmado, en preparación, listo.',
      'Un pedido online impago no pasa a la cocina.',
      'Un toque de más se deshace: se permite un paso atrás.',
    ],
    screen: {
      src: '/landing/pantalla-cocina.png',
      width: 1920,
      height: 1200,
      alt: 'El panel de cocina con varios pedidos en distintos estados de preparación',
      who: 'El mostrador',
      claim: 'Ve entrar el pedido y lo mueve de estado con un toque, sin escribirle a nadie.',
    },
  },
  {
    id: 'espera',
    who: 'El que espera',
    title: 'Sabe cuánto falta sin preguntar',
    claim: 'El tiempo que ve se calculó con la carga real de la cocina en ese momento.',
    facts: [
      'Un link, sin cuenta: lo puede compartir con quien va a buscar el pedido.',
      'El código de 4 letras es el que se canta en el mostrador.',
      'Si dejó su mail, recibe el comprobante y el aviso de listo.',
    ],
    screen: {
      src: '/landing/pantalla-seguimiento.png',
      width: 720,
      height: 1560,
      alt: 'El seguimiento del pedido en el celular, con el tiempo estimado y los pasos del pedido',
      who: 'El que espera',
      claim: 'Ve cuánto falta y en qué paso va su pedido, sin escribirle a nadie para preguntar.',
    },
  },
  {
    id: 'reparto',
    who: 'El repartidor',
    title: 'Ve solo su cola de entregas',
    claim: 'Entra desde su celular con un link del local. No pisa el panel de cocina.',
    facts: [
      'Repartidores propios del local, no de un tercero.',
      'Un toque para "salió" y otro para "entregado".',
      'La dirección abre en el mapa; el teléfono, en una llamada.',
    ],
    screen: {
      src: '/landing/pantalla-repartidor.png',
      width: 720,
      height: 1560,
      alt: 'La cola de entregas del repartidor abierta en el celular',
      who: 'El repartidor',
      claim: 'Ve su cola de entregas sin pisar el panel de cocina.',
    },
  },
  {
    id: 'caja',
    who: 'El dueño',
    title: 'Ve cuánto vendió, desde donde esté',
    claim: 'Sin llamar al mostrador ni pedir el cuaderno.',
    facts: [
      'Facturación, pedidos y ticket promedio de los últimos 30 días.',
      'Qué productos salen más, y cuánto tarda la cocina de verdad.',
      'El padrón de quién compró, para cupones y campañas.',
    ],
    screen: {
      src: '/landing/pantalla-dueno.png',
      width: 1920,
      height: 1200,
      alt: 'El dashboard de ventas del local, con gráficos de los últimos 30 días',
      who: 'El dueño',
      claim: 'Ve cuánto vendió el local sin llamar al mostrador ni pedir el cuaderno.',
    },
  },
]

/**
 * El multiplicador de demanda, con los valores POR DEFECTO del schema
 * (`stores.demand_threshold_orders = 5`, `demand_multiplier = 1.50`). La
 * fórmula es la del producto (CLAUDE.md, "Multiplicador de demanda"): la base
 * es el MAX de `prep_minutes` de los ítems —el pedido se entrega junto, no se
 * suma— y se multiplica con `scaleUpInt`, nunca con float.
 */
export const ETA_DEMO = {
  /** Bacon Bomb tarda 15; las papas, 8. Manda la más lenta. */
  itemPrepMinutes: [
    { name: 'Bacon Bomb', minutes: 15 },
    { name: 'Papas Cheddar', minutes: 8 },
  ],
  basePrepMinutes: 15,
  thresholdOrders: 5,
  multiplier: 1.5,
  /** Tope del control interactivo. */
  maxActiveOrders: 12,
  /** Lo que el local dice hoy por WhatsApp, esté vacío o desbordado. */
  todaysFixedAnswerMinutes: 20,
} as const

/** El mismo cálculo que `create_order`, para mostrar en la landing. */
export function etaMinutesFor(activeOrders: number, demo: typeof ETA_DEMO = ETA_DEMO): number {
  const factor = activeOrders >= demo.thresholdOrders ? demo.multiplier : 1
  return scaleUpInt(demo.basePrepMinutes, factor)
}

/**
 * Los eventos que el pedido #A2A1 deja en el outbox y se entregan al sistema
 * del local. Los nombres son los del dominio, no jerga técnica inventada: cada
 * cambio de estado inserta una fila en `order_events`, y un cron la POSTea
 * firmada a los endpoints del local.
 */
export type DemoEvent = {
  readonly at: string
  readonly event: string
  readonly detail: string
}

export const DEMO_EVENTS: readonly DemoEvent[] = [
  { at: DEMO_ORDER.timeline.pending, event: 'order.created', detail: '1× Bacon Bomb · 1× Papas Cheddar · $ 16.700' },
  { at: DEMO_ORDER.paidAt, event: 'payment.approved', detail: 'Mercado Pago · cuenta del local' },
  { at: DEMO_ORDER.timeline.confirmed, event: 'order.confirmed', detail: 'ETA 24 min · listo aprox. 21:44' },
  { at: DEMO_ORDER.timeline.preparing, event: 'order.preparing', detail: 'La cocina lo tomó' },
  { at: DEMO_ORDER.timeline.ready, event: 'order.ready', detail: 'Aviso al cliente por WhatsApp' },
]

/**
 * Los números del delivery de la tienda de demostración, con la forma exacta
 * que consume `src/lib/delivery.ts`: el cotizador de la landing llama a LAS
 * MISMAS funciones que cobran en el checkout, así que no puede mostrar un
 * envío que el producto no cobraría. Coincide con la portada de
 * `pantalla-cliente.png` (Envío $ 1.800 · Mínimo $ 5.000).
 */
export const DELIVERY_DEMO: StoreDelivery = {
  enabled: true,
  feeCents: 180_000,
  freeFromCents: 1_500_000,
  minOrderCents: 500_000,
  minutes: 25,
  busyMinutes: 40,
  courierCollects: false,
}

/** Rango del control de subtotal del cotizador. */
export const DELIVERY_DEMO_SUBTOTAL = {
  minCents: 0,
  maxCents: 3_000_000,
  stepCents: 50_000,
  initialCents: DEMO_ORDER.subtotalCents,
} as const

/**
 * Total mensual para N locales: el primero a precio pleno, los siguientes al
 * precio multi-local. Es la única aritmética del precio y vive acá para que
 * la calculadora y cualquier texto den el mismo número.
 */
export function monthlyTotalCents(storeCount: number, pricing: typeof PRICING = PRICING): number {
  if (storeCount <= 0) return 0
  return pricing.monthlyCents + (storeCount - 1) * pricing.monthlyMultiStoreCents
}

/** Tope del control "¿cuántos locales?". */
export const PRICING_MAX_STORES = 10

/**
 * Las secciones de la página, en orden, con el rótulo que muestra la barra
 * fija mientras el lector scrollea. Cada `<section>` raíz lleva el `id`
 * correspondiente, `data-scroll-anchor` y `data-landing-section`; la barra
 * las observa por ese atributo, no por posición fija.
 */
export type LandingSection = { readonly id: string; readonly label: string }

export const SECTIONS: readonly LandingSection[] = [
  { id: 'como-funciona', label: 'La carrera' },
  { id: 'recorrido', label: 'El recorrido' },
  { id: 'diferencias', label: 'Lo que WhatsApp no da' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'incluido', label: 'Qué incluye' },
  { id: 'precio', label: 'Precio' },
  { id: 'faq', label: 'Preguntas' },
]

/**
 * El mensaje de WhatsApp para una pregunta puntual del FAQ: el lector ve la
 * pregunta y toca "preguntar esto", y el mensaje llega ya redactado.
 */
export function whatsappQuestionHref(question: string): string {
  return whatsappHref(`Hola! Tengo un local y una pregunta sobre ${PRODUCT_NAME}: ${question}`)
}

/**
 * El guion de la escena del hero (2026-09-02, ronda 4): un STORYBOARD del
 * flujo entero, contado con un pedido de DELIVERY para que termine con la
 * moto llegando a la puerta. Es el #C64E de las capturas reales: en
 * `pantalla-cocina.png` figura con su dirección y el botón "Salió a
 * repartir", y en `pantalla-repartidor.png` es el que el repartidor tiene en
 * su cola. Ítems y precios son los del dashboard de `pantalla-dueno.png`.
 *
 * Es la única sección que no usa el #A2A1: ese pedido es de retiro y el
 * hero necesita mostrar el envío. Las dos escenas se explican solas y no se
 * cruzan; el resto de la página sigue con el #A2A1.
 *
 * Los montos salen de acá (centavos, `formatCentsCompact`), nunca a mano; la
 * suma tiene que cerrar: subtotal + envío = total, igual que el CHECK real.
 */
export const HERO_ORDER = {
  shortCode: 'C64E',
  storeName: 'La Birra Burgers',
  deliveryMethod: 'delivery',
  currency: 'ARS',
  items: [
    { name: 'Doble Cheddar', description: 'Dos medallones smash, cheddar', quantity: 2, unitCents: 980_000 },
    { name: 'Papas Clásicas', description: 'Porción grande', quantity: 1, unitCents: 400_000 },
    { name: 'Coca-Cola 500ml', description: '', quantity: 2, unitCents: 250_000 },
  ],
  subtotalCents: 2_860_000,
  deliveryFeeCents: 180_000,
  totalCents: 3_040_000,
  addressLine: 'Av. San Martín 1240, Mendoza',
  courierFirstName: 'Bruno',
  placedAt: '21:47',
  paidAt: '21:47',
  timeline: {
    confirmed: '21:47',
    preparing: '21:48',
    ready: '22:05',
    on_the_way: '22:07',
    delivered: '22:24',
  },
} as const

export type HeroOrder = typeof HERO_ORDER

/**
 * Los cinco cuadros del storyboard, en orden. Cada cuadro entra por la
 * derecha, se reproduce y sale por la izquierda; `short` es el rótulo
 * siempre visible bajo la marca del paso (el mapa del flujo), `title` y
 * `caption` se leen en la región fija del paso activo.
 */
export type HeroFlowStep = {
  readonly id: 'pide' | 'paga' | 'cocina' | 'listo' | 'reparto'
  readonly at: string
  /** Rótulo corto, SIEMPRE visible bajo la marca del paso: es el mapa del flujo. */
  readonly short: string
  readonly title: string
  readonly caption: string
}

export const HERO_FLOW: readonly HeroFlowStep[] = [
  {
    id: 'pide',
    at: HERO_ORDER.placedAt,
    short: 'Pide',
    title: 'El cliente arma el pedido',
    caption: 'Desde el navegador, sin bajar una app ni crear una cuenta.',
  },
  {
    id: 'paga',
    at: HERO_ORDER.paidAt,
    short: 'Paga',
    title: 'Paga con Mercado Pago',
    caption: 'La plata entra directo a la cuenta del local. ComandApp no la toca.',
  },
  {
    id: 'cocina',
    at: HERO_ORDER.timeline.preparing,
    short: 'Cocina',
    title: 'La cocina lo ve entrar, ya pagado',
    caption: 'Lo toma con un toque en el panel del mostrador. Nadie escribe nada.',
  },
  {
    id: 'listo',
    at: HERO_ORDER.timeline.ready,
    short: 'Listo',
    title: 'Sale de la cocina',
    caption: 'El cliente lo ve en su celular sin preguntar.',
  },
  {
    id: 'reparto',
    at: HERO_ORDER.timeline.on_the_way,
    short: 'En camino',
    title: 'El repartidor del local lo lleva',
    caption: 'Ve su cola en el celular y avisa "salió" con un toque. Llega 22:24.',
  },
]

/** Duración total de la escena del hero, en ms. Cinco cuadros a ~2,6 s cada uno. */
export const HERO_FLOW_DURATION_MS = 13_000
