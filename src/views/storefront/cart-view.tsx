'use client'

import * as React from 'react'
import Image from 'next/image'
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
import { ActionBar, Panel, PhotoFrame, Stepper, iconButtonClass } from '@/views/shared/surfaces'
import { EmptyState, ClosedNotice } from '@/views/shared/states'
import { Price } from '@/views/shared/money'
import { useCart } from '@/lib/cart'
import { usePricedLines, type PricedItemQuote } from '@/views/storefront/use-priced-cart'
import { storeHref, useStoreBasePath } from '@/views/storefront/store-base-path'
import { cn } from '@/lib/utils'

/**
 * El carrito: Operate, no Persuade — ya decidió, ahora tiene que completar
 * sin fricción. Lista de líneas ya cotizadas contra el servidor (nunca el
 * precio que guardó el navegador), en tarjetas que se levantan, subtotal y
 * la acción fija al pie.
 */
export function CartView({
  storeSlug,
  storeName,
  currency,
  blocked,
}: {
  storeSlug: string
  storeName: string
  currency: string
  /**
   * Ya resuelto por la page con `storefrontGate()`. `true` solo para los
   * tres estados de la precedencia que de verdad no dejan pedir
   * (`suspended`/`no_payment`/`paused`) — `closed_by_hours` NO bloquea el
   * carrito, esa decisión (ahora/programar) es del checkout.
   */
  blocked: boolean
}) {
  const router = useRouter()
  const { lines, hydrated, removeLine, setQuantity } = useCart()
  const { results, subtotalCents, isLoading, hasErrors, cartError } = usePricedLines(storeSlug, lines)
  const basePath = useStoreBasePath()

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
          <Button asChild size="lg" className="h-11 rounded-pill">
            <Link href={storeHref(basePath, '/')}>Ver la carta</Link>
          </Button>
        }
      />
    )
  }

  const canProceed = !blocked && !isLoading && !hasErrors && lines.length > 0

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
    <div className="flex flex-1 flex-col pb-40">
      <div className="mx-auto w-full max-w-(--content-max) px-4 sm:px-6">
        <h1 className="display text-foreground pt-6 pb-1 text-2xl font-semibold sm:text-3xl">Tu carrito</h1>
        {isLoading ? (
          <span className="sr-only" role="status">
            Calculando el precio del carrito
          </span>
        ) : null}
      </div>

      {blocked ? <ClosedNotice storeName={storeName} className="mt-3" /> : null}

      {cartError ? (
        <div className="mx-auto w-full max-w-(--content-max) px-4 pt-3 sm:px-6">
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{cartError} — revisá las líneas de abajo y quitá la que corresponda.</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-3 px-4 pt-4 sm:px-6">
        {results.map((result) => {
          const quote = result.status === 'ready' ? result.quote : result.status === 'error' ? result.quote : undefined
          const imageUrl = lineImageUrl(quote)

          return (
            <Panel key={result.index} className="flex items-start gap-2 p-3">
              {/* Ancho FIJO con valor arbitrario (`w-[4rem]`), NO `size-16`/
                  `w-16`/`h-16`: en Tailwind v4 CUALQUIER utilidad numérica de
                  espaciado —`size-*` incluido, pero también `w-*`/`h-*`— sale
                  de `--spacing`, y ese token es justo el que `buildThemeCss()`
                  multiplica hasta ×1.22 según la densidad del local (medido:
                  a densidad 1.22 un `w-16` renderiza 78px, no 64). Solo un
                  valor arbitrario entre corchetes es un rem literal, inmune a
                  esa variable. La foto de carrito no es un target táctil ni
                  un respiro entre controles — no gana nada creciendo con la
                  densidad, y cada rem que le saca al ancho fijo se lo saca al
                  stepper y al precio de al lado, que sí crecen con ella. */}
              <PhotoFrame ratio="square" className="h-[4rem] w-[4rem] shrink-0 rounded-(--radius-md)" fallbackLabel={quote?.name}>
                {imageUrl ? <Image src={imageUrl} alt={quote?.name ?? ''} fill sizes="64px" className="object-cover" /> : undefined}
              </PhotoFrame>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
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

                    {/* `flex-wrap`: a densidad alta el propio Stepper (dos
                        botones de `iconButtonClass`, que SÍ escalan con la
                        densidad) puede pasar los ~145-160px, y a 390px de
                        ancho con la foto y el botón de quitar ya puestos no
                        queda margen para sumarle el precio al lado. Envolver
                        el precio a su propia línea es preferible a que la
                        fila entera empuje el ancho de la tarjeta — nunca se
                        corta un precio a la mitad, se lo baja de renglón. */}
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
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
                aria-label={`Quitar ${quote?.name ?? 'ítem'} del carrito`}
                className={cn(iconButtonClass('plain'), 'shrink-0')}
              >
                <X className="size-4" aria-hidden />
              </button>
            </Panel>
          )
        })}
      </div>

      <Dialog open={pendingRemoveIndex !== null} onOpenChange={(open) => !open && setPendingRemoveIndex(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Quitar este ítem del carrito?</DialogTitle>
            <DialogDescription>Vas a borrar la línea completa, no solo bajar la cantidad.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 rounded-pill" onClick={() => setPendingRemoveIndex(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" className="h-11 rounded-pill" onClick={confirmPendingRemove}>
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
          className="h-12 w-full rounded-pill text-base"
          disabled={!canProceed}
          onClick={() => router.push(storeHref(basePath, '/checkout'))}
        >
          {blocked ? 'El local no está tomando pedidos' : 'Ir a pagar'}
        </Button>
      </ActionBar>
    </div>
  )
}

/**
 * `PricedItemQuote` (use-priced-cart.ts, fuera de este slice) no declara
 * `imageUrl` en su tipo, pero el servidor SÍ lo manda en cada ítem —
 * `priceCart()` en order.model.ts arma `PricedItem` (models/types.ts), que
 * sí lo tiene, y `usePricedLines` pasa la respuesta del servidor sin
 * recortarla. Achicar el tipo acá, en vez de tocar ese archivo, evita salir
 * del slice por un campo que en runtime ya está.
 */
function lineImageUrl(quote: PricedItemQuote | undefined): string | null {
  if (!quote) return null
  return (quote as PricedItemQuote & { imageUrl?: string | null }).imageUrl ?? null
}
