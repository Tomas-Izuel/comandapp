/**
 * Vocabulario compartido de todo el dominio.
 *
 * Solo tipos: ninguna función, ningún import de runtime. Es el contrato que
 * models, controllers y views usan para hablar entre sí. Si algo cambia de
 * forma, se cambia acá y TypeScript señala cada lugar que hay que tocar.
 *
 * Todos los montos son CENTAVOS enteros. Ver src/lib/money.ts.
 */

import type { Branding } from '@/models/schemas/branding.schema'
import type {
  DeliveryMethod,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/models/schemas/order.schema'

// ---------------------------------------------------------------------------
// Tienda
// ---------------------------------------------------------------------------

/**
 * Re-export de los enums del dominio.
 *
 * `types.ts` es el vocabulario compartido, así que tiene que poder nombrar un
 * estado sin obligar a cada consumidor a saber en qué archivo de schema vive.
 */
export type { DeliveryMethod, OrderStatus, PaymentMethod, PaymentStatus }

export type StoreStatus = 'active' | 'suspended'

/**
 * Los tres roles de una tienda.
 *
 * `courier` NO es staff, y eso no es una convención: `private.is_store_member()`
 * filtra por `role in ('owner','staff')`, así que un repartidor no tiene acceso
 * a catálogo, pedidos, pagos, branding ni Storage por RLS. Todo su acceso pasa
 * por las RPC `courier_queue` / `courier_advance_order`.
 */
export type StoreMemberRole = 'owner' | 'staff' | 'courier'

/**
 * Los canales propios del local, tal como los publica el dock de su vitrina.
 *
 * WhatsApp y dirección NO viven acá: son campos de `Store` desde el día uno y
 * tienen otros usos (el aviso de "pedido listo", el "dónde retirar" del
 * checkout). El dock los lee de ahí. Esto es solo lo que existe únicamente
 * para el dock.
 *
 * Instagram es el HANDLE, no una URL: la URL la arma la vista. Un campo de URL
 * libre rotulado "Instagram" es un link a cualquier lado con el logo de
 * Instagram al lado. Las tres apps de delivery sí son URL —cada local tiene su
 * ficha y no hay forma de derivarla— pero el host está acotado a la marca que
 * el botón dice, con un CHECK en Postgres y el mismo regex en Zod.
 */
export type StoreLinks = {
  instagramHandle: string | null
  mapsUrl: string | null
  rappiUrl: string | null
  pedidosYaUrl: string | null
  uberEatsUrl: string | null
}

export type Store = {
  id: number
  slug: string
  name: string
  description: string | null
  phoneE164: string | null
  whatsappPhoneE164: string | null
  /** Dirección del LOCAL. Es dónde el cliente va a retirar, así que no es opcional para él. */
  address: string | null
  timezone: string
  currency: string
  status: StoreStatus
  acceptingOrders: boolean
  inStorePaymentEnabled: boolean
  /**
   * Derivado: hay un access token de Mercado Pago guardado para esta tienda.
   * Lo mantiene un trigger en Postgres, nadie lo escribe a mano. Si es `false`
   * la vitrina no puede ofrecer "pagar ahora": el checkout fallaría después de
   * que el cliente ya dejó sus datos.
   */
  onlinePaymentEnabled: boolean
  /**
   * Derivado: existe una fila activa en `store_bank_accounts` para esta tienda.
   * Mismo criterio que `onlinePaymentEnabled` — lo mantiene un trigger, nadie
   * lo escribe a mano, y no tiene `grant update` para `authenticated`.
   *
   * `Store` NO gana `bankAccount`: el CBU le llega al cliente por
   * `OrderPublicView`, cuando el pedido ya existe y eligió transferencia. La
   * vitrina solo necesita saber si el método se puede ofrecer.
   */
  transferPaymentEnabled: boolean
  minOrderCents: number
  demandThresholdOrders: number
  demandMultiplier: number
  /** El pedido pasa a `preparing` solo, apenas se confirma. */
  autoStartOrders: boolean
  /** El pedido pasa a `ready` solo al cumplirse `etaAt`, y avisa al cliente. */
  autoReadyOrders: boolean
  /**
   * El punto que el dueño confirmó arrastrando el pin en Ajustes, no el que
   * devolvió el geocodificador. Van las dos o ninguna: un CHECK en Postgres lo
   * garantiza, así que `latitude !== null` implica `longitude !== null`.
   */
  latitude: number | null
  longitude: number | null
  links: StoreLinks
  delivery: StoreDelivery
  scheduling: StoreScheduling
}

/**
 * La configuración de envío propio del local.
 *
 * Va agrupada y no plana en `Store` porque se pasa entera a las funciones puras
 * de `src/lib/delivery.ts`, que son las únicas que saben calcular un envío.
 *
 * No hay campo de "cantidad de repartidores": la capacidad ES la cantidad de
 * repartidores activos invitados, y vive en `store_members`. Un número manual
 * al lado de una lista real se desincroniza el primer día.
 */
export type StoreDelivery = {
  enabled: boolean
  feeCents: number
  /** Subtotal a partir del cual el envío es $0. 0 = nunca gratis. */
  freeFromCents: number
  /** Subtotal mínimo para poder elegir delivery. 0 = sin mínimo propio. */
  minOrderCents: number
  /** Minutos de viaje cuando hay al menos un repartidor libre. */
  minutes: number
  /** Minutos de viaje cuando están todos en la calle. */
  busyMinutes: number
  /**
   * Si el repartidor cobra en la puerta. Lo decide el local.
   * En `false` el portal del repartidor NUNCA ve un monto — y no por una guarda
   * de TypeScript: `courier_queue` devuelve `collect: null` desde Postgres.
   */
  courierCollects: boolean
}

/**
 * La cuenta bancaria del local, en su versión PÚBLICA: lo que el cliente
 * necesita para transferir y nada más.
 *
 * Estos cuatro campos son exactamente las columnas con `grant select` para
 * `anon` en `store_bank_accounts` (más `store_id`). Si agregás un campo acá sin
 * agregar el grant, llega `null` en silencio; si agregás el grant sin pensarlo,
 * publicás un dato que no tenía que salir. Los dos lados se cambian juntos.
 *
 * `cbu` es nullable y no es un descuido: el dueño del producto decidió que se
 * pueda cargar cualquiera de los tres identificadores (CBU, CVU o alias). Un
 * CHECK en Postgres garantiza que haya al menos uno, así que
 * `cbu === null` implica `alias !== null`. El costo aceptado a conciencia es que
 * una cuenta cargada solo con alias no tiene checksum que validar: un error de
 * tipeo no se detecta y el local se entera cuando un cliente transfiere a otra
 * cuenta.
 */
export type StoreBankAccount = {
  /** CBU o CVU: 22 dígitos, el mismo campo cubre los dos. */
  cbu: string | null
  alias: string | null
  /** Titular DECLARADO por el dueño. Es lo que el cliente compara en su homebanking. */
  holderName: string
  /** Derivado del código de entidad (3 primeros dígitos del CBU). `null` si solo hay alias. */
  bankName: string | null
}

/**
 * La misma cuenta como la ve el panel del local, con lo que nunca sale al borde
 * público. Se lee con el admin client detrás de `requireStoreMembership`, igual
 * que `getPaymentConnectionStatus`.
 */
export type StoreBankAccountAdmin = StoreBankAccount & {
  holderTaxId: string | null
  isActive: boolean
  /**
   * Resultado del contraste con el proveedor de validación, si hubo. Es TODO lo
   * que sobrevive a esa llamada: el nombre del titular que devuelve la API es un
   * dato personal de un tercero y **no se persiste nunca** — ni en la base, ni
   * en un log, ni en el payload que llega al browser. El contraste se hace CUIT
   * contra CUIT y lo único que queda es este veredicto.
   *
   * `'unavailable'` es el estado normal hoy: no hay proveedor contratado, así
   * que el adapter por defecto no contrasta nada. Nunca se muestra al cliente
   * como un sello de "verificado" — no lo es.
   */
  holderMatch: 'match' | 'mismatch' | 'unavailable' | null
  checkedAt: string | null
}

/**
 * Lo que el dueño decidió sobre los pedidos programados.
 *
 * Va agrupado por el mismo motivo que `StoreDelivery`: se pasa entero a las
 * funciones puras de `src/lib/store-hours.ts`, que son las únicas que saben
 * armar una lista de slots.
 */
export type StoreScheduling = {
  /**
   * Si se puede programar un pedido CON envío. Es política del dueño; que haya
   * un repartidor activo es la realidad y se chequea aparte — mismo par que
   * `acceptingOrders` (decisión) y `onlinePaymentEnabled` (realidad).
   */
  deliveryEnabled: boolean
  /**
   * Tope de programados por noche. `null` = sin tope.
   *
   * Es un amortiguador de VOLUMEN, no de ráfaga: no impide que los programados
   * de la noche caigan todos juntos a las 21:00, y no cuenta los pedidos
   * inmediatos, que todavía no existen cuando el cliente elige el slot.
   */
  capacityPerNight: number | null
}

/**
 * Un rango de apertura.
 *
 * `durationMinutes` en vez de una hora de cierre, porque el cruce de medianoche
 * es la norma en una hamburguesería y `cierra < abre` deja los bordes ambiguos
 * (¿`abre == cierra` es 0 h o 24 h?). El rango pertenece al día que ABRE: "vie
 * 18:00–02:00" es un rango del viernes con `durationMinutes: 480`.
 *
 * `dayOfWeek` es 0 = domingo … 6 = sábado, la convención de `Date#getDay()`.
 * La lib corre también en el browser y pelear contra la convención de JS es
 * invitar al off-by-one. Que la UI arranque la semana en lunes es presentación.
 */
export type StoreHoursRange = {
  dayOfWeek: number
  opensAtMinute: number
  durationMinutes: number
}

/**
 * Una excepción por fecha: cierra un feriado que el patrón dice abierto, o abre
 * un día que el patrón dice cerrado.
 *
 * `ranges` vacío con `isClosed: true` es "cerrado ese día"; con `isClosed:
 * false` tiene al menos un rango y reemplaza al patrón para esa fecha.
 */
export type StoreHoursOverride = {
  /** `YYYY-MM-DD` en la zona del local. Es la fecha del día que ABRE. */
  date: string
  isClosed: boolean
  ranges: Omit<StoreHoursRange, 'dayOfWeek'>[]
}

/**
 * El calendario completo de un local.
 *
 * **Sin rangos semanales = siempre abierta.** Es la compatibilidad hacia atrás:
 * ninguna tienda existente tiene horarios cargados y ninguna puede amanecer
 * cerrada por un deploy. El horario es opt-in, como el delivery.
 */
export type StoreSchedule = {
  weekly: StoreHoursRange[]
  overrides: StoreHoursOverride[]
}

/**
 * El preview del diálogo destructivo (Q4/Q9 y Q14): cuántos programados de
 * `night` todavía no dispararon, cuántos de esos están pagos, y cuánta plata
 * hay que devolver a mano (Q8: sin auto-refund) si se confirma la
 * cancelación. Es una FOTO — `getScheduledNightSummary` en `order.model.ts`
 * usa el mismo predicado que `cancel_scheduled_orders`, pero entre que se
 * pinta el diálogo y se confirma un pedido puede disparar y salir del conteo:
 * "el diálogo puede decir 6 y cancelarse 5" es el comportamiento esperado.
 *
 * (Faltaba en el primer pase de contratos de T0 pese a estar nombrado en
 * `01-tasks.md`; se agrega acá con la forma exacta que ese documento ya
 * especificaba, sin inventar nada nuevo — T2 lo necesitaba para tipar
 * `getScheduledNightSummary`.)
 */
export type ScheduledNightSummary = {
  night: string
  count: number
  paidCount: number
  paidTotalCents: number
}

/**
 * Qué puede hacer el cliente en la vitrina ahora mismo.
 *
 * Es una unión discriminada y no un boolean porque son cinco situaciones con
 * mensajes y capacidades distintas, y una sola tiene un modo degradado:
 * `closed_by_hours` no deja pedir para ahora pero SÍ deja programar. Meter eso
 * adentro de `canTakeOrders()` colapsaría las cinco en un `true/false`.
 *
 * La precedencia es el orden de esta unión: la primera que pega define la
 * pantalla. `paused` gana sobre `closed_by_hours` a propósito — el dueño que
 * aprieta el botón rojo espera que se apague todo, y un pedido que igual entra
 * para el viernes es la sorpresa que hace que deje de confiar en el botón.
 */
export type StorefrontGate =
  | { kind: 'suspended' }
  | { kind: 'no_payment' }
  | { kind: 'paused' }
  /** Cerrada por horario. Es la ÚNICA que deja programar. */
  | { kind: 'closed_by_hours'; opensAt: string | null }
  | { kind: 'open' }

export type StoreWithBranding = Store & { branding: Branding }

export type StoreMember = {
  id: number
  storeId: number
  userId: string
  role: StoreMemberRole
  /** Obligatorio para un `courier`: es lo que ve el CLIENTE en el seguimiento. */
  displayName: string | null
  isActive: boolean
  createdAt: string
}

/**
 * Lo mínimo para elegir a quién asignarle un pedido: quién es y cuánto tiene
 * encima ahora.
 *
 * Existe separado de `CourierRow` porque los dos caminos que leen repartidores
 * divergieron de verdad, no por gusto. El selector del KDS lo opera CUALQUIER
 * staff y sale de `store_members` con el cliente RLS
 * (`listCouriersForAssignment`), que no puede tocar `auth.users` ni el
 * historial de entregas. Meter esos campos acá obligaría a inventarlos —
 * `email: ''`, métricas en cero— y un cero inventado en una columna de plata es
 * exactamente la clase de dato que después alguien lee como si fuera real.
 */
export type CourierOption = {
  id: number
  displayName: string
  isActive: boolean
  /** Pedidos en `ready` u `on_the_way` que tiene asignados. */
  assignedOrders: number
  /** > 0 = está repartiendo ahora mismo. */
  onTheWayOrders: number
}

/**
 * Fila del padrón de repartidores del dueño. Sale de la RPC `store_couriers`,
 * que es SECURITY DEFINER porque necesita `auth.users.last_sign_in_at` — igual
 * que `owner_email` en `platform_stores`— y agrega las métricas por repartidor.
 */
export type CourierRow = CourierOption & {
  userId: string
  email: string
  invitedAt: string | null
  /** null = lo invitaron y todavía no entró nunca. */
  lastSignInAt: string | null
  /**
   * Entregas cerradas hoy, cortadas por el día del LOCAL (`stores.timezone`),
   * no por el del servidor: un turno de noche cruza la medianoche UTC.
   */
  deliveriesToday: number
  /** Entregas cerradas en los últimos 30 días. */
  deliveries30d: number
  /**
   * Promedio de `on_the_way -> delivered` en minutos, últimos 30 días. Mide al
   * repartidor, no a la cocina.
   *
   * `null` = todavía no hay ni una entrega con `on_the_way_at` sellado (un
   * repartidor nuevo, o entregas cerradas desde el mostrador sin pasar por el
   * portal). No confundir con `0`, que es un promedio REAL de menos de un
   * minuto: son dos cosas distintas y la UI las dice distinto.
   */
  avgDeliveryMinutes: number | null
  /**
   * Plata que cobró en la puerta hoy, en centavos. Es un arqueo de caja —lo
   * que tiene encima al cerrar el turno—, no una métrica de ventas: cuenta
   * solo los pedidos que él marcó entregados con cobro
   * (`payment_ref = 'courier'`).
   */
  collectedTodayCents: number
  /** Lo mismo, acumulado en los últimos 30 días. */
  collected30dCents: number
}

/**
 * Capacidad de reparto del local en este instante.
 *
 * "Libre" = repartidor activo sin ningún pedido `on_the_way`. Con
 * `freeCouriers === 0` y `activeCouriers > 0` el checkout avisa que todos están
 * en la calle, pero **no bloquea el pedido**.
 */
export type CourierAvailability = { activeCouriers: number; freeCouriers: number }

/**
 * Resultado del alta de un repartidor (`inviteCourier`). El repartidor queda
 * SIEMPRE creado en `store_members` — `emailSent: false` no deshace esa fila,
 * solo dice que el mail de invitación no salió (Resend sin configurar, un
 * fallo de red, etc). Existe para que la UI pueda distinguir "invitado" de
 * "creado, pero avisale que reenvíe la invitación" en vez de un éxito ciego.
 */
export type InviteCourierResult = { courierId: number; emailSent: boolean }

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type MenuOption = {
  id: number
  name: string
  priceDeltaCents: number
  isAvailable: boolean
  position: number
}

export type MenuOptionGroup = {
  id: number
  name: string
  minSelect: number
  maxSelect: number
  position: number
  options: MenuOption[]
}

export type MenuProduct = {
  id: number
  categoryId: number | null
  name: string
  description: string | null
  imagePath: string | null
  imageUrl: string | null
  priceCents: number
  prepMinutes: number
  isAvailable: boolean
  position: number
  optionGroups: MenuOptionGroup[]
}

export type MenuCategory = {
  id: number
  name: string
  position: number
  isActive: boolean
  products: MenuProduct[]
}

export type Menu = {
  store: StoreWithBranding
  categories: MenuCategory[]
}

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

export type OrderItemOption = {
  id: number
  optionId: number | null
  nameSnapshot: string
  groupSnapshot: string | null
  priceDeltaCents: number
}

export type OrderItem = {
  id: number
  productId: number | null
  nameSnapshot: string
  unitPriceCents: number
  quantity: number
  totalCents: number
  prepMinutes: number
  notes: string | null
  options: OrderItemOption[]
}

export type Order = {
  id: number
  storeId: number
  shortCode: string
  publicToken: string
  status: OrderStatus
  customerName: string
  customerPhoneE164: string
  customerEmail: string | null
  notes: string | null
  currency: string
  subtotalCents: number
  totalCents: number
  basePrepMinutes: number | null
  demandMultiplier: number | null
  etaMinutes: number | null
  etaAt: string | null
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  preferenceId: string | null
  /** Cuándo deja de servir el link de pago. Lo devuelve Mercado Pago al crear la preferencia. */
  preferenceExpiresAt: string | null
  paymentRef: string | null
  externalRef: string | null
  confirmedAt: string | null
  paidAt: string | null
  readyAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  /** Cola de "plata que hay que devolver": se llena cuando el pago sobrevive al pedido. */
  needsRefundAt: string | null
  refundReason: string | null
  refundedAt: string | null
  createdAt: string
  items: OrderItem[]

  // --- Comprobante de transferencia ------------------------------------
  //
  // Solo se poblan cuando `paymentMethod === 'transfer'` y el cliente subió.
  // `path` se nulea al purgar el archivo; `uploadedAt`, `sizeBytes` y `sha256`
  // SOBREVIVEN a la purga a propósito: la huella queda, la imagen no. Es lo que
  // permite contestar "sí, hubo comprobante y era este" después del borrado.
  /** Path en el bucket privado `order-receipts`. `null` también significa "ya purgado". */
  transferReceiptPath: string | null
  /** Inmutable una vez no nula: es la invariante de "un comprobante por pedido". */
  transferReceiptUploadedAt: string | null
  transferReceiptMime: string | null
  transferReceiptSizeBytes: number | null
  transferReceiptSha256: string | null

  // --- Entrega ---------------------------------------------------------
  deliveryMethod: DeliveryMethod
  /** Congelado al crear el pedido. Es inmutable en el trigger: es plata. */
  deliveryFeeCents: number
  /** null para retiro. Un CHECK garantiza que un delivery siempre la tiene. */
  deliveryAddress: OrderDeliveryAddress | null
  /** Minutos de viaje que se sumaron al ETA, congelados. null para retiro. */
  deliveryMinutes: number | null
  courierId: number | null
  /** Sale del embed a `store_members`, no de una columna de `orders`. */
  courierName: string | null
  assignedAt: string | null
  onTheWayAt: string | null

  // --- Programado ------------------------------------------------------
  /**
   * Hora pactada de retiro, o de entrega en la puerta si es delivery.
   * `null` = pedido para ahora, o sea el comportamiento de siempre.
   *
   * Inmutable en el trigger: la promesa no se renegocia. Si hay que cambiarla,
   * se cancela el pedido y se hace otro — mover esto después del insert
   * significa que el cliente pagó por una hora y retira en otra.
   */
  scheduledFor: string | null
  /**
   * Cuándo entra al KDS: `scheduledFor − (cocción + viaje + 5 de margen)`.
   * `null` para un pedido inmediato.
   *
   * **Puede quedar en el PASADO y no es un bug.** El lead mínimo es de 60
   * minutos planos, así que un carrito pesado con envío necesita más
   * anticipación que eso y el pedido aparece en el tablero en el próximo poll.
   * Es la recuperación correcta ("ya vas tarde, arrancá"). No lo arregles.
   */
  fireAt: string | null
  /**
   * La NOCHE COMERCIAL del pedido (`YYYY-MM-DD`), no el día calendario.
   *
   * Un pedido para el sábado a la 01:30 de un local que abre viernes 18:00–02:00
   * pertenece a la noche del **viernes**. Lo deriva el servidor con
   * `commercialNightOf()` y se persiste porque es la unidad de tres cosas: el
   * tope por noche, el apagado destructivo y la bandeja de Programados. Con una
   * ventana de timestamps, las tres tendrían que recalcular el mismo almanaque.
   */
  scheduledNight: string | null
}

/**
 * La dirección del cliente, tal como la escribió.
 *
 * Texto libre, sin geocoding: el link de navegación se arma con una búsqueda
 * por texto. `unit` y `notes` NO van a Maps —"3º B" y "portón negro" no son
 * geocodificables—; el portal los muestra aparte, que es lo que el repartidor
 * lee cuando llega.
 */
export type OrderDeliveryAddress = {
  line: string
  unit: string | null
  between: string | null
  notes: string | null
}

/** Lo que ve el cliente en /pedido/[token] y en "mis pedidos". */
export type OrderPublicView = Pick<
  Order,
  | 'shortCode'
  | 'publicToken'
  | 'status'
  | 'customerName'
  | 'currency'
  | 'subtotalCents'
  | 'totalCents'
  | 'etaMinutes'
  | 'etaAt'
  | 'paymentMethod'
  | 'paymentStatus'
  | 'paidAt'
  | 'readyAt'
  | 'createdAt'
  | 'items'
  | 'deliveryMethod'
  | 'deliveryFeeCents'
  | 'deliveryAddress'
  | 'scheduledFor'
  | 'transferReceiptUploadedAt'
> & {
  storeName: string
  storeSlug: string
  /**
   * A dónde transferir. Se puebla SOLO cuando `paymentMethod === 'transfer'`, y
   * es el único camino por el que el CBU del local llega al cliente: ni el
   * catálogo ni el checkout lo muestran, porque un CBU visible sin un pedido
   * asociado es un dato que cualquiera scrapea y que no le sirve a nadie.
   *
   * Nunca trae el CUIT del titular ni el resultado del contraste: esas dos
   * columnas no tienen grant para `anon`.
   */
  bankAccount: StoreBankAccount | null
  /**
   * Solo el nombre de pila del repartidor, y solo mientras el pedido está en la
   * calle. Nunca apellido ni teléfono: esta vista la ve cualquiera con el token,
   * y el dato es de un empleado.
   */
  courierFirstName: string | null
  /**
   * Si el cliente todavia puede ir a pagar. La URL NO viaja acá a proposito: se
   * pide con `resumePaymentAction`, que la resuelve (o regenera la preferencia
   * si vencio) contra Mercado Pago en el momento. Un init_point guardado en la
   * vista publica se queda viejo justo cuando hace falta.
   */
  canResumePayment: boolean
}

/**
 * Resultado del cálculo de demora. `multiplier` es 1 cuando la cocina no está
 * saturada; cuando lo está, es el multiplicador configurado por la tienda.
 */
export type EtaEstimate = {
  baseMinutes: number
  multiplier: number
  /**
   * Minutos de viaje. 0 para retiro.
   *
   * Se SUMA después de multiplicar, no se multiplica: el multiplicador de
   * demanda es de la cocina, no de la moto. Una cocina con el doble de trabajo
   * no hace que el viaje tarde el doble.
   */
  deliveryMinutes: number
  /** `scaleUpInt(baseMinutes, multiplier) + deliveryMinutes` */
  etaMinutes: number
  activeOrders: number
  isBusy: boolean
}

/**
 * Todo lo que el checkout necesita para pintar la elección retiro/delivery,
 * calculado en el SERVIDOR.
 *
 * `totalWithDeliveryCents` viene ya sumado a propósito: el browser elige cuál de
 * los dos totales mostrar según el radio, pero no suma nada. El precio lo pone
 * el servidor, también el del envío.
 */
export type DeliveryQuote = {
  enabled: boolean
  /** Costo para ESTE subtotal, con "gratis desde" ya aplicado. */
  feeCents: number
  freeFromCents: number
  /** Cuánto falta para que el envío sea gratis. 0 = ya lo es, o nunca lo es. */
  missingForFreeCents: number
  minOrderCents: number
  /** Cuánto falta para llegar al mínimo de delivery. 0 = ya llega. */
  missingForMinimumCents: number
  available: boolean
  /** Es interfaz: se muestra tal cual al cliente. null si `available`. */
  unavailableReason: string | null
  /** Los minutos que se suman al ETA si elige delivery. */
  minutesToAdd: number
  /** Todos los repartidores en la calle. AVISA, no bloquea: nunca apaga `available`. */
  allCouriersBusy: boolean
  totalWithDeliveryCents: number
}

/**
 * Un pedido en la cola del repartidor. Sale de la RPC `courier_queue`.
 *
 * Lo que NO viaja acá es tan importante como lo que sí: ni `customerEmail`, ni
 * las notas del pedido, ni `paymentRef`, ni los ítems, ni ningún pedido que no
 * tenga asignado.
 */
export type CourierOrder = {
  orderId: number
  shortCode: string
  status: Extract<OrderStatus, 'ready' | 'on_the_way'>
  storeName: string
  customerName: string
  customerPhoneE164: string
  address: OrderDeliveryAddress
  /** Ya armada por el servidor, con `travelmode=driving`. */
  navigationUrl: string
  assignedAt: string
  /**
   * `null` si el local no activó el cobro en la puerta, si el pedido es online,
   * o si ya está pago. Cuando es null los centavos **no salen de Postgres**.
   */
  collect: {
    subtotalCents: number
    deliveryFeeCents: number
    totalCents: number
    currency: string
  } | null
}

export type CourierSession =
  | { status: 'unauthenticated' }
  | { status: 'not-a-courier'; email: string }
  | { status: 'ok'; email: string; courierName: string; orders: CourierOrder[] }

/** Un ítem del carrito ya valorizado CONTRA LA BASE, nunca contra el cliente. */
export type PricedItem = {
  productId: number
  name: string
  /**
   * La foto de la línea del carrito. Viaja acá y no se resuelve en la vista
   * porque el carrito del browser guarda SOLO `{productId, quantity, optionIds,
   * notes}`: no tiene con qué armar la URL. Sin esto el carrito rediseñado
   * mostraba marcos de foto vacíos, que es exactamente lo que el rediseño
   * vino a sacar.
   */
  imageUrl: string | null
  quantity: number
  unitPriceCents: number
  totalCents: number
  prepMinutes: number
  notes: string | null
  options: { optionId: number; name: string; groupName: string; priceDeltaCents: number }[]
}

export type PricedCart = {
  items: PricedItem[]
  subtotalCents: number
  totalCents: number
  basePrepMinutes: number
}

// ---------------------------------------------------------------------------
// Plataforma (backoffice)
// ---------------------------------------------------------------------------

export type PlatformStoreRow = Store & {
  ownerEmail: string | null
  ordersLast30: number
  revenueLast30Cents: number
  createdAt: string
}

export type PlatformMetrics = {
  totalStores: number
  activeStores: number
  ordersLast30: number
  revenueLast30Cents: number
  ordersToday: number
}

export type AuditEntry = {
  id: number
  actorEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  payload: Record<string, unknown>
  ip: string | null
  userAgent: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Dashboard del local
// ---------------------------------------------------------------------------

export type SalesPoint = { date: string; orders: number; revenueCents: number }

export type TopProduct = { productId: number | null; name: string; quantity: number; revenueCents: number }

/**
 * Lo que devuelve `public.store_dashboard`. La agregacion vive en Postgres: en
 * TypeScript se topaba con `max_rows` de PostgREST (1000 filas) y truncaba la
 * facturacion en silencio. `ordersByStatus` llega solo con los estados
 * presentes; el enum completo con ceros lo completa el modelo, para que
 * ORDER_STATUSES siga siendo la unica fuente.
 */
export type StoreDashboardRpc = {
  salesByDay: SalesPoint[]
  topProducts: TopProduct[]
  ordersByStatus: Partial<Record<OrderStatus, number>>
  averageTicketCents: number
  prepAccuracy: { avgRealMinutes: number; avgEstimatedMinutes: number; sampleSize: number }
}

export type StoreDashboard = {
  salesByDay: SalesPoint[]
  topProducts: TopProduct[]
  ordersByStatus: Record<OrderStatus, number>
  averageTicketCents: number
  /** Minutos reales de preparación (paid_at → ready_at) vs lo que estimamos. */
  prepAccuracy: { avgRealMinutes: number; avgEstimatedMinutes: number; sampleSize: number }
}

// ---------------------------------------------------------------------------
// Resultado uniforme para Server Actions
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

// ---------------------------------------------------------------------------
// Padrón de clientes
//
// El cliente no tiene cuenta: esto es lo que tipeó al pedir, consolidado por
// tienda. La identidad es el teléfono normalizado, porque el email es opcional
// a propósito y el nombre no identifica a nadie.
//
// `avgTicketCents` y `daysSinceLastOrder` NO son columnas: los deriva la RPC
// `store_customer_directory`. Guardarlos sería invitar al drift a cambio de
// nada.
// ---------------------------------------------------------------------------

export type StoreCustomer = {
  id: number
  storeId: number
  /** Clave de identidad junto a storeId. Normalizado a E.164. */
  phoneE164: string
  displayName: string
  /** Null cuando el cliente nunca dejó mail. Sin esto, no entra a una campaña. */
  email: string | null
  ordersCount: number
  /** Centavos enteros. Solo plata que el local se quedó por comida que entregó. */
  totalSpentCents: number
  /** Derivado: totalSpentCents / ordersCount. Con cero pedidos es 0. */
  avgTicketCents: number
  /** Señal operativa (el que reserva y no aparece), no plata. */
  cancelledOrdersCount: number
  firstOrderAt: string | null
  lastOrderAt: string | null
  /** Derivado. Null cuando nunca compró. Es la señal de churn. */
  daysSinceLastOrder: number | null
  /** Baja de promociones. Cuando está, el `mailto:` se desactiva. */
  marketingOptOutAt: string | null
  notes: string | null
}

/**
 * Lo único que necesita la página pública de `/baja/[token]`: de qué local es
 * la baja, y si ya estaba dada de baja.
 *
 * Es el NOMBRE DEL LOCAL, no el del cliente. La baja es por tienda —el padrón
 * es por tienda— así que alguien que come en tres locales tiene tres bajas
 * distintas, y una página que no dice cuál es está pidiendo que el cliente
 * confirme a ciegas.
 *
 * Y no lleva nada más: ni plata, ni historial, ni el nombre del cliente. Lo
 * único que autoriza esta página es un token que llegó por mail, así que todo
 * dato de más es algo que se le confirma a quien tenga el link.
 */
export type UnsubscribeTarget = {
  storeName: string
  alreadyOptedOut: boolean
}

export type CustomerDirectory = {
  /** Ordenado por plata gastada, descendente. Es el requisito literal. */
  customers: StoreCustomer[]
  totals: {
    customers: number
    /** Literal: tiene mail cargado. No descuenta los dados de baja. */
    withEmail: number
    /** Sin comprar hace 30 días o más. */
    inactive30: number
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
//
// El vocabulario compartido de los baldes. La unión es CERRADA a propósito: un
// bucket es una fila en `public.rate_limits` y una entrada en
// `RATE_LIMIT_POLICY`, así que inventar uno suelto en un `string` da un límite
// que no existe y que nadie configuró — o sea, ningún límite.
//
// Los números (cuánto y en qué ventana) NO viven acá: viven en
// `src/lib/rate-limit-policy.ts`. Acá está QUÉ se limita, allá CUÁNTO.
// ---------------------------------------------------------------------------

export type RateLimitBucket =
  // Magic link del panel. Cuatro baldes sobre el mismo endpoint porque cada uno
  // frena un abuso distinto: por email (alguien martillando una casilla), por
  // IP (un script), y el global, que es un PRESUPUESTO — ver la nota en
  // rate-limit-policy.ts.
  | 'magic_link:email'
  | 'magic_link:email:day'
  | 'magic_link:ip'
  | 'magic_link:global'
  // Seguimiento y compra.
  | 'lookup:ip'
  // No es un límite: es un dedupe. Con `limit: 1` sobre la `idempotencyKey`,
  // exactamente UNA de N requests concurrentes recibe `allowed: true` —el
  // contador de Postgres es atómico— y es la única que gasta cupo de los
  // baldes reales. Sin esto, un doble tap con mala señal (el caso que la
  // idempotencia existe para proteger) gasta dos cupos por una sola compra.
  | 'order:idempotency'
  | 'order:phone'
  | 'order:store'
  // Invitaciones y cambios sensibles: todos mandan mail, todos son autenticados.
  | 'courier_invite:store'
  | 'courier_invite:email'
  | 'owner_invite:store'
  | 'owner_invite:admin'
  | 'payment_change:store'
  | 'support:store'
  | 'support:store:day'
  // Cambiar la cuenta bancaria redirige TODA la plata que el local cobra por
  // transferencia, igual que cambiar el access token de Mercado Pago. Mismo
  // balde, mismo modo: `onError: 'deny'`.
  | 'bank_account_change:store'
  // Subida del comprobante. Es el único endpoint del producto que acepta un
  // archivo de alguien sin sesión: lo único que lo autoriza es el
  // `public_token` del pedido.
  //
  // `receipt:order` es la ventana anti-abuso que pidió el dueño y NO es la regla
  // de negocio: "un comprobante por pedido" la sostienen el trigger de Postgres
  // y el CAS de la aplicación. Este balde solo evita que alguien con el token
  // martille el endpoint.
  | 'receipt:order'
  | 'receipt:ip'
  // `/baja/[token]` es público y recibe tokens, o sea superficie de sondeo.
  // Laxo por el CGNAT móvil, mismo criterio que `receipt:ip`.
  | 'unsubscribe:ip'

export type RateLimitDecision = {
  allowed: boolean
  /** Cuántas llamadas quedan en la ventana. Nunca negativo. */
  remaining: number
  /** Segundos hasta que la ventana rote. Va tal cual en el header `Retry-After`. */
  retryAfterSeconds: number
}
