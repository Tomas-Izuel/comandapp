'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleAlert, Info, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { MercadoPago } from '@/components/ui/mercadopago'
import { Price } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import { ActionBar, Panel } from '@/views/shared/surfaces'
import { useCart, saveOrderRef } from '@/lib/cart'
import { getSavedCustomer, saveCustomer, clearSavedCustomer } from '@/lib/customer'
import { useCheckoutQuote } from '@/views/storefront/use-priced-cart'
import { storeHref, useStoreBasePath } from '@/views/storefront/store-base-path'
import { formatCentsCompact } from '@/lib/money'
import { formatTime } from '@/lib/dates'
import { usePreviewMode } from '@/lib/preview-mode'
import { cn } from '@/lib/utils'
import { SCHEDULE_LEAD_MINUTES } from '@/lib/store-hours'
import { buildScheduleGroups, formatOpensAtShort } from '@/views/storefront/schedule-lib'
import { SchedulePicker } from '@/views/storefront/schedule-picker'
import type { PaymentMethod, DeliveryMethod } from '@/models/schemas/order.schema'
import type { StoreSchedule } from '@/models/types'

/**
 * El paso donde se decide de verdad. Operate: cada bloque es su propia
 * tarjeta —datos, cómo lo recibís, pedido, pago— para que se pueda barrer
 * con el pulgar y volver a uno solo sin perder los demás.
 *
 * La cotización (`useCheckoutQuote`) revalida el carrito contra la base y
 * muestra el ETA ANTES del método de pago — divulgación honesta, nunca una
 * sorpresa post-cobro. La misma respuesta trae `delivery`: el costo, el
 * mínimo y la disponibilidad del envío YA calculados contra la config de la
 * tienda. El browser no suma nada — ni plata ni minutos — solo elige cuál de
 * los dos totales/ETA mostrar según el método que el cliente marcó.
 *
 * Pedidos programados (Q3/Q5/Q10/Q11/Q2): los turnos se calculan ACÁ, en el
 * cliente, con `scheduleSlots()` sobre los horarios que la page ya trajo —
 * sin round-trip nuevo. Lo único que SÍ necesita al servidor es qué noches
 * ya llegaron al tope (`fullNights` de la cotización), porque la ocupación
 * no es un dato que el browser pueda derivar solo. El lead mínimo es un piso
 * PLANO de 60 minutos (`SCHEDULE_LEAD_MINUTES`) — no depende de la cocción
 * ni del envío: es una decisión de producto explícita (Q11, ver
 * `00-architecture.md` §2.2), no una fórmula que falte terminar acá.
 */
export function CheckoutForm({
  storeSlug,
  currency,
  storeAddress,
  inStorePaymentEnabled,
  onlinePaymentEnabled,
  transferPaymentEnabled,
  timezone,
  schedule,
  scheduledDeliveryEnabled,
  forced,
  opensAt,
}: {
  storeSlug: string
  currency: string
  storeAddress: string | null
  inStorePaymentEnabled: boolean
  onlinePaymentEnabled: boolean
  transferPaymentEnabled: boolean
  timezone: string
  /** Horarios + excepciones del local — con qué `scheduleSlots()` arma la grilla. */
  schedule: StoreSchedule
  scheduledDeliveryEnabled: boolean
  /**
   * `storefrontGate() === 'closed_by_hours'`: "para ahora" deja de existir,
   * programar es la única rama. Lo resolvió la page — acá no se recalcula
   * el gate, sería un segundo cálculo del mismo booleano en dos lugares.
   */
  forced: boolean
  /** Próxima apertura, solo con sentido cuando `forced`. */
  opensAt: string | null
}) {
  const router = useRouter()
  const { lines, hydrated, ensureIdempotencyKey, couponCode: cartCouponCode, setCouponCode } = useCart()
  // Vista previa embebida desde `/admin/apariencia` (?preview=brand): el
  // único punto donde el pedido se crea DE VERDAD es este submit, así que la
  // guarda va acá — un solo lugar, no un botón deshabilitado por página.
  // Todo lo demás (navegar, abrir un producto, elegir opciones, agregar al
  // carrito) sigue andando: el pedido del dueño real, no el de la vista
  // previa, es lo único que no puede pasar.
  const isPreview = usePreviewMode()
  const basePath = useStoreBasePath()

  // Métodos de pago REALMENTE disponibles, como lista y no como un booleano
  // binario. El bug que esto reemplaza (`bothPaymentMethodsAvailable = online
  // && inStore`) mandaba `in_store` con transferencia habilitada y sin las
  // otras dos: el pedido nacía `confirmed` e IMPAGO y la cocina cocinaba
  // gratis (00-architecture.md §2.2, ítem 1). Con la lista: cero disponibles
  // no debería llegar acá (ya lo corta `canTakeOrders` antes del checkout),
  // uno solo se usa sin radio que mostrar, dos o más arman el `RadioGroup`.
  // Depende solo de props, así que es una lectura, no un estado.
  const availablePaymentMethods: PaymentMethod[] = [
    onlinePaymentEnabled ? 'online' : null,
    transferPaymentEnabled ? 'transfer' : null,
    inStorePaymentEnabled ? 'in_store' : null,
  ].filter((method): method is PaymentMethod => method !== null)

  // Con un solo medio de cobro disponible no hay nada que elegir: el estado
  // arranca directo en el único que existe, en vez de en 'online' a secas
  // (que rompía la pantalla si el local solo tiene pago al retirar).
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>(availablePaymentMethods[0] ?? 'in_store')
  const [customerName, setCustomerName] = React.useState('')
  const [customerPhone, setCustomerPhone] = React.useState('')
  const [customerEmail, setCustomerEmail] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [deliveryMethod, setDeliveryMethod] = React.useState<DeliveryMethod>('pickup')
  const [deliveryAddressLine, setDeliveryAddressLine] = React.useState('')
  const [deliveryAddressUnit, setDeliveryAddressUnit] = React.useState('')
  const [deliveryAddressBetween, setDeliveryAddressBetween] = React.useState('')
  const [deliveryAddressNotes, setDeliveryAddressNotes] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [rememberedContact, setRememberedContact] = React.useState(false)

  // Texto del campo de cupón. Empieza vacío y se precarga UNA vez con lo que
  // ya había en el carrito (`cartCouponCode`) apenas hidrata — mismo criterio
  // que la memoria de contacto de más abajo: sin esto, un cliente que volvió
  // al checkout con un cupón ya guardado vería el campo en blanco aunque el
  // carrito lo tenga.
  const [couponInput, setCouponInput] = React.useState('')
  const [couponPrefilled, setCouponPrefilled] = React.useState(false)
  React.useEffect(() => {
    if (couponPrefilled || !hydrated) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- precarga única al hidratar, no un sync loop
    setCouponInput(cartCouponCode ?? '')
    setCouponPrefilled(true)
  }, [hydrated, cartCouponCode, couponPrefilled])

  // Foco al primer error tras un submit fallido: mostrar el mensaje no
  // alcanza si el cliente no lo ve, y en mobile el error queda arriba del
  // fold sin el teclado abierto.
  const nameRef = React.useRef<HTMLInputElement>(null)
  const phoneRef = React.useRef<HTMLInputElement>(null)
  const emailRef = React.useRef<HTMLInputElement>(null)
  const deliveryLineRef = React.useRef<HTMLInputElement>(null)
  const fieldRefs: Record<string, React.RefObject<HTMLInputElement | null>> = {
    customerName: nameRef,
    customerPhone: phoneRef,
    customerEmail: emailRef,
    deliveryAddressLine: deliveryLineRef,
  }
  // El error de `scheduledFor` no tiene un `<input>` propio al que llevarle
  // el foco (es un radiogroup de horarios) — el encabezado de la sección es
  // el destino, con `tabIndex={-1}` para poder enfocarlo desde JS.
  const scheduleHeadingRef = React.useRef<HTMLHeadingElement>(null)

  // "Para ahora" / "Programar". Con la tienda cerrada por horario (`forced`)
  // no hay nada que elegir: programar es la única rama desde el arranque.
  const [scheduleMode, setScheduleMode] = React.useState<'now' | 'schedule'>(forced ? 'schedule' : 'now')
  const [scheduledIso, setScheduledIso] = React.useState<string | null>(null)
  const [activeNight, setActiveNight] = React.useState<string | null>(null)

  // Memoria de contacto: si el cliente ya pidió una vez, no le volvemos a
  // pedir sus datos. Se lee después del primer render (recién ahí existe
  // `window`) para no pisar el HTML hidratado con contenido distinto. La
  // dirección de delivery se precarga igual, aunque el método arranque
  // siempre en 'pickup': si el cliente cambia a delivery, los campos ya
  // están completos en vez de en blanco.
  React.useEffect(() => {
    const saved = getSavedCustomer()
    if (!saved) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- precarga única al montar, no un sync loop
    if (saved.name) setCustomerName(saved.name)
    if (saved.phone) setCustomerPhone(saved.phone)
    if (saved.email) setCustomerEmail(saved.email)
    if (saved.deliveryAddressLine) setDeliveryAddressLine(saved.deliveryAddressLine)
    if (saved.deliveryAddressUnit) setDeliveryAddressUnit(saved.deliveryAddressUnit)
    if (saved.deliveryAddressBetween) setDeliveryAddressBetween(saved.deliveryAddressBetween)
    if (saved.deliveryAddressNotes) setDeliveryAddressNotes(saved.deliveryAddressNotes)
    setRememberedContact(true)
  }, [])

  function handleForgetContact() {
    clearSavedCustomer()
    setCustomerName('')
    setCustomerPhone('')
    setCustomerEmail('')
    setDeliveryAddressLine('')
    setDeliveryAddressUnit('')
    setDeliveryAddressBetween('')
    setDeliveryAddressNotes('')
    setRememberedContact(false)
  }

  // Mismo criterio que `effectiveDeliveryMethod` de más abajo: si el método
  // elegido dejó de estar en la lista (la cotización se refrescó y la config
  // de la tienda cambió a mitad de checkout), se usa el primero que sigue
  // disponible en vez de mandar un método que ya no existe. Se calcula ANTES
  // de pedir la cotización porque viaja en la misma request: un cupón
  // restringido a un medio de pago se re-evalúa cada vez que este valor
  // cambia (00-architecture.md §5.9.4).
  const effectivePaymentMethod: PaymentMethod = availablePaymentMethods.includes(paymentMethod)
    ? paymentMethod
    : (availablePaymentMethods[0] ?? 'in_store')

  const quote = useCheckoutQuote(storeSlug, hydrated ? lines : [], {
    paymentMethod: effectivePaymentMethod,
    couponCode: cartCouponCode,
  })
  const delivery = quote.status === 'ready' ? quote.data.delivery : null

  // Derivado, no sincronizado con un efecto: si el envío deja de estar
  // disponible (o de estar habilitado) mientras estaba elegido —la
  // cotización se refresca y la config de la tienda cambió, o todos los
  // repartidores se dieron de baja— se lo trata como retiro para mostrar y
  // para mandar, sin esperar un render extra ni tocar el estado que el
  // cliente sí controló con el radio.
  const effectiveDeliveryMethod: DeliveryMethod =
    deliveryMethod === 'delivery' && (!delivery || !delivery.enabled || !delivery.available) ? 'pickup' : deliveryMethod

  // El pago en el local convive con delivery: el repartidor cobra en la
  // puerta (`store.delivery.courierCollects`), así que "pagás al retirar" es
  // falso cuando el pedido se entrega a domicilio. Un solo lugar para las
  // tres apariciones de este texto, para no dejar dos redacciones distintas
  // de la misma regla en la misma pantalla. Sin nombrar un medio de pago
  // puntual (efectivo/tarjeta): eso no lo sabemos desde acá.
  const inStorePaymentLabel = effectiveDeliveryMethod === 'delivery' ? 'Pagar al recibirlo' : 'Pagar al retirar'
  const inStorePaymentHint =
    effectiveDeliveryMethod === 'delivery' ? 'Pagás cuando te lo entreguen.' : 'Reservás el pedido ahora y pagás en el local.'

  // El "ahora" del selector de horario. Arranca UNA vez —todo lo que sigue
  // ya pasó el corte de `!hydrated` de más abajo (o sea que ya es 100%
  // cliente), así que el valor inicial no arriesga un mismatch de
  // hidratación— pero DESPUÉS se refresca solo: el lead mínimo es un piso
  // PLANO de 60 minutos, así que una sesión de checkout larga (la app en
  // segundo plano mientras el cliente consulta con quien va a comer, algo
  // habitual en mobile) corre el turno más próximo hacia adelante. Sin este
  // refresco, la grilla seguía ofreciendo un horario que ya no cumplía el
  // lead real y el cliente se comía un `DomainError` recién al confirmar.
  // Mismo intervalo que ya usa el poll de `/pedido/[token]` en estado
  // estable (`order-tracking.tsx`), no uno nuevo inventado acá.
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const schedulingActive = forced || scheduleMode === 'schedule'
  // `delivery.available` ya excluye "sin repartidores activos" y "por debajo
  // del mínimo de envío" (`buildDeliveryQuote`, `src/lib/delivery.ts`) — no
  // hace falta un dato nuevo en la cotización para la guarda de Q2 ("delivery
  // programado exige ≥1 repartidor activo al ofrecer los slots").
  const deliverySchedulable = scheduledDeliveryEnabled && !!delivery?.available
  const schedulingBlockedByDelivery = schedulingActive && effectiveDeliveryMethod === 'delivery' && !deliverySchedulable

  // Sin la cotización lista no hay `fullNights` todavía: se espera antes de
  // pintar la grilla, en vez de mostrar turnos que capaz están completos
  // para deshabilitarlos un instante después con un salto de layout.
  const scheduleGroups = React.useMemo(() => {
    if (quote.status !== 'ready') return null
    return buildScheduleGroups({
      schedule,
      from: now,
      timeZone: timezone,
      leadMinutes: SCHEDULE_LEAD_MINUTES,
      fullNights: quote.data.fullNights ?? [],
    })
  }, [quote, schedule, timezone, now])

  // Con la tienda cerrada por horario, el primer turno posible se precarga
  // solo (menos toques para "quiero pedir para cuando abran"), siempre
  // corregible desde la grilla.
  React.useEffect(() => {
    if (!forced || scheduledIso || !scheduleGroups) return
    const firstAvailable = scheduleGroups.find((g) => g.slots.length > 0)
    if (!firstAvailable) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default único al llegar la cotización, no un sync loop
    setScheduledIso(firstAvailable.slots[0].toISOString())
    setActiveNight(firstAvailable.night)
  }, [forced, scheduleGroups, scheduledIso])

  // Si el turno elegido queda AFUERA de la grilla recién recalculada —el
  // lead se corrió porque pasó el tiempo (el refresco de `now` de arriba), o
  // la noche se llenó en el medio (`fullNights` cambió)— se descarta acá en
  // vez de dejar que el cliente lo confirme y se coma el `DomainError` del
  // servidor. En modo forzado (`forced`) el efecto de arriba vuelve a elegir
  // el primer turno disponible solo, apenas `scheduledIso` queda en `null`.
  React.useEffect(() => {
    if (!scheduledIso || !scheduleGroups) return
    const stillOffered = scheduleGroups.some((g) => g.slots.some((slot) => slot.toISOString() === scheduledIso))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacciona a que el TIEMPO pasó (fuera de React), no a un cambio que ya vino de un evento
    if (!stillOffered) setScheduledIso(null)
  }, [scheduleGroups, scheduledIso])

  const opensAtLabel = opensAt ? formatOpensAtShort(opensAt, timezone) : null

  if (!hydrated) return null

  if (lines.length === 0) {
    return (
      <EmptyState
        className="flex-1"
        title="Tu carrito está vacío"
        description="Agregá algo de la carta antes de pasar al checkout."
        action={
          <Button asChild size="lg" className="h-11 rounded-pill">
            <Link href={storeHref(basePath, '/')}>Ver la carta</Link>
          </Button>
        }
      />
    )
  }

  const belowMinimum = quote.status === 'ready' && quote.data.priced.subtotalCents < quote.data.store.minOrderCents
  const couponQuote = quote.status === 'ready' ? quote.data.priced.coupon : null

  /**
   * Aplica o cambia el cupón: lo que hay tipeado pasa al carrito
   * (`setCouponCode`, que ya descarta la `idempotencyKey` — un cupón cambia
   * la plata igual que una línea) y la próxima cotización lo manda solo. Un
   * código vacío es lo mismo que quitarlo.
   */
  function handleApplyCoupon() {
    const trimmed = couponInput.trim().toUpperCase()
    setCouponInput(trimmed)
    setCouponCode(trimmed || null)
  }

  /**
   * El input vive DENTRO del `<form>` del checkout: sin el `preventDefault`,
   * Enter dispara el submit nativo y manda el pedido a precio lleno con el
   * código tipeado y sin aplicar — justo la pérdida silenciosa que el resto
   * de este cupón evita en todos los demás casos. Bloquear el submit no
   * alcanza solo: en mobile el teclado ofrece "Enter"/"Ir" apenas se termina
   * de tipear un código, y es el gesto esperado, no el botón "Aplicar" al
   * lado. Cablea al mismo handler que el botón, con la misma guarda
   * (nada que aplicar, o el código no cambió).
   */
  function handleCouponKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!couponInput.trim() || couponInput.trim() === (cartCouponCode ?? '')) return
    handleApplyCoupon()
  }

  function handleRemoveCoupon() {
    setCouponInput('')
    setCouponCode(null)
  }

  /**
   * El texto de "Cómo pagás" cuando hay un solo método habilitado (sin radio
   * que mostrar). Una función en vez de un ternario de tres ramas metido en el
   * JSX: es la misma información que las opciones del `RadioGroup` de abajo,
   * solo que sin nada que elegir.
   */
  function singleMethodNotice(method: PaymentMethod) {
    if (method === 'online') {
      return (
        <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-sm">
          <MercadoPago aria-hidden className="h-3.5 w-auto shrink-0" />
          Pagás online con Mercado Pago en el siguiente paso.
        </p>
      )
    }
    if (method === 'transfer') {
      return (
        <p className="text-muted-foreground px-1 text-sm">
          Pagás por transferencia bancaria — te mostramos el CBU y el monto exacto en el siguiente paso.
        </p>
      )
    }
    return (
      <p className="text-muted-foreground px-1 text-sm">
        {effectiveDeliveryMethod === 'delivery' ? 'Pagás cuando te lo entreguen.' : 'Pagás al retirar en el local.'}
      </p>
    )
  }

  /**
   * El texto del botón primario. Antes era un ternario binario
   * (online → "Ir a pagar", cualquier otra cosa → el texto de pago en el
   * local) que quedaba mal con transferencia: no es "Pagás al retirar", es
   * "vas a transferir". Separado acá para no anidar un tercer nivel de
   * ternario adentro del JSX del botón.
   */
  function submitButtonLabel(): React.ReactNode {
    if (isPreview) return 'No disponible en la vista previa'
    if (submitting) {
      return (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Confirmando…
        </>
      )
    }
    if (effectivePaymentMethod === 'online') return 'Ir a pagar'

    const scheduleSuffix = schedulingActive && scheduledIso ? ` para las ${formatTime(scheduledIso, timezone)}` : ''
    const paymentSuffix =
      effectivePaymentMethod === 'transfer'
        ? 'Pagás por transferencia'
        : effectiveDeliveryMethod === 'delivery'
          ? 'Pagás cuando te lo entreguen'
          : 'Pagás al retirar'

    return `Confirmar pedido${scheduleSuffix} · ${paymentSuffix}`
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

    // Barrera real, no solo cosmética: el botón ya llega `disabled`, pero un
    // `submit` disparado por Enter en un campo de texto no pasa por el botón.
    if (isPreview) return

    if (quote.status !== 'ready') return

    // Se genera al confirmar, no al montar el checkout, y se reusa en cada
    // reintento de este mismo intento de compra: si se regenerara acá cada
    // vez, un doble tap o un reintento de red seguirían creando dos pedidos.
    const idempotencyKey = ensureIdempotencyKey()

    setSubmitting(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeSlug,
          idempotencyKey,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            optionIds: l.optionIds,
            notes: l.notes ?? undefined,
          })),
          paymentMethod: effectivePaymentMethod,
          // Se manda tal cual está en el carrito, aplicado o rechazado: si
          // dejó de valer justo al confirmar (alguien más agotó el cupo, el
          // dueño lo pausó), `createOrder` corta con el mismo motivo que ya
          // se vio en pantalla — nunca se cobra de más en silencio
          // (00-architecture.md §5.9.2).
          couponCode: cartCouponCode ?? undefined,
          customerName,
          customerPhone,
          customerEmail: customerEmail.trim() || undefined,
          notes: notes.trim() || undefined,
          deliveryMethod: effectiveDeliveryMethod,
          // Solo viajan si el método es delivery: en un retiro no hay
          // dirección que mandar, y `undefined` (no `''`) para lo que quedó
          // en blanco es lo que `optionalText` de `createOrderSchema` espera
          // para tratarlo como ausente.
          deliveryAddressLine: effectiveDeliveryMethod === 'delivery' ? deliveryAddressLine.trim() || undefined : undefined,
          deliveryAddressUnit: effectiveDeliveryMethod === 'delivery' ? deliveryAddressUnit.trim() || undefined : undefined,
          deliveryAddressBetween: effectiveDeliveryMethod === 'delivery' ? deliveryAddressBetween.trim() || undefined : undefined,
          deliveryAddressNotes: effectiveDeliveryMethod === 'delivery' ? deliveryAddressNotes.trim() || undefined : undefined,
          // El browser manda el INSTANTE que eligió de la lista de slots,
          // nunca una hora de pared: el servidor deriva `fireAt`/`scheduledNight`
          // y vuelve a validar horario, lead y tope contra la base.
          scheduledFor: schedulingActive && scheduledIso ? scheduledIso : undefined,
        }),
      })
      const body = await res.json()

      if (!res.ok) {
        setFormError(body.error ?? 'No se pudo crear el pedido')
        if (typeof body.field === 'string') {
          setFieldErrors({ [body.field]: body.error })
          // `scheduledFor` no tiene un `<input>` propio (es un radiogroup de
          // horarios): el foco va al encabezado de la sección, no a un campo.
          if (body.field === 'scheduledFor') {
            scheduleHeadingRef.current?.focus()
          } else {
            fieldRefs[body.field]?.current?.focus()
          }
        }
        setSubmitting(false)
        return
      }

      saveOrderRef({ token: body.token, shortCode: body.shortCode, storeSlug: body.storeSlug, createdAt: new Date().toISOString() })
      // Guardar recién acá, después de un pedido creado con éxito: guardar en
      // cada keystroke deja basura a medio escribir si el cliente abandona.
      saveCustomer({
        name: customerName.trim() || undefined,
        phone: customerPhone.trim() || undefined,
        email: customerEmail.trim() || undefined,
        ...(effectiveDeliveryMethod === 'delivery'
          ? {
              deliveryAddressLine: deliveryAddressLine.trim() || undefined,
              deliveryAddressUnit: deliveryAddressUnit.trim() || undefined,
              deliveryAddressBetween: deliveryAddressBetween.trim() || undefined,
              deliveryAddressNotes: deliveryAddressNotes.trim() || undefined,
            }
          : {}),
      })

      // A propósito NO se vacía el carrito acá (F-01 de la auditoría). Si la
      // navegación a Mercado Pago falla por señal —el escenario declarado
      // como el 90% del tráfico— el cliente vuelve a este mismo carrito en
      // vez de aterrizar en "Tu carrito está vacío" con un pedido `pending`
      // que no puede retomar. La clave de idempotencia sigue intacta
      // (no se tocó el carrito, así que `ensureIdempotencyKey` no la
      // descartó), así que un reintento del submit devuelve ESTE pedido en
      // vez de crear uno nuevo. El carrito se vacía recién cuando el pedido
      // se ve pagado: `clearResolvedOrderCart(storeSlug)` en `lib/cart.tsx`,
      // que llama el seguimiento del pedido al ver `approved` (o al
      // confirmar uno de pago en el local).

      if (typeof body.redirectUrl === 'string' && body.redirectUrl.startsWith('/')) {
        router.push(body.redirectUrl)
      } else {
        window.location.href = body.redirectUrl
      }
    } catch {
      setFormError('No se pudo conectar con el servidor. Probá de nuevo.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-(--content-max) flex-1 flex-col gap-4 px-4 pt-6 pb-48 sm:px-6">
      <h1 className="display text-foreground text-2xl font-semibold sm:text-3xl">Checkout</h1>

      <Panel className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Tus datos</h2>
          {rememberedContact ? (
            <button
              type="button"
              onClick={handleForgetContact}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-h-11 items-center gap-1 rounded-md px-1 text-xs underline underline-offset-2 outline-none focus-visible:ring-3"
            >
              <X className="size-3" aria-hidden />
              Olvidar mis datos
            </button>
          ) : null}
        </div>
        {rememberedContact ? (
          <p className="text-muted-foreground -mt-1 text-xs">Completamos esto con lo que guardaste en tu último pedido.</p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerName">Nombre</Label>
          <Input
            id="customerName"
            name="customerName"
            ref={nameRef}
            required
            autoComplete="name"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Nombre y apellido"
            aria-invalid={!!fieldErrors.customerName}
            aria-describedby={fieldErrors.customerName ? 'customerName-error' : undefined}
          />
          {fieldErrors.customerName ? (
            <p id="customerName-error" className="text-destructive text-xs">
              {fieldErrors.customerName}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerPhone">Celular</Label>
          <Input
            id="customerPhone"
            name="customerPhone"
            ref={phoneRef}
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            placeholder="11 5555-4444"
            aria-invalid={!!fieldErrors.customerPhone}
            aria-describedby={fieldErrors.customerPhone ? 'customerPhone-error' : undefined}
          />
          {fieldErrors.customerPhone ? (
            <p id="customerPhone-error" className="text-destructive text-xs">
              {fieldErrors.customerPhone}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerEmail">
            Email <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Input
            id="customerEmail"
            name="customerEmail"
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
            placeholder="tu@email.com"
            aria-invalid={!!fieldErrors.customerEmail}
            aria-describedby={
              fieldErrors.customerEmail
                ? 'customerEmail-hint customerEmail-promo-notice customerEmail-error'
                : 'customerEmail-hint customerEmail-promo-notice'
            }
          />
          <p id="customerEmail-hint" className="text-muted-foreground text-xs">
            Te mandamos el comprobante y el aviso de “listo” también por acá. El aviso principal sigue siendo por WhatsApp.
          </p>
          {/* Consentimiento, no descripción: recién en esta entrega existe una
              forma de mandar una promo, así que decir esto antes sería una
              afirmación falsa. Copy cerrado, sin checkbox — dejar el mail es
              el único gesto que hace falta (00-architecture.md §5.12.3). */}
          <p id="customerEmail-promo-notice" className="text-muted-foreground text-xs">
            Si dejás tu email, además del comprobante el local puede mandarte promos. Te podés dar de baja desde cualquier
            mail.
          </p>
          {fieldErrors.customerEmail ? (
            <p id="customerEmail-error" className="text-destructive text-xs">
              {fieldErrors.customerEmail}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Cómo lo recibís</h2>
        {delivery && delivery.enabled ? (
          <>
            <RadioGroup value={effectiveDeliveryMethod} onValueChange={(value) => setDeliveryMethod(value as DeliveryMethod)}>
              <Label className="border-border has-[[data-state=checked]]:border-primary flex flex-col items-start gap-1 rounded-(--radius-md) border px-3 py-2.5 font-normal transition-colors duration-(--dur-fast)">
                <span className="flex items-center gap-2.5">
                  <RadioGroupItem value="pickup" />
                  Retiro en el local
                </span>
                <span className="text-muted-foreground pl-6 text-xs">
                  {storeAddress ?? 'Te confirmamos la dirección del local en el comprobante que te mandamos por WhatsApp.'}
                </span>
              </Label>

              {/* Deshabilitada (no oculta) cuando `!available`: el motivo ya
                  viene redactado del servidor (`unavailableReason`), se
                  muestra tal cual. `allCouriersBusy` es otra cosa —AVISA, no
                  bloquea— así que nunca deshabilita esta opción. */}
              <Label
                aria-disabled={!delivery.available}
                className={cn(
                  'border-border has-[[data-state=checked]]:border-primary flex flex-col items-start gap-1 rounded-(--radius-md) border px-3 py-2.5 font-normal transition-colors duration-(--dur-fast)',
                  !delivery.available && 'opacity-45',
                )}
              >
                <span className="flex items-center gap-2.5">
                  <RadioGroupItem value="delivery" disabled={!delivery.available} />
                  Delivery
                </span>
                <span className="text-muted-foreground pl-6 text-xs">
                  {delivery.available ? (
                    delivery.feeCents === 0 ? (
                      'Gratis'
                    ) : (
                      <>
                        Costo de envío: <Price cents={delivery.feeCents} currency={currency} className="tabular" />
                      </>
                    )
                  ) : (
                    delivery.unavailableReason
                  )}
                </span>
              </Label>
            </RadioGroup>

            {effectiveDeliveryMethod === 'delivery' && delivery.available ? (
              <div className="flex flex-col gap-3 pt-1">
                {delivery.allCouriersBusy ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="bg-warning/20 text-warning-foreground flex items-start gap-2 rounded-(--radius-md) px-3 py-2.5 text-xs"
                  >
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>Todos los repartidores están en la calle. Tu envío puede demorar más de lo habitual.</span>
                  </div>
                ) : null}
                {delivery.missingForFreeCents > 0 && delivery.freeFromCents > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Te faltan <Price cents={delivery.missingForFreeCents} currency={currency} className="tabular" /> para el envío
                    gratis.
                  </p>
                ) : null}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deliveryAddressLine">Calle y número</Label>
                  <Input
                    id="deliveryAddressLine"
                    name="deliveryAddressLine"
                    ref={deliveryLineRef}
                    required
                    autoComplete="street-address"
                    value={deliveryAddressLine}
                    onChange={(event) => setDeliveryAddressLine(event.target.value)}
                    placeholder="Av. Siempre Viva 742"
                    aria-invalid={!!fieldErrors.deliveryAddressLine}
                    aria-describedby={fieldErrors.deliveryAddressLine ? 'deliveryAddressLine-error' : undefined}
                  />
                  {fieldErrors.deliveryAddressLine ? (
                    <p id="deliveryAddressLine-error" className="text-destructive text-xs">
                      {fieldErrors.deliveryAddressLine}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deliveryAddressUnit">
                    Piso / Depto <span className="text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  <Input
                    id="deliveryAddressUnit"
                    name="deliveryAddressUnit"
                    autoComplete="address-line2"
                    value={deliveryAddressUnit}
                    onChange={(event) => setDeliveryAddressUnit(event.target.value)}
                    placeholder="3.º B"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deliveryAddressBetween">
                    Entre calles <span className="text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  <Input
                    id="deliveryAddressBetween"
                    name="deliveryAddressBetween"
                    value={deliveryAddressBetween}
                    onChange={(event) => setDeliveryAddressBetween(event.target.value)}
                    placeholder="Entre San Martín y Belgrano"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deliveryAddressNotes">
                    Referencias <span className="text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  <Textarea
                    id="deliveryAddressNotes"
                    value={deliveryAddressNotes}
                    onChange={(event) => setDeliveryAddressNotes(event.target.value)}
                    maxLength={300}
                    placeholder="Portón negro, timbre 2"
                  />
                </div>
              </div>
            ) : null}
          </>
        ) : storeAddress ? (
          <p className="text-sm">{storeAddress}</p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Te confirmamos la dirección del local en el comprobante que te mandamos por WhatsApp.
          </p>
        )}
      </Panel>

      {/* Va DESPUÉS de "Cómo lo recibís" a propósito: el envío programado
          depende de con qué método se entrega, así que mostrar esto antes
          invitaría a elegir un turno que el método de entrega, recién
          elegido después, invalida. */}
      <Panel className="flex flex-col gap-3 p-4 sm:p-5">
        <h2
          ref={scheduleHeadingRef}
          tabIndex={-1}
          className="focus-visible:ring-ring/50 rounded-sm text-sm font-semibold outline-none focus-visible:ring-3"
        >
          Cuándo lo querés
        </h2>

        {forced ? (
          <p className="text-muted-foreground text-sm">
            El local está cerrado ahora{opensAtLabel ? ` — abre ${opensAtLabel}` : ''}. Elegí un horario para tu pedido.
          </p>
        ) : (
          <RadioGroup
            value={scheduleMode}
            onValueChange={(value) => setScheduleMode(value as 'now' | 'schedule')}
            className="grid grid-cols-2 gap-2"
          >
            <Label className="border-border has-[[data-state=checked]]:border-primary flex h-11 items-center justify-center gap-2 rounded-(--radius-md) border font-normal transition-colors duration-(--dur-fast)">
              <RadioGroupItem value="now" />
              Para ahora
            </Label>
            <Label className="border-border has-[[data-state=checked]]:border-primary flex h-11 items-center justify-center gap-2 rounded-(--radius-md) border font-normal transition-colors duration-(--dur-fast)">
              <RadioGroupItem value="schedule" />
              Programar
            </Label>
          </RadioGroup>
        )}

        {schedulingActive ? (
          schedulingBlockedByDelivery ? (
            <div
              role="status"
              aria-live="polite"
              className="bg-warning/20 text-warning-foreground flex items-start gap-2 rounded-(--radius-md) px-3 py-2.5 text-xs"
            >
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Este local todavía no programa pedidos con delivery. Elegí retiro para programar, o dejá el envío para
                &quot;Para ahora&quot;.
              </span>
            </div>
          ) : scheduleGroups === null ? (
            <p className="text-muted-foreground text-sm">Buscando horarios disponibles…</p>
          ) : (
            <SchedulePicker
              groups={scheduleGroups}
              timeZone={timezone}
              activeNight={activeNight}
              onActiveNightChange={setActiveNight}
              selectedIso={scheduledIso}
              onSelect={setScheduledIso}
              invalid={!!fieldErrors.scheduledFor}
            />
          )
        ) : null}

        {fieldErrors.scheduledFor ? <p className="text-destructive text-xs">{fieldErrors.scheduledFor}</p> : null}
      </Panel>

      <Panel className="flex flex-col gap-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Tu pedido</h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="couponCode">
            Cupón de descuento <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <div className="flex gap-2">
            <Input
              id="couponCode"
              name="couponCode"
              className="h-11 flex-1"
              value={couponInput}
              onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
              onKeyDown={handleCouponKeyDown}
              placeholder="Código"
              maxLength={16}
              aria-invalid={couponQuote?.status === 'rejected'}
              aria-describedby={couponQuote?.status === 'rejected' ? 'couponCode-error' : undefined}
            />
            {cartCouponCode ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={handleRemoveCoupon}
                aria-label="Quitar cupón"
              >
                <X className="size-4" aria-hidden />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              onClick={handleApplyCoupon}
              disabled={!couponInput.trim() || couponInput.trim() === (cartCouponCode ?? '')}
            >
              Aplicar
            </Button>
          </div>
        </div>

        {quote.status === 'loading' ? (
          <p className="text-muted-foreground text-sm">Calculando el total…</p>
        ) : quote.status === 'error' ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{quote.error} — volvé al carrito para revisarlo.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <Price cents={quote.data.priced.subtotalCents} currency={currency} className="tabular" />
            </div>
            {couponQuote?.status === 'applied' && quote.data.priced.discountCents > 0 ? (
              <div className="text-primary flex items-baseline justify-between">
                <span>Descuento {couponQuote.code}</span>
                <span className="tabular">
                  −<Price cents={quote.data.priced.discountCents} currency={currency} />
                </span>
              </div>
            ) : null}
            {/* El cupón NUNCA desaparece en silencio: si dejó de servir (venció,
                se agotó, o no aplica al método de pago elegido), la línea
                queda tachada con el motivo al lado — un total que sube sin
                explicación es lo peor que puede pasar en un checkout
                (00-architecture.md §5.9.4). */}
            {couponQuote?.status === 'rejected' ? (
              <div className="flex flex-col gap-0.5">
                <div className="text-muted-foreground flex items-baseline justify-between line-through">
                  <span>Descuento {couponQuote.code}</span>
                  <span className="tabular">−{formatCentsCompact(0, currency)}</span>
                </div>
                <p id="couponCode-error" className="text-destructive text-xs">
                  {couponQuote.reason}
                </p>
              </div>
            ) : null}
            {effectiveDeliveryMethod === 'delivery' ? (
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Envío</span>
                {quote.data.delivery.feeCents === 0 ? (
                  <span className="tabular">Gratis</span>
                ) : (
                  <Price cents={quote.data.delivery.feeCents} currency={currency} className="tabular" />
                )}
              </div>
            ) : null}
            <div className="border-border flex items-baseline justify-between border-t pt-1.5 text-base font-medium">
              <span>Total</span>
              <Price
                cents={effectiveDeliveryMethod === 'delivery' ? quote.data.delivery.totalWithDeliveryCents : quote.data.priced.totalCents}
                currency={currency}
                exact
                className="tabular"
              />
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Listo en {quote.data.eta.etaMinutes + (effectiveDeliveryMethod === 'delivery' ? quote.data.delivery.minutesToAdd : 0)}
              &nbsp;min aprox.
              {quote.data.eta.isBusy ? ' — hay mucha demanda ahora' : ''}
            </p>
          </div>
        )}
      </Panel>

      {availablePaymentMethods.length > 1 ? (
        <Panel className="flex flex-col gap-3 p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Cómo pagás</h2>
          <RadioGroup value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
            {availablePaymentMethods.includes('online') ? (
              <Label className="border-border has-[[data-state=checked]]:border-primary flex flex-col items-start gap-1 rounded-(--radius-md) border px-3 py-2.5 font-normal transition-colors duration-(--dur-fast)">
                <span className="flex items-center gap-2.5">
                  <RadioGroupItem value="online" />
                  Pagar ahora online
                  <MercadoPago aria-hidden className="h-3.5 w-auto shrink-0" />
                </span>
                <span className="text-muted-foreground pl-6 text-xs">Con Mercado Pago, antes de que se prepare.</span>
              </Label>
            ) : null}
            {availablePaymentMethods.includes('transfer') ? (
              <Label className="border-border has-[[data-state=checked]]:border-primary flex flex-col items-start gap-1 rounded-(--radius-md) border px-3 py-2.5 font-normal transition-colors duration-(--dur-fast)">
                <span className="flex items-center gap-2.5">
                  <RadioGroupItem value="transfer" />
                  Transferencia bancaria
                </span>
                {/* El CBU NO se muestra acá (00-architecture.md §4.1/T4.2): mostrarlo
                    antes de que el pedido exista invita a transferir sin pedido, y
                    `OrderPublicView.bankAccount` es el único camino habilitado. */}
                <span className="text-muted-foreground pl-6 text-xs">
                  Te mostramos el CBU y el monto exacto en la pantalla siguiente.
                </span>
              </Label>
            ) : null}
            {availablePaymentMethods.includes('in_store') ? (
              <Label className="border-border has-[[data-state=checked]]:border-primary flex flex-col items-start gap-1 rounded-(--radius-md) border px-3 py-2.5 font-normal transition-colors duration-(--dur-fast)">
                <span className="flex items-center gap-2.5">
                  <RadioGroupItem value="in_store" />
                  {inStorePaymentLabel}
                </span>
                <span className="text-muted-foreground pl-6 text-xs">{inStorePaymentHint}</span>
              </Label>
            ) : null}
          </RadioGroup>
        </Panel>
      ) : (
        singleMethodNotice(availablePaymentMethods[0] ?? 'in_store')
      )}

      <Panel className="flex flex-col gap-1.5 p-4 sm:p-5">
        <Label htmlFor="orderNotes">Aclaraciones para el pedido (opcional)</Label>
        <Textarea id="orderNotes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={400} />
      </Panel>

      {/* Total + acción primaria fijos al pie: en esta categoría no se busca
          scrolleando, vive donde está el pulgar. El error de un intento
          fallido va acá adentro (no en el scroll) porque es lo primero que
          hay que ver para decidir si reintentar — y reintentar reusa la
          MISMA idempotencyKey (`ensureIdempotencyKey`), así que un doble tap
          por mala señal nunca crea un segundo pedido. */}
      <ActionBar>
        {isPreview ? (
          <Alert className="mb-3">
            <CircleAlert />
            <AlertDescription>Vista previa — desde acá no se puede pedir.</AlertDescription>
          </Alert>
        ) : formError ? (
          // `aria-live="assertive"` explícito además del `role="alert"` que ya
          // trae `Alert`: cuando el mensaje cambia de un intento fallido al
          // siguiente (ej. dos 429 seguidos), el nodo sigue montado y solo
          // cambia el texto — sin esto, un lector de pantalla puede no
          // re-anunciar un simple cambio de contenido dentro del mismo nodo.
          <Alert variant="destructive" className="mb-3" aria-live="assertive">
            <CircleAlert />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : belowMinimum && quote.status === 'ready' ? (
          <p className="text-destructive mb-3 text-sm">
            El pedido mínimo es {formatCentsCompact(quote.data.store.minOrderCents, currency)}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          {quote.status === 'ready' ? (
            <div className="flex flex-col leading-tight">
              <span className="text-muted-foreground text-xs">Total</span>
              <Price
                cents={effectiveDeliveryMethod === 'delivery' ? quote.data.delivery.totalWithDeliveryCents : quote.data.priced.totalCents}
                currency={currency}
                exact
                className="tabular text-lg font-semibold"
              />
            </div>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="h-12 flex-1 rounded-pill text-base"
            disabled={
              isPreview ||
              submitting ||
              quote.status !== 'ready' ||
              belowMinimum ||
              schedulingBlockedByDelivery ||
              (schedulingActive && !scheduledIso)
            }
            aria-disabled={isPreview}
          >
            {submitButtonLabel()}
          </Button>
        </div>
      </ActionBar>
    </form>
  )
}
