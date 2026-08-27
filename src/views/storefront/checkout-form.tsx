'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleAlert, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Price } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import { ActionBar } from '@/views/shared/surfaces'
import { useCart, saveOrderRef } from '@/lib/cart'
import { getSavedCustomer, saveCustomer, clearSavedCustomer } from '@/lib/customer'
import { useCheckoutQuote } from '@/views/storefront/use-priced-cart'
import { formatCentsCompact } from '@/lib/money'
import type { PaymentMethod } from '@/models/schemas/order.schema'

/**
 * El paso donde se decide de verdad. La cotización (`useCheckoutQuote`)
 * revalida el carrito contra la base y muestra el ETA ANTES del método de
 * pago — divulgación honesta, nunca una sorpresa post-cobro.
 *
 * Todo pedido es retiro en el local: no hay elección de entrega ni dirección
 * del cliente que pedir. Lo que sí hace falta es que el cliente sepa
 * DÓNDE retirar, así que se muestra la dirección del local (`storeAddress`).
 */
export function CheckoutForm({
  storeSlug,
  currency,
  storeAddress,
  inStorePaymentEnabled,
}: {
  storeSlug: string
  currency: string
  storeAddress: string | null
  inStorePaymentEnabled: boolean
}) {
  const router = useRouter()
  const { lines, hydrated, ensureIdempotencyKey } = useCart()

  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('online')
  const [customerName, setCustomerName] = React.useState('')
  const [customerPhone, setCustomerPhone] = React.useState('')
  const [customerEmail, setCustomerEmail] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [rememberedContact, setRememberedContact] = React.useState(false)

  // Foco al primer error tras un submit fallido: mostrar el mensaje no
  // alcanza si el cliente no lo ve, y en mobile el error queda arriba del
  // fold sin el teclado abierto.
  const nameRef = React.useRef<HTMLInputElement>(null)
  const phoneRef = React.useRef<HTMLInputElement>(null)
  const emailRef = React.useRef<HTMLInputElement>(null)
  const fieldRefs: Record<string, React.RefObject<HTMLInputElement | null>> = {
    customerName: nameRef,
    customerPhone: phoneRef,
    customerEmail: emailRef,
  }

  // Memoria de contacto: si el cliente ya pidió una vez, no le volvemos a
  // pedir sus datos. Se lee después del primer render (recién ahí existe
  // `window`) para no pisar el HTML hidratado con contenido distinto.
  React.useEffect(() => {
    const saved = getSavedCustomer()
    if (!saved) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- precarga única al montar, no un sync loop
    if (saved.name) setCustomerName(saved.name)
    if (saved.phone) setCustomerPhone(saved.phone)
    if (saved.email) setCustomerEmail(saved.email)
    setRememberedContact(true)
  }, [])

  function handleForgetContact() {
    clearSavedCustomer()
    setCustomerName('')
    setCustomerPhone('')
    setCustomerEmail('')
    setRememberedContact(false)
  }

  const quote = useCheckoutQuote(storeSlug, hydrated ? lines : [])

  if (!hydrated) return null

  if (lines.length === 0) {
    return (
      <EmptyState
        className="flex-1"
        title="Tu carrito está vacío"
        description="Agregá algo de la carta antes de pasar al checkout."
        action={
          <Button asChild size="lg" className="h-11">
            <Link href={`/${storeSlug}`}>Ver la carta</Link>
          </Button>
        }
      />
    )
  }

  const belowMinimum = quote.status === 'ready' && quote.data.priced.subtotalCents < quote.data.store.minOrderCents

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    setFieldErrors({})

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
          paymentMethod: inStorePaymentEnabled ? paymentMethod : 'online',
          customerName,
          customerPhone,
          customerEmail: customerEmail.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })
      const body = await res.json()

      if (!res.ok) {
        setFormError(body.error ?? 'No se pudo crear el pedido')
        if (typeof body.field === 'string') {
          setFieldErrors({ [body.field]: body.error })
          fieldRefs[body.field]?.current?.focus()
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
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-8 px-5 pt-8 pb-44 sm:px-8">
      <h1 className="display text-2xl uppercase">Checkout</h1>

      <section className="flex flex-col gap-3">
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
            aria-describedby={fieldErrors.customerEmail ? 'customerEmail-hint customerEmail-error' : 'customerEmail-hint'}
          />
          <p id="customerEmail-hint" className="text-muted-foreground text-xs">
            Te mandamos el comprobante y el aviso de “listo” también por acá. El aviso principal sigue siendo por WhatsApp.
          </p>
          {fieldErrors.customerEmail ? (
            <p id="customerEmail-error" className="text-destructive text-xs">
              {fieldErrors.customerEmail}
            </p>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Dónde retirás</h2>
        {storeAddress ? (
          <p className="text-sm">{storeAddress}</p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Te confirmamos la dirección del local en el comprobante que te mandamos por WhatsApp.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Tu pedido</h2>
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
            <div className="border-border flex items-baseline justify-between border-t pt-1.5 text-base font-medium">
              <span>Total</span>
              <Price cents={quote.data.priced.totalCents} currency={currency} exact className="tabular" />
            </div>
            <p className="text-muted-foreground mt-2 text-xs uppercase tracking-[0.08em]">
              Listo en {quote.data.eta.etaMinutes}&nbsp;min aprox.
              {quote.data.eta.isBusy ? ' — hay mucha demanda ahora' : ''}
            </p>
          </div>
        )}
      </section>

      {inStorePaymentEnabled ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Cómo pagás</h2>
          <RadioGroup value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
            <Label className="border-border flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 font-normal">
              <span className="flex items-center gap-2.5">
                <RadioGroupItem value="online" />
                Pagar ahora online
              </span>
              <span className="text-muted-foreground pl-6 text-xs">Con Mercado Pago, antes de que se prepare.</span>
            </Label>
            <Label className="border-border flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 font-normal">
              <span className="flex items-center gap-2.5">
                <RadioGroupItem value="in_store" />
                Pagar al retirar
              </span>
              <span className="text-muted-foreground pl-6 text-xs">Reservás el pedido ahora y pagás en el local.</span>
            </Label>
          </RadioGroup>
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">Pagás online con Mercado Pago en el siguiente paso.</p>
      )}

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="orderNotes">Aclaraciones para el pedido (opcional)</Label>
        <Textarea id="orderNotes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={400} />
      </section>

      {/* Total + acción primaria fijos al pie: en esta categoría no se busca
          scrolleando, vive donde está el pulgar. El error de un intento
          fallido va acá adentro (no en el scroll) porque es lo primero que
          hay que ver para decidir si reintentar — y reintentar reusa la
          MISMA idempotencyKey (`ensureIdempotencyKey`), así que un doble tap
          por mala señal nunca crea un segundo pedido. */}
      <ActionBar>
        {formError ? (
          <Alert variant="destructive" className="mb-3">
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
              <Price cents={quote.data.priced.totalCents} currency={currency} exact className="tabular text-lg font-semibold" />
            </div>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="h-12 flex-1 text-base"
            disabled={submitting || quote.status !== 'ready' || belowMinimum}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Confirmando…
              </>
            ) : paymentMethod === 'online' || !inStorePaymentEnabled ? (
              'Ir a pagar'
            ) : (
              'Confirmar pedido · Pagás al retirar'
            )}
          </Button>
        </div>
      </ActionBar>
    </form>
  )
}
