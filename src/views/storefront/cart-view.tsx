'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ActionBar, PhotoFrame, Stepper } from '@/views/shared/surfaces'
import { EmptyState, ClosedNotice } from '@/views/shared/states'
import { Price } from '@/views/shared/money'
import { useCart } from '@/lib/cart'
import { usePricedLines } from '@/views/storefront/use-priced-cart'

/**
 * El carrito: lista de líneas ya cotizadas contra el servidor (nunca el
 * precio que guardó el navegador), subtotal y la acción fija al pie.
 *
 * Sin foto real por línea: `PricedItem`/`PricedItemQuote` (lo que devuelve
 * `priceCart` en order.model.ts) no trae `imageUrl` ni `categoryId` — solo
 * nombre, precio y opciones. Es un hueco del modelo, no de este slice: acá se
 * usa el marco de foto vacío en vez de inventar una URL o fingir una
 * categoría que no tenemos.
 */
export function CartView({
  storeSlug,
  storeName,
  currency,
  acceptingOrders,
}: {
  storeSlug: string
  storeName: string
  currency: string
  acceptingOrders: boolean
}) {
  const router = useRouter()
  const { lines, hydrated, removeLine, setQuantity } = useCart()
  const { results, subtotalCents, isLoading, hasErrors, cartError } = usePricedLines(storeSlug, lines)

  // Bajar de 1 a 0 con el stepper borraría la línea sin avisar (F-04): en vez
  // de eso se pide confirmación. Guarda el ÍNDICE de la línea en duda, no un
  // booleano, para que el diálogo sepa a cuál aplicar si se confirma.
  const [pendingRemoveIndex, setPendingRemoveIndex] = React.useState<number | null>(null)

  if (!hydrated) return null

  if (lines.length === 0) {
    return (
      <EmptyState
        className="flex-1"
        title="Tu carrito está vacío"
        description={`Todavía no agregaste nada de ${storeName}.`}
        action={
          <Button asChild size="lg" className="h-11">
            <Link href={`/${storeSlug}`}>Ver la carta</Link>
          </Button>
        }
      />
    )
  }

  const canProceed = acceptingOrders && !isLoading && !hasErrors && lines.length > 0

  function handleStepperChange(index: number, next: number) {
    if (next <= 0) {
      setPendingRemoveIndex(index)
      return
    }
    setQuantity(index, next)
  }

  function confirmPendingRemove() {
    if (pendingRemoveIndex !== null) setQuantity(pendingRemoveIndex, 0)
    setPendingRemoveIndex(null)
  }

  return (
    <div className="flex flex-1 flex-col pb-36">
      <div className="mx-auto w-full max-w-(--content-max) px-4 sm:px-6">
        <h1 className="display text-foreground pt-6 pb-1 text-2xl font-semibold sm:text-3xl">Tu carrito</h1>
        {isLoading ? (
          <span className="sr-only" role="status">
            Calculando el precio del carrito
          </span>
        ) : null}
      </div>

      {!acceptingOrders ? <ClosedNotice storeName={storeName} className="mt-3" /> : null}

      {cartError ? (
        <div className="mx-auto w-full max-w-(--content-max) px-4 pt-3 sm:px-6">
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{cartError} — revisá las líneas de abajo y quitá la que corresponda.</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-(--content-max) flex-col px-4 sm:px-6">
        {results.map((result) => (
          <div key={result.index} className="border-border flex items-start gap-3 border-b py-4 last:border-b-0">
            <PhotoFrame ratio="square" className="size-16 shrink-0 rounded-(--radius-md)" />

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {result.status === 'loading' ? (
                <div aria-hidden className="flex flex-col gap-1.5">
                  <div className="bg-muted h-4 w-2/5 animate-pulse rounded" />
                  <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
                </div>
              ) : result.status === 'error' ? (
                <>
                  {result.quote ? <p className="text-foreground text-sm font-medium">{result.quote.name}</p> : null}
                  <p className="text-destructive text-sm">{result.error}</p>
                  <button
                    type="button"
                    onClick={() => removeLine(result.index)}
                    className="text-muted-foreground hover:text-foreground min-h-11 w-fit py-2 text-sm underline underline-offset-4"
                  >
                    Quitar del carrito
                  </button>
                </>
              ) : (
                <>
                  <p className="text-foreground text-sm font-medium">{result.quote.name}</p>
                  {result.quote.options.length > 0 ? (
                    <p className="text-muted-foreground text-xs">{result.quote.options.map((o) => o.name).join(', ')}</p>
                  ) : null}
                  {result.quote.notes ? <p className="text-muted-foreground text-xs italic">“{result.quote.notes}”</p> : null}

                  <div className="mt-1 flex items-center justify-between gap-3">
                    {/* `key` en la cantidad reinicia `animate-bump` cada vez
                        que una línea que YA existía cambia de cantidad —
                        el momento autorizado, acá, es que el contador late. */}
                    <div key={result.line.quantity} className="animate-bump">
                      <Stepper
                        value={result.line.quantity}
                        onChange={(next) => handleStepperChange(result.index, next)}
                        min={0}
                        max={50}
                        label={`Cantidad de ${result.quote.name}`}
                      />
                    </div>
                    {result.status === 'ready' ? (
                      <Price cents={result.quote.totalCents} currency={currency} className="text-foreground text-sm font-semibold" />
                    ) : null}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeLine(result.index)}
              className="text-muted-foreground hover:text-foreground flex size-11 shrink-0 items-center justify-center rounded-(--radius-md)"
              aria-label={`Quitar ${'quote' in result ? (result.quote?.name ?? 'ítem') : 'ítem'} del carrito`}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <Dialog open={pendingRemoveIndex !== null} onOpenChange={(open) => !open && setPendingRemoveIndex(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Quitar este ítem del carrito?</DialogTitle>
            <DialogDescription>Vas a borrar la línea completa, no solo bajar la cantidad.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setPendingRemoveIndex(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" className="h-11" onClick={confirmPendingRemove}>
              Quitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* `animate-bar-in`: entra con resorte la primera vez que el carrito se
          monta, igual que la barra de la ficha de producto. */}
      <ActionBar className="animate-bar-in flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-sm">Subtotal</span>
          <Price cents={subtotalCents} currency={currency} className="text-muted-foreground text-sm" />
        </div>
        {/* `priceCart` en order.model.ts devuelve `totalCents: subtotalCents`
            a propósito — todavía no hay envío ni recargo que sumar en esta
            etapa — así que "Total" reusa el mismo número en vez de duplicar
            el cálculo acá. El día que el modelo sume un cargo, esta fila deja
            de coincidir con la de arriba sola, sin tocar este archivo. */}
        <div className="flex items-baseline justify-between">
          <span className="text-foreground text-sm font-medium">Total</span>
          <Price cents={subtotalCents} currency={currency} className="text-foreground text-lg font-semibold" />
        </div>
        <p className="text-muted-foreground text-xs">El envío y el tiempo de espera se confirman en el siguiente paso.</p>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          disabled={!canProceed}
          onClick={() => router.push(`/${storeSlug}/checkout`)}
        >
          {acceptingOrders ? 'Ir a pagar' : 'El local no está tomando pedidos'}
        </Button>
      </ActionBar>
    </div>
  )
}
