import { z } from 'zod'

/**
 * Contratos de configuración de tienda (panel de admin → "Mi local").
 *
 * `status` NO está acá: lo maneja exclusivamente la plataforma
 * (`platform.model.ts` → `setStoreStatus`). El staff de un local nunca puede
 * reactivar o suspender su propia tienda.
 */

const e164 = z
  .string()
  .trim()
  .regex(/^\+\d{8,15}$/, 'Tiene que ser un teléfono en formato +54911...')
  .nullable()

/**
 * El formulario de admin manda `''` cuando el input de un link queda vacío,
 * y `z.url()` rechazaría eso como "no es una URL" — el dueño del local vería
 * un error por no haber cargado un dato opcional. Este preprocess corre ANTES
 * de la validación de URL y mapea `''` → `null`, que es lo que significa
 * "no cargó este link".
 */
const emptyToNull = (val: unknown) => (val === '' ? null : val)

/**
 * Mismo regex que `stores_instagram_handle_check` (migración
 * `20260828120200_store_links_brand_defaults.sql`), duplicado a propósito
 * —igual que `RESERVED_SLUGS`—: la base garantiza que no entre, el schema
 * hace que el mensaje se entienda en vez de un error de constraint de
 * Postgres.
 */
const instagramHandle = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._]{1,30}$/, 'Solo el usuario, sin @ ni la URL completa')
    .nullable(),
).default(null)

/** El mapa no se acota a un host —Google Maps, Apple Maps y acortadores propios son todos legítimos— pero sí exige https, mismo motivo que el CHECK. */
const mapsUrl = z.preprocess(
  emptyToNull,
  z
    .url('Tiene que ser una URL válida')
    .max(500, 'El link es demasiado largo')
    .refine((value) => value.startsWith('https://'), {
      error: 'El link del mapa tiene que empezar con https://',
    })
    .nullable(),
).default(null)

/**
 * Rappi, PedidosYa y Uber Eats SÍ acotan el host, a diferencia del mapa: cada
 * local tiene su propia ficha en esas apps y no hay forma de derivarla, pero
 * un botón que dice "Rappi" tiene que ir a rappi.com — si no, la página del
 * local termina publicando un link a cualquier lado con el logo de Rappi al
 * lado, y esa combinación es indistinguible de una estafa de phishing para
 * quien la ve. El regex es una copia literal del CHECK correspondiente.
 */
function deliveryAppUrl(hostRegex: RegExp, brand: string) {
  return z.preprocess(
    emptyToNull,
    z
      .url('Tiene que ser una URL válida')
      .max(500, 'El link es demasiado largo')
      .refine((value) => hostRegex.test(value), {
        error: `Tiene que ser un link de ${brand}`,
      })
      .nullable(),
  ).default(null)
}

const rappiUrl = deliveryAppUrl(/^https:\/\/([a-zA-Z0-9-]+\.)*rappi\.com(\.[a-z]{2})?(\/|$)/, 'Rappi')
const pedidosYaUrl = deliveryAppUrl(/^https:\/\/([a-zA-Z0-9-]+\.)*pedidosya\.com(\.[a-z]{2})?(\/|$)/, 'PedidosYa')
const uberEatsUrl = deliveryAppUrl(/^https:\/\/([a-zA-Z0-9-]+\.)*ubereats\.com(\/|$)/, 'Uber Eats')

export const storeSettingsInputSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(120),
  description: z.string().trim().max(500).nullable().default(null),
  phoneE164: e164.default(null),
  whatsappPhoneE164: e164.default(null),
  address: z.string().trim().max(200).nullable().default(null),
  timezone: z.string().trim().min(1).max(60).default('America/Argentina/Buenos_Aires'),
  currency: z.string().trim().length(3).default('ARS'),

  acceptingOrders: z.boolean().default(true),
  inStorePaymentEnabled: z.boolean().default(false),

  minOrderCents: z.coerce.number().int().min(0).default(0),

  demandThresholdOrders: z.coerce.number().int().min(1).default(5),
  demandMultiplier: z.coerce.number().min(1).max(10).default(1.5),

  // Automatización de la cocina. Apagadas por defecto: un local que no opta se
  // comporta exactamente como antes. El barrido que las ejecuta vive en
  // `public.advance_auto_orders()`, no acá — esto es solo la preferencia.
  autoStartOrders: z.boolean().default(false),
  autoReadyOrders: z.boolean().default(false),

  // Coordenadas del local. Mismos rangos que los CHECK de
  // `20260828120400_store_coordinates.sql`, duplicados a propósito —igual que
  // `RESERVED_SLUGS`—: la base garantiza que no entre, el schema hace que el
  // mensaje se entienda. La regla "las dos o ninguna" también vive en los dos
  // lados, y acá se valida a nivel objeto porque cruza dos campos.
  latitude: z.coerce.number().min(-90).max(90).nullable().default(null),
  longitude: z.coerce.number().min(-180).max(180).nullable().default(null),

  // Envío propio. Ver StoreDelivery en types.ts.
  //
  // No hay campo de "cantidad de repartidores": la capacidad ES la cantidad de
  // repartidores activos que el dueño invitó, y vive en `store_members`. Un
  // número manual al lado de una lista real se desincroniza el primer día.
  //
  // Tampoco hay validación cruzada `busyMinutes >= minutes`, a propósito: un
  // `.superRefine()` sobre el objeto le cambia el tipo de entrada al schema y
  // `zodResolver` deja de manejarlo igual. Y normalizar en silencio con un
  // `Math.max` sería pisarle al dueño un número que escribió con intención.
  // Queda como hint en el formulario.
  deliveryEnabled: z.boolean().default(false),
  deliveryFeeCents: z.coerce.number().int().min(0).default(0),
  deliveryFreeFromCents: z.coerce.number().int().min(0).default(0),
  deliveryMinOrderCents: z.coerce.number().int().min(0).default(0),
  deliveryMinutes: z.coerce.number().int().min(0).max(240).default(30),
  deliveryBusyMinutes: z.coerce.number().int().min(0).max(240).default(50),

  // Pedidos programados. Ver StoreScheduling en types.ts.
  //
  // `scheduledDeliveryEnabled` es política del dueño; que haya un repartidor
  // ACTIVO es la realidad y se chequea aparte al crear el pedido, mismo par
  // que `acceptingOrders`/`canCollectPayment`. `scheduledCapacityPerNight` en
  // `null` es "sin tope" — no `0`, que cerraría la noche entera sin que el
  // dueño lo haya pedido nunca.
  scheduledDeliveryEnabled: z.boolean().default(false),
  scheduledCapacityPerNight: z.coerce.number().int().positive().nullable().default(null),

  // `courierCollectsPayment` NO está acá, y la ausencia es a propósito: es
  // plata, no logística. "El repartidor cobra en la puerta" es la decisión de
  // sumar un canal de cobro por fuera de Mercado Pago (efectivo o su propio
  // POSNET en mano), así que entra en la misma categoría que
  // `markPaidInStore` / `setStoreStatus` — cambia SOLO por
  // `requestCourierPaymentPolicyChangeAction` + `confirmPendingChangeAction`
  // (código de 6 dígitos por mail), con `createAdminClient()` detrás de un
  // chequeo de `owner`. Si este campo vuelve a este schema, cualquier staff
  // logueado lo cambia posteando el formulario de Ajustes de nuevo — el
  // candado de confirmación por código queda cosmético, porque el camino
  // general lo esquiva.

  // Los canales del dock de la vitrina. Ver StoreLinks en types.ts.
  instagramHandle,
  mapsUrl,
  rappiUrl,
  pedidosYaUrl,
  uberEatsUrl,
})

export type StoreSettingsInput = z.infer<typeof storeSettingsInputSchema>

/**
 * `/admin/ajustes` (El local): datos, dirección + mapa, canales. `.pick()`
 * sobre `storeSettingsInputSchema` — no un objeto nuevo — porque así un campo
 * que cambia de forma en el schema base se propaga acá solo. Funciona porque
 * la normalización "las dos o ninguna" de lat/lng NO es un `.refine()` sobre
 * el objeto (ver el comentario de esa regla más arriba): un `ZodEffects` no
 * tiene `.pick()`.
 */
export const storeProfileInputSchema = storeSettingsInputSchema.pick({
  name: true,
  description: true,
  phoneE164: true,
  whatsappPhoneE164: true,
  address: true,
  latitude: true,
  longitude: true,
  instagramHandle: true,
  mapsUrl: true,
  rappiUrl: true,
  pedidosYaUrl: true,
  uberEatsUrl: true,
})
export type StoreProfileInput = z.infer<typeof storeProfileInputSchema>

/**
 * `/admin/ajustes/pedidos` (Pedidos y envío): pago en el local, envío propio,
 * programados, multiplicador de demanda ("tomando pedidos" se ve y se toca en
 * esta misma página, pero no viaja en este schema — ver el comentario de
 * `acceptingOrders` abajo). Estos campos viven juntos a propósito — ver
 * 00-architecture.md: `scheduledDeliveryEnabled` depende de `deliveryEnabled`
 * y los minutos de viaje entran al mismo cálculo de ETA que el multiplicador.
 */
export const storeOrderingInputSchema = storeSettingsInputSchema.pick({
  // `acceptingOrders` NO entra acá a propósito. Tiene su propio camino de
  // escritura inmediato en las DOS direcciones: apagar pasa por
  // `pauseScheduledNightAction` (el RPC `cancel_scheduled_orders` apaga
  // `accepting_orders` en la misma transacción que cancela los programados) y
  // prender por `resumeAcceptingOrdersAction` (ver store.model.ts). Si
  // siguiera acá, un submit del resto del formulario con el valor viejo en el
  // `useForm` pisaría — en cualquiera de los dos sentidos — una pausa o una
  // reapertura hecha desde otro dispositivo mientras la pantalla seguía
  // abierta. Ver 03-review.md, hallazgo bloqueante #1.
  inStorePaymentEnabled: true,
  minOrderCents: true,
  autoStartOrders: true,
  autoReadyOrders: true,
  deliveryEnabled: true,
  deliveryFeeCents: true,
  deliveryFreeFromCents: true,
  deliveryMinOrderCents: true,
  deliveryMinutes: true,
  deliveryBusyMinutes: true,
  scheduledDeliveryEnabled: true,
  scheduledCapacityPerNight: true,
  demandThresholdOrders: true,
  demandMultiplier: true,
})
export type StoreOrderingInput = z.infer<typeof storeOrderingInputSchema>

// ---------------------------------------------------------------------------
// Horarios de apertura y sus excepciones por fecha.
//
// Validan lo MISMO que las RPC `set_store_hours` / `set_store_hours_override`
// (migración `20260829140000_scheduled_orders_and_hours.sql`), duplicado a
// propósito —igual que `RESERVED_SLUGS`—: la base es la autoridad final, el
// schema hace que el mensaje se entienda antes de gastar un viaje a Postgres.
// ---------------------------------------------------------------------------

/** Igual que el CHECK de `store_hours`: 4 rangos por día como mucho, 28 en toda la semana. */
const MAX_RANGES_PER_DAY = 4
const MAX_RANGES_TOTAL = 28

export const storeHoursRangeSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0, '0 a 6').max(6, '0 a 6'),
  opensAtMinute: z.coerce.number().int().min(0).max(1439),
  durationMinutes: z.coerce.number().int().min(15, 'Mínimo 15 minutos').max(1440, 'Máximo 24 horas'),
})

/**
 * ¿Se superponen dos rangos en la línea CIRCULAR de la semana? Mismo truco que
 * la RPC: los desplazamientos ±10080 (una semana en minutos) hacen que
 * "domingo 22:00–02:00" y "lunes 01:00" se vean como lo que son, el mismo
 * tramo de tiempo, en vez de dos rangos que "casualmente" no se tocan en la
 * recta numérica.
 */
function overlapsCircularWeek(a: { start: number; duration: number }, b: { start: number; duration: number }): boolean {
  for (const offset of [0, 10080, -10080]) {
    if (a.start < b.start + offset + b.duration && b.start + offset < a.start + a.duration) return true
  }
  return false
}

export const storeHoursWeeklyInputSchema = z
  .array(storeHoursRangeSchema)
  .max(MAX_RANGES_TOTAL, `Como máximo ${MAX_RANGES_TOTAL} rangos entre todos los días`)
  .superRefine((ranges, ctx) => {
    const perDay = new Map<number, number>()
    for (const r of ranges) perDay.set(r.dayOfWeek, (perDay.get(r.dayOfWeek) ?? 0) + 1)
    for (const count of perDay.values()) {
      if (count > MAX_RANGES_PER_DAY) {
        ctx.addIssue({ code: 'custom', message: `Como máximo ${MAX_RANGES_PER_DAY} rangos por día` })
        return
      }
    }

    const absolute = ranges.map((r) => ({ start: r.dayOfWeek * 1440 + r.opensAtMinute, duration: r.durationMinutes }))
    for (let i = 0; i < absolute.length; i++) {
      for (let j = i + 1; j < absolute.length; j++) {
        if (overlapsCircularWeek(absolute[i], absolute[j])) {
          ctx.addIssue({ code: 'custom', message: 'Hay rangos de horario que se superponen' })
          return
        }
      }
    }
  })

export type StoreHoursWeeklyInput = z.infer<typeof storeHoursWeeklyInputSchema>

/** Solo la fecha: lo que necesita `delete_store_hours_override`. */
export const storeHoursOverrideDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const storeHoursOverrideRangeSchema = storeHoursRangeSchema.omit({ dayOfWeek: true })

export const storeHoursOverrideInputSchema = z
  .object({
    date: storeHoursOverrideDateSchema,
    isClosed: z.boolean(),
    ranges: z.array(storeHoursOverrideRangeSchema).max(MAX_RANGES_PER_DAY, `Como máximo ${MAX_RANGES_PER_DAY} rangos por fecha`),
  })
  .superRefine((value, ctx) => {
    if (value.isClosed) {
      // `ranges` no vacío con `isClosed: true` es justamente la forma que el
      // CHECK de la tabla rechaza (`store_hours_overrides_shape_check`): una
      // fecha cerrada no tiene rangos, no es "rangos que se ignoran".
      if (value.ranges.length > 0) {
        ctx.addIssue({ code: 'custom', message: 'Una fecha cerrada no lleva rangos propios', path: ['ranges'] })
      }
      return
    }

    if (value.ranges.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Una fecha abierta necesita al menos un rango', path: ['ranges'] })
      return
    }

    // Sin el módulo ±10080 de la semana: una excepción de fecha no se repite,
    // así que el solapamiento se chequea en la recta numérica simple.
    for (let i = 0; i < value.ranges.length; i++) {
      for (let j = i + 1; j < value.ranges.length; j++) {
        const a = value.ranges[i]
        const b = value.ranges[j]
        if (a.opensAtMinute < b.opensAtMinute + b.durationMinutes && b.opensAtMinute < a.opensAtMinute + a.durationMinutes) {
          ctx.addIssue({ code: 'custom', message: 'Hay rangos que se superponen en esa fecha', path: ['ranges'] })
          return
        }
      }
    }
  })

export type StoreHoursOverrideInput = z.infer<typeof storeHoursOverrideInputSchema>
