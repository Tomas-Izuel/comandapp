'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Landmark, Loader2, Receipt } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { whatsappHref } from '@/lib/whatsapp'
import { WhatsApp } from '@/components/ui/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Price } from '@/views/shared/money'
import { PanelHeading } from '@/views/admin/page-frame'
import { isConflict } from '@/lib/conflict'
import {
  confirmTransferPaymentAction,
  fetchPendingTransfersAction,
  transferReceiptUrlAction,
} from '@/controllers/kitchen.actions'
import type { ActionResult, Order } from '@/models/types'
import { useElapsedMinutes } from './order-card'

/**
 * Mismo ritmo que `board.tsx`: 30s de poll de respaldo + Realtime sobre
 * `orders` de la tienda, debounced. Es una bandeja aparte con su propio canal
 * —no comparte estado con el tablero— porque el tablero solo trae
 * `ACTIVE_STATUSES` (`confirmed`+) y un `transfer` recién creado está en
 * `pending`, que el tablero ni pide. Cero mecanismo NUEVO: mismos números,
 * mismo patrón, otra consulta.
 */
const POLL_INTERVAL_MS = 30_000
const REALTIME_DEBOUNCE_MS = 500

async function fetchPendingTransfers(storeId: number): Promise<Order[] | null> {
  const result = await fetchPendingTransfersAction(storeId)
  return result.ok ? result.data : null
}

/**
 * Mensaje prellenado propio de esta bandeja (pedir el comprobante). La URL en
 * sí —normalizar el teléfono, armar `wa.me`— sale de `@/lib/whatsapp`, el
 * módulo nuevo de T6 que unifica lo que antes eran tres `replace(/\D/g, '')`
 * a mano (acá, `order-card.tsx` y `store-dock.tsx` de la vitrina).
 */
function transferWhatsappHref(order: Order): string {
  const text =
    `Hola ${order.customerName}! Somos del local, por tu pedido ${order.shortCode || `#${order.id}`}. ` +
    `Necesitamos que nos ayudes con el comprobante de la transferencia, ¿nos lo podés reenviar o contarnos qué pasó?`
  return whatsappHref(order.customerPhoneE164, text)
}

/** Estado del visor de comprobante: qué se sabe y qué se está mostrando, para UNA fila a la vez. */
type ReceiptView = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; url: string; mime: string }

function ReceiptSection({ order }: { order: Order }) {
  const [view, setView] = useState<ReceiptView>({ status: 'idle' })

  function load() {
    setView({ status: 'loading' })
    void transferReceiptUrlAction({ storeId: order.storeId, orderId: order.id }).then(
      (result: ActionResult<{ url: string; mime: string } | null>) => {
        if (!result.ok) {
          setView({ status: 'error' })
          return
        }
        if (!result.data) {
          // El path decía que había algo y el servidor no encontró nada: se
          // borró entre que se armó la lista y este click (barrido del cron).
          // Mismo mensaje que "ya se eliminó", no un error.
          setView({ status: 'idle' })
          return
        }
        if (result.data.mime === 'application/pdf') {
          window.open(result.data.url, '_blank', 'noreferrer')
          setView({ status: 'idle' })
          return
        }
        setView({ status: 'ready', url: result.data.url, mime: result.data.mime })
      },
    )
  }

  // Ya se purgó el archivo (24h post-pago o 7 días sin resolver): la huella
  // queda, la imagen no. No es una falla — CLAUDE.md lo pide explícito.
  if (!order.transferReceiptPath) {
    return (
      <p className="text-muted-foreground text-sm">
        {order.transferReceiptUploadedAt
          ? 'Subió un comprobante, pero ya se eliminó (se borra a las 24 h de confirmar el pago).'
          : 'Todavía no subió ningún comprobante.'}
      </p>
    )
  }

  if (view.status === 'ready' && view.mime.startsWith('image/')) {
    return (
      <div className="flex flex-col gap-2">
        <div className="bg-muted overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de corta vida, no un asset de next/image */}
          <img src={view.url} alt="Comprobante de transferencia subido por el cliente" className="max-h-80 w-full object-contain" />
        </div>
        <p className="text-muted-foreground text-xs">
          El link vence en unos minutos. La imagen es contexto, no prueba de que la plata llegó: mirá tu cuenta.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="outline" onClick={load} disabled={view.status === 'loading'} className="h-11 w-full gap-2">
        {view.status === 'loading' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
        Ver comprobante
      </Button>
      {view.status === 'error' ? (
        <p className="text-destructive text-xs">No se pudo abrir. Probá de nuevo en un momento.</p>
      ) : null}
    </div>
  )
}

function ConfirmDialog({
  order,
  currency,
  onClose,
  onConfirmed,
}: {
  order: Order
  currency: string
  onClose: () => void
  onConfirmed: (orderId: number, message: string) => void
}) {
  const [reference, setReference] = useState('')
  const [pending, setPending] = useState(false)

  function handleConfirm() {
    setPending(true)
    void confirmTransferPaymentAction({
      storeId: order.storeId,
      orderId: order.id,
      reference: reference.trim() || undefined,
    }).then((result: ActionResult) => {
      setPending(false)
      if (!result.ok) {
        // Un 409 (otro operario ya confirmó) no es un error del que tocó el
        // botón: el pedido ya está resuelto, solo llegó tarde con la noticia.
        // Mismo criterio que `ScheduledOrdersTray` con su cancelación.
        if (isConflict(result)) {
          onConfirmed(order.id, 'Otro operario ya confirmó este pago.')
          return
        }
        toast.error('No se pudo confirmar el pago', { description: result.error })
        return
      }
      onConfirmed(order.id, 'Pago confirmado. El pedido pasó a la cocina.')
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{order.shortCode || `#${order.id}`} · {order.customerName}</DialogTitle>
          <DialogDescription>
            Antes de confirmar, mirá <span className="text-foreground font-medium">tu cuenta bancaria</span>: ¿la plata
            ya está ahí? El comprobante es un dato más, nunca la prueba — acá no hay forma de verificar que sea
            auténtico.
          </DialogDescription>
        </DialogHeader>

        {/*
          Sin descuento este bloque queda IDÉNTICO al de antes (misma fila
          única). Con descuento, quien confirma la transferencia mirando su
          cuenta necesita saber por qué lo que entró es menos que el pedido
          — si no, "no coincide" y no hay forma de saber que es el cupón.
        */}
        <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2.5">
          {order.discountCents > 0 ? (
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground min-w-0 truncate">Descuento {order.couponCodeSnapshot}</span>
              <span className="tabular">
                −<Price cents={order.discountCents} currency={currency} />
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">Monto a confirmar</span>
            <span className="tabular text-lg font-semibold">
              <Price cents={order.totalCents} currency={currency} exact />
            </span>
          </div>
        </div>

        <ReceiptSection order={order} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="transfer-reference">Número de operación (opcional)</Label>
          <Input
            id="transfer-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Como lo veas en tu resumen"
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            className="h-11"
          />
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <a href={transferWhatsappHref(order)} target="_blank" rel="noreferrer" className="w-full">
            <Button type="button" variant="outline" className="h-11 w-full gap-2">
              {/* Ícono real y tamaño reducido: mismo criterio que `order-card.tsx` (ver el comentario ahí). */}
              <WhatsApp className="size-3.5" aria-hidden />
              Escribirle por WhatsApp
            </Button>
          </a>
          <Button type="button" onClick={handleConfirm} disabled={pending} className="h-12 w-full gap-2 text-base">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Confirmar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferRow({ order, currency, onSelect }: { order: Order; currency: string; onSelect: (order: Order) => void }) {
  const elapsed = useElapsedMinutes(order.createdAt)
  const hasReceipt = order.transferReceiptPath !== null

  return (
    <button
      type="button"
      onClick={() => onSelect(order)}
      className="hover:bg-muted/40 flex min-h-11 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-2.5 text-left lg:px-4 lg:py-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground font-semibold">{order.shortCode || `#${order.id}`}</span>
          <span className="text-foreground truncate text-sm font-medium">{order.customerName}</span>
        </div>
        <p className="text-muted-foreground text-xs">
          Hace <span suppressHydrationWarning className="tabular">{elapsed} min</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span
          className={
            hasReceipt
              ? 'bg-primary/12 text-primary inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium'
              : 'bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium'
          }
        >
          <Receipt className="size-3.5" aria-hidden />
          {hasReceipt ? 'Con comprobante' : 'Sin comprobante'}
        </span>
        <span className="tabular text-sm font-medium">
          <Price cents={order.totalCents} currency={currency} />
        </span>
      </div>
    </button>
  )
}

/**
 * Bandeja de "Transferencias por confirmar", arriba del tablero de cocina.
 *
 * Existe porque `ACTIVE_STATUSES` no incluye `pending`
 * (`order.schema.ts:29`): sin esto, un pedido por transferencia entra, el
 * cliente sube el comprobante, y nadie del mostrador se entera nunca — queda
 * invisible hasta que expira solo (`00-architecture.md` §2.3). No es una
 * mejora del panel: es la parte que hace que la transferencia como medio de
 * pago funcione.
 *
 * No es una columna más del tablero: un pedido acá TODAVÍA no está confirmado
 * (no hay plata asegurada), así que convive mal con las tres columnas de
 * cocina, que sí la tienen. Va arriba, se vacía sola apenas se confirma o
 * cancela, y en cero no ocupa nada de pantalla.
 */
export function TransferTray({ storeId, currency, initialOrders }: { storeId: number; currency: string; initialOrders: Order[] }) {
  const [orders, setOrders] = useState(initialOrders)
  const [selected, setSelected] = useState<Order | null>(null)

  const poll = useCallback(async () => {
    const next = await fetchPendingTransfers(storeId)
    if (next) setOrders(next)
  }, [storeId])

  useEffect(() => {
    let cancelled = false
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    async function safePoll() {
      if (!cancelled) await poll()
    }

    function scheduleDebouncedPoll() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void safePoll(), REALTIME_DEBOUNCE_MS)
    }

    const supabase = createClient()
    const channel = supabase
      .channel(`kds-transfers-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` }, scheduleDebouncedPoll)
      .subscribe()

    const interval = setInterval(() => void safePoll(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [storeId, poll])

  function handleConfirmed(orderId: number, message: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    setSelected(null)
    toast.success(message)
  }

  // Sin transferencias pendientes, la bandeja no ocupa espacio: el tablero es
  // la pantalla, no la bandeja. `null`, no un `EmptyState` — ese vacío no le
  // dice nada útil al encargado, que ya sabe que no tiene nada que confirmar.
  if (orders.length === 0) return null

  const selectedFresh = selected ? (orders.find((o) => o.id === selected.id) ?? null) : null

  return (
    <section className="mb-6 flex flex-col gap-3">
      <PanelHeading
        as="h2"
        title="Transferencias por confirmar"
        description="El cliente ya transfirió y espera que el pedido entre a cocina."
        action={
          <span className="bg-warning/20 text-warning-foreground inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold">
            <Landmark className="size-3.5" aria-hidden />
            {orders.length}
          </span>
        }
      />
      <div className="border-border bg-card overflow-hidden rounded-lg border shadow-flat">
        <div className="divide-border flex flex-col divide-y">
          {orders.map((order) => (
            <TransferRow key={order.id} order={order} currency={currency} onSelect={setSelected} />
          ))}
        </div>
      </div>

      {selectedFresh ? (
        <ConfirmDialog order={selectedFresh} currency={currency} onClose={() => setSelected(null)} onConfirmed={handleConfirmed} />
      ) : null}
    </section>
  )
}
