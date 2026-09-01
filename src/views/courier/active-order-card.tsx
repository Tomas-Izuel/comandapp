'use client'

import * as React from 'react'
import { Phone, Loader2 } from 'lucide-react'
import { GoogleMaps } from '@/components/ui/maps'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Price } from '@/views/shared/money'
import { StatusPill } from '@/views/shared/surfaces'
import type { CourierOrder } from '@/models/types'

/**
 * La tarjeta activa: el único pedido que importa ahora mismo, a pantalla
 * completa. Jerarquía fija de arriba a abajo — código, dirección (línea y
 * piso al MISMO tamaño: perder el piso es lo que cuesta diez minutos en la
 * puerta), mapa, teléfono, y al final la acción única y gigante.
 *
 * Todo lo que se toca acá pasa los 56px (`h-14`+): guante, luz de sol,
 * pulgar en movimiento — el piso de 44px del resto del producto no alcanza.
 */
export function ActiveOrderCard({
  order,
  pending,
  onStart,
  onComplete,
}: {
  order: CourierOrder
  pending: boolean
  onStart: () => void
  onComplete: (collected: boolean) => void
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  function handlePrimaryAction() {
    if (order.status === 'ready') {
      onStart()
      return
    }
    // `on_the_way`: si hay algo para cobrar, se confirma ANTES de marcar
    // entregado — es plata, no se infiere. Si el local no activó el cobro acá
    // ni se dibuja el diálogo: ni una palabra sobre montos.
    if (order.collect) {
      setConfirmOpen(true)
      return
    }
    onComplete(false)
  }

  return (
    <div className="bg-card border-border shadow-raise flex flex-1 flex-col gap-5 rounded-lg border p-5">
      <StatusPill tone="live" dot>
        {order.status === 'ready' ? 'Para retirar' : 'En camino'}
      </StatusPill>

      <div>
        <p className="text-muted-foreground text-sm">Pedido</p>
        <p className="display tabular text-6xl leading-none font-bold">{order.shortCode}</p>
      </div>

      <div className="border-border flex flex-col gap-1 border-t pt-4">
        <p className="text-foreground text-2xl leading-snug font-semibold text-balance">{order.address.line}</p>
        {order.address.unit ? (
          <p className="text-foreground text-2xl leading-snug font-semibold">{order.address.unit}</p>
        ) : null}
        {order.address.between ? (
          <p className="text-muted-foreground text-base">entre {order.address.between}</p>
        ) : null}
        {order.address.notes ? (
          <p className="text-muted-foreground text-base italic">“{order.address.notes}”</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <Button asChild variant="outline" className="h-14 justify-start gap-3 px-4 text-base">
          <a href={order.navigationUrl} target="_blank" rel="noreferrer">
            <GoogleMaps className="size-6 shrink-0" aria-hidden />
            Abrir en Google Maps
          </a>
        </Button>
        <Button asChild variant="outline" className="h-14 justify-start gap-3 px-4 text-base">
          <a href={`tel:${order.customerPhoneE164}`}>
            <Phone className="size-5 shrink-0" aria-hidden />
            Llamar a {order.customerName}
          </a>
        </Button>
      </div>

      <Button
        type="button"
        className="mt-auto h-16 text-lg font-semibold"
        disabled={pending}
        onClick={handlePrimaryAction}
      >
        {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
        {order.status === 'ready' ? 'Iniciar' : 'Entregado'}
      </Button>

      {order.collect ? (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cobrá antes de entregar</DialogTitle>
              <DialogDescription>Confirmá que ya cobraste esto en la puerta.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5 text-base">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Pedido</span>
                <Price cents={order.collect.subtotalCents} currency={order.collect.currency} className="tabular" />
              </div>
              {/*
                Sin código acá: `courier_queue` solo manda importes en `collect`,
                nunca `couponCodeSnapshot` (el repartidor no necesita saber CUÁL
                cupón, solo que hubo uno y cuánto restó — es lo que le permite
                explicar el número en la puerta sin llamar al local). Etiqueta
                genérica a propósito, no inventada: no hay dato para mostrar más.
              */}
              {order.collect.discountCents > 0 ? (
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">Descuento</span>
                  <span className="tabular">
                    −<Price cents={order.collect.discountCents} currency={order.collect.currency} />
                  </span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Envío</span>
                <Price cents={order.collect.deliveryFeeCents} currency={order.collect.currency} className="tabular" />
              </div>
              <div className="border-border flex items-baseline justify-between border-t pt-1.5 text-xl font-semibold">
                <span>Total a cobrar</span>
                <Price cents={order.collect.totalCents} currency={order.collect.currency} exact className="tabular" />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" className="h-14 flex-1 text-base">
                  Todavía no
                </Button>
              </DialogClose>
              <Button
                type="button"
                className="h-14 flex-1 text-base"
                onClick={() => {
                  setConfirmOpen(false)
                  onComplete(true)
                }}
              >
                Ya cobré — entregado
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
