import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTACT,
  DELIVERY_DEMO,
  DELIVERY_DEMO_SUBTOTAL,
  DEMO_ORDER,
  DEMO_THREAD,
  ETA_DEMO,
  etaMinutesFor,
  HERO_FLOW,
  HERO_ORDER,
  JOURNEY,
  monthlyTotalCents,
  PRICING_MAX_STORES,
  SECTIONS,
  WHATSAPP_MESSAGE,
  whatsappHref,
  whatsappQuestionHref,
} from '@/lib/landing'
import { buildDeliveryQuote, deliveryFeeFor } from '@/lib/delivery'

/**
 * `whatsappHref()` — el único CTA de toda la landing (`00-architecture.md`:
 * "Éxito = toca 'Hablar por WhatsApp'"). Si esto se rompe, la página entera
 * deja de convertir aunque el resto se vea perfecto.
 */
describe('whatsappHref', () => {
  it('el número lleva el 9 después del 54: sin él, wa.me no resuelve un celular argentino', () => {
    // No fijamos el número completo a mano (sería acoplarse al literal, no a
    // la propiedad): lo que importa es la FORMA — 54 + 9 + el resto — porque
    // esa es la regla que rompe el link si alguien "limpia" el 9 pensando
    // que es ruido, como pasó con los teléfonos de clientes (ver CLAUDE.md).
    expect(CONTACT.wa).toMatch(/^549\d+$/)
    expect(whatsappHref()).toContain(`https://wa.me/${CONTACT.wa}`)
  })

  it('el mensaje default viaja percent-encoded en el querystring', () => {
    const href = whatsappHref()
    const url = new URL(href)

    expect(url.searchParams.get('text')).toBe(WHATSAPP_MESSAGE)
    // El mensaje real tiene espacios y un "!"; si whatsappHref() los mandara
    // crudos, la URL quedaría rota para cualquier cliente que no la
    // reconstruya. El chequeo es sobre la forma CRUDA del string, no sobre lo
    // que `URLSearchParams` ya decodificó de vuelta.
    expect(href).not.toContain(' ')
    expect(href).toContain(encodeURIComponent(WHATSAPP_MESSAGE))
  })

  it('un mensaje propio PISA el default, no lo concatena ni lo ignora', () => {
    const custom = '¿Cuánto sale para dos locales?'
    const href = whatsappHref(custom)
    const url = new URL(href)

    expect(url.searchParams.get('text')).toBe(custom)
    expect(url.searchParams.get('text')).not.toContain(WHATSAPP_MESSAGE)
  })
})

/** "HH:MM" → minutos desde medianoche, para comparar horas de guion sin parsear fechas completas. */
function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * `etaMinutesFor` — la MISMA fórmula que `create_order` (CLAUDE.md,
 * "Multiplicador de demanda"): la base es el `prep_minutes` del ítem más
 * lento, y el multiplicador entra recién en el umbral. El borde es donde
 * vive el bug: "por debajo" vs. "en el umbral" es una comparación `>=`, y un
 * `>` la corre un pedido entero.
 */
describe('etaMinutesFor — el multiplicador de demanda con los defaults del schema', () => {
  it('por debajo del umbral (incluido el umbral - 1): sin multiplicador, ETA = base', () => {
    expect(etaMinutesFor(0)).toBe(ETA_DEMO.basePrepMinutes)
    expect(etaMinutesFor(ETA_DEMO.thresholdOrders - 1)).toBe(ETA_DEMO.basePrepMinutes)
  })

  it('EN el umbral y por encima: multiplicador aplicado con scaleUpInt, nunca con Math.ceil(float) truncado a mano', () => {
    // scaleUpInt(15, 1.5) = ceil(15 * 15000 / 10000) = ceil(22.5) = 23, NO 22
    // (truncar) ni 22.5 (float crudo): si algún día esto se reimplementa como
    // `Math.round(base * multiplier)` da 22 y el cliente ve un minuto de
    // menos que lo que la cocina va a tardar de verdad.
    expect(etaMinutesFor(ETA_DEMO.thresholdOrders)).toBe(23)
    expect(etaMinutesFor(ETA_DEMO.maxActiveOrders)).toBe(23)
  })
})

/**
 * `monthlyTotalCents` — el primer local a precio pleno, cada uno adicional al
 * precio multi-local. Es la única aritmética del precio: si esto se
 * equivoca, la calculadora de la landing le cotiza mal a un dueño de
 * varios locales.
 */
describe('monthlyTotalCents', () => {
  it('0 locales → 0 (no hay nada que cobrar)', () => {
    expect(monthlyTotalCents(0)).toBe(0)
  })

  it('1 local → el precio pleno, sin descuento multi-local', () => {
    expect(monthlyTotalCents(1)).toBe(5_999_900)
  })

  it('3 locales → 1 pleno + 2 al precio multi-local', () => {
    expect(monthlyTotalCents(3)).toBe(15_999_900)
  })

  it('PRICING_MAX_STORES es un tope positivo y razonable para el control de la calculadora', () => {
    expect(PRICING_MAX_STORES).toBeGreaterThan(1)
  })
})

/**
 * `whatsappQuestionHref` — el CTA de cada respuesta del FAQ. Tiene que
 * incluir la pregunta puntual (para que el local sepa qué le están
 * preguntando sin que el cliente escriba nada) y seguir apuntando al mismo
 * número que el resto de la página.
 */
describe('whatsappQuestionHref', () => {
  it('el mensaje final incluye la pregunta, percent-encoded, y viaja al número de CONTACT', () => {
    const question = '¿Puedo seguir cobrando en el mostrador?'
    const href = whatsappQuestionHref(question)
    const url = new URL(href)

    expect(href).toContain(`https://wa.me/${CONTACT.wa}`)
    expect(url.searchParams.get('text')).toContain(question)
    expect(href).toContain(encodeURIComponent(question))
  })
})

/**
 * El pedido #A2A1 es el guion que cruza toda la página: si su propia
 * aritmética no cierra, cada sección que lo dramatiza hereda el error.
 */
describe('DEMO_ORDER — el pedido que cruza toda la página', () => {
  it('subtotalCents es la suma real de sus ítems (unitCents × quantity)', () => {
    const sum = DEMO_ORDER.items.reduce((total, item) => total + item.unitCents * item.quantity, 0)
    expect(DEMO_ORDER.subtotalCents).toBe(sum)
  })

  it('totalCents === subtotalCents: es retiro, sin envío que sumar', () => {
    expect(DEMO_ORDER.totalCents).toBe(DEMO_ORDER.subtotalCents)
  })

  it('el timeline de cocina no retrocede: pending ≤ confirmed ≤ preparing ≤ ready', () => {
    const order: Array<keyof typeof DEMO_ORDER.timeline> = ['pending', 'confirmed', 'preparing', 'ready']
    const minutes = order.map((status) => minutesOf(DEMO_ORDER.timeline[status]))

    for (let i = 1; i < minutes.length; i++) {
      expect(minutes[i], `${order[i]} (${DEMO_ORDER.timeline[order[i]]}) es antes que ${order[i - 1]}`).toBeGreaterThanOrEqual(
        minutes[i - 1],
      )
    }
  })
})

describe('DEMO_THREAD — el hilo de WhatsApp que corre la carrera contra DEMO_ORDER', () => {
  it('el primer mensaje del hilo sale a la MISMA hora en que se hizo el pedido por ComandApp: la carrera arranca pareja', () => {
    expect(DEMO_THREAD[0].at).toBe(DEMO_ORDER.placedAt)
  })
})

/**
 * `HERO_FLOW` — ronda 4 ("el hero es un storyboard"): pasó de 4 a 5 cuadros
 * (se agregó `reparto`, el tramo de delivery) y cada paso ganó `short`, el
 * rótulo del mapa de pasos que se lee SIEMPRE en el HTML servido (ver
 * `landing-render.test.ts`). Esto no es cosmético: si `HERO_FLOW` pierde un
 * paso o repite un id, el mapa de pasos y el escenario (que iteran el mismo
 * array) quedan desincronizados en silencio.
 */
describe('HERO_FLOW — el guion del hero (storyboard de 5 cuadros) no retrocede en el reloj', () => {
  it('tiene 5 pasos', () => {
    expect(HERO_FLOW.length).toBe(5)
  })

  it('las horas de los 5 pasos (pide → paga → cocina → listo → reparto) son no decrecientes', () => {
    const minutes = HERO_FLOW.map((step) => minutesOf(step.at))
    for (let i = 1; i < minutes.length; i++) {
      expect(
        minutes[i],
        `${HERO_FLOW[i].id} (${HERO_FLOW[i].at}) es antes que ${HERO_FLOW[i - 1].id}`,
      ).toBeGreaterThanOrEqual(minutes[i - 1])
    }
  })

  it('los 5 ids son únicos', () => {
    const ids = HERO_FLOW.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(5)
  })
})

/**
 * `HERO_ORDER` — el pedido de DELIVERY que narra el storyboard del hero
 * (#C64E). Es el único guion de la página con envío, así que es donde vive
 * el CHECK real de la tabla `orders`
 * (`orders_total_is_subtotal_plus_delivery_check`): si esta aritmética no
 * cierra acá, el hero le muestra al visitante un total que el producto real
 * rechazaría con un 23514.
 */
describe('HERO_ORDER — el pedido de delivery que narra el storyboard del hero', () => {
  it('subtotalCents es la suma real de sus ítems (unitCents × quantity)', () => {
    const sum = HERO_ORDER.items.reduce((total, item) => total + item.unitCents * item.quantity, 0)
    expect(HERO_ORDER.subtotalCents).toBe(sum)
  })

  it('totalCents === subtotalCents + deliveryFeeCents — el mismo CHECK que orders_total_is_subtotal_plus_delivery_check', () => {
    expect(HERO_ORDER.totalCents).toBe(HERO_ORDER.subtotalCents + HERO_ORDER.deliveryFeeCents)
  })

  it('deliveryFeeCents es el de la MISMA tienda de demostración (DELIVERY_DEMO), no un número aparte', () => {
    expect(HERO_ORDER.deliveryFeeCents).toBe(DELIVERY_DEMO.feeCents)
  })

  it('el timeline no retrocede: confirmed ≤ preparing ≤ ready ≤ on_the_way ≤ delivered', () => {
    const order: Array<keyof typeof HERO_ORDER.timeline> = [
      'confirmed',
      'preparing',
      'ready',
      'on_the_way',
      'delivered',
    ]
    const minutes = order.map((status) => minutesOf(HERO_ORDER.timeline[status]))

    for (let i = 1; i < minutes.length; i++) {
      expect(minutes[i], `${order[i]} (${HERO_ORDER.timeline[order[i]]}) es antes que ${order[i - 1]}`).toBeGreaterThanOrEqual(
        minutes[i - 1],
      )
    }
  })
})

/**
 * `JOURNEY` — las cinco estaciones del recorrido. Cada captura tiene que
 * existir de verdad bajo `public/`: un `src` roto no explota en build (Next
 * sirve un 404 silencioso para una imagen), así que sin este test un typo en
 * el nombre de archivo llega a producción.
 */
describe('JOURNEY — las cinco estaciones del recorrido', () => {
  it('tiene 5 estaciones con ids únicos', () => {
    expect(JOURNEY.length).toBe(5)
    const ids = JOURNEY.map((station) => station.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada captura existe de verdad bajo public/', () => {
    const missing = JOURNEY.filter((station) => !existsSync(path.join(process.cwd(), 'public', station.screen.src))).map(
      (station) => `${station.id} → ${station.screen.src}`,
    )
    expect(missing, `Estaciones cuya captura no existe en public/:\n${missing.join('\n')}`).toEqual([])
  })
})

describe('SECTIONS — la barra de progreso no puede observar dos secciones con el mismo id', () => {
  it('todos los ids son únicos', () => {
    const ids = SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * El cotizador de la landing (`delivery-quote.tsx`) llama a las MISMAS
 * funciones que cobran en el checkout real (`src/lib/delivery.ts`), así que
 * lo que hay que probar es que `DELIVERY_DEMO` produce los números que el
 * brief prometió — si `src/lib/delivery.ts` cambia de comportamiento, este
 * test avisa antes que un visitante vea un envío que el producto no cobraría.
 */
describe('DELIVERY_DEMO contra src/lib/delivery.ts — el cotizador nunca puede inventar un número', () => {
  it('subtotal 400.000 (por debajo del mínimo de 500.000): faltan exactamente 100.000 para el mínimo', () => {
    const quote = buildDeliveryQuote({
      delivery: DELIVERY_DEMO,
      subtotalCents: 400_000,
      availability: { activeCouriers: 2, freeCouriers: 1 },
      currency: 'ARS',
    })
    expect(quote.missingForMinimumCents).toBe(100_000)
  })

  it('subtotal 1.000.000 (por debajo de "gratis desde" 1.500.000): envío pleno de 180.000', () => {
    expect(deliveryFeeFor(DELIVERY_DEMO, 1_000_000)).toBe(180_000)
  })

  it('subtotal 1.500.000 (llega exacto a "gratis desde"): envío $0', () => {
    expect(deliveryFeeFor(DELIVERY_DEMO, 1_500_000)).toBe(0)
  })

  it('el subtotal inicial del control (DELIVERY_DEMO_SUBTOTAL.initialCents) es el mismo pedido #A2A1, no un número inventado aparte', () => {
    expect(DELIVERY_DEMO_SUBTOTAL.initialCents).toBe(DEMO_ORDER.subtotalCents)
  })
})
