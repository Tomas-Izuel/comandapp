'use client'

import * as React from 'react'
import { Check, Copy, FileText, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { WhatsApp } from '@/components/ui/whatsapp'
import { Panel, StatusPill } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { MAX_RECEIPT_BYTES } from '@/models/schemas/order.schema'
import { uploadTransferReceipt, type UploadReceiptPhase } from '@/views/storefront/receipt-upload'
import type { OrderPublicView } from '@/models/types'

const PHASE_LABEL: Record<UploadReceiptPhase, string> = {
  compressing: 'Preparando la foto…',
  uploading: 'Subiendo comprobante…',
}

// Mismo criterio que `product-image-field.tsx`: no hay progreso real por byte
// (storage-js no lo expone sin una dependencia nueva), así que la barra avanza
// por ETAPA conocida en vez de mentir con un porcentaje.
const PHASE_PROGRESS: Record<UploadReceiptPhase, number> = {
  compressing: 35,
  uploading: 80,
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Separa cada 4 caracteres SOLO para mostrar — el valor que se copia es el original, sin tocar. */
function chunk4(value: string): string {
  return value.replace(/(.{4})(?=.)/g, '$1 ')
}

/**
 * CBU/alias con botón de copiar. En mobile, tipear 22 dígitos a mano en el
 * homebanking es un error garantizado — copiar de un toque es lo que separa
 * "el cliente transfirió bien" de "transfirió a otro lado".
 */
function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // El valor sigue visible y seleccionable a mano — no hay nada más que ofrecer.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="tabular bg-muted text-foreground min-w-0 flex-1 rounded-lg px-3 py-2.5 text-base font-semibold break-all">
        {chunk4(value)}
      </span>
      <Button type="button" variant="outline" size="icon" aria-label={`Copiar ${label}`} onClick={handleCopy}>
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </Button>
    </div>
  )
}

/** El archivo elegido, antes de confirmar: la foto tal cual se va a ver, o el nombre si es un PDF. */
function FilePreview({ file, previewUrl }: { file: File; previewUrl: string | null }) {
  if (previewUrl) {
    return (
      <div className="border-border bg-muted overflow-hidden rounded-(--radius-md) border">
        {/* eslint-disable-next-line @next/next/no-img-element -- preview local de un File, no un asset servido */}
        <img src={previewUrl} alt="Comprobante elegido" className="max-h-64 w-full object-contain" />
      </div>
    )
  }
  return (
    <div className="border-border flex items-center gap-3 rounded-(--radius-md) border px-3 py-2.5">
      <FileText className="text-muted-foreground size-6 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{file.name || 'comprobante.pdf'}</span>
        <span className="text-muted-foreground text-xs">{formatFileSize(file.size)}</span>
      </div>
    </div>
  )
}

/**
 * El panel de transferencia del seguimiento. Solo tiene sentido mientras el
 * pedido sigue `pending`: apenas el staff confirma el pago, `status` pasa a
 * `confirmed` a la vez que `paymentStatus` pasa a `approved` — ese es el
 * momento en que el panel deja de mostrarse (decisión del padre,
 * `order-tracking.tsx`, que es quien decide SI renderiza esto, igual que ya
 * hace con `ResumePaymentButton`).
 *
 * Orden de importancia, de arriba a abajo (00-architecture.md §5.7 / T4.4):
 * el monto exacto, el CBU/alias con copiar de un toque, titular y banco, el
 * `shortCode` como referencia, y por último el control de subida — que es de
 * UN SOLO TIRO. La advertencia de "un solo comprobante" va JUNTO al botón de
 * confirmar, antes de subir, nunca después: es la mitigación de interfaz al
 * riesgo que el dueño del producto aceptó a conciencia.
 */
export function TransferPanel({
  order,
  token,
  whatsappPhoneE164,
  onOrderChange,
}: {
  order: OrderPublicView
  token: string
  /** El WhatsApp del LOCAL (no el del cliente): es el escape hatch de "subí cualquier cosa". */
  whatsappPhoneE164: string | null
  /** El padre sincroniza su propio estado de `order` — mismo patrón que el poll de `OrderTracking`. */
  onOrderChange: (order: OrderPublicView) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pickedFile, setPickedFile] = React.useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [fieldError, setFieldError] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<UploadReceiptPhase | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  // Se pone en `true` cuando un 409 (perdiste la carrera de subida) no se
  // pudo resolver refrescando el pedido real: no sabemos el estado exacto,
  // pero SÍ sabemos que la invariante de "un comprobante por pedido" ya se
  // cerró en el servidor, así que tratamos esto como terminal igual.
  const [forceDone, setForceDone] = React.useState(false)

  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // Guarda defensiva: este panel no tiene nada que mostrar para otro método
  // de pago. La decisión de SI renderizarlo (según `status`) es del padre.
  if (order.paymentMethod !== 'transfer') return null

  const uploaded = order.transferReceiptUploadedAt !== null || forceDone
  const uploading = phase !== null
  const whatsappHref = whatsappPhoneE164 ? `https://wa.me/${whatsappPhoneE164.replace(/\D/g, '')}` : null

  function openPicker() {
    inputRef.current?.click()
  }

  function handleFilePicked(file: File | undefined) {
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setUploadError(null)

    const isPdf = file.type === 'application/pdf'
    const isImage = file.type.startsWith('image/')

    if (!isPdf && !isImage) {
      setPickedFile(file)
      setPreviewUrl(null)
      setFieldError('Subí una foto o un PDF del comprobante.')
      return
    }
    if (isPdf && file.size > MAX_RECEIPT_BYTES) {
      setPickedFile(file)
      setPreviewUrl(null)
      setFieldError(`Este PDF pesa ${formatFileSize(file.size)} — el máximo es 4 MB. Elegí otro archivo.`)
      return
    }

    setFieldError(null)
    setPickedFile(file)
    setPreviewUrl(isImage ? URL.createObjectURL(file) : null)
  }

  async function refetchOrder() {
    try {
      const res = await fetch(`/api/orders/${token}`)
      if (res.ok) {
        const body: { order: OrderPublicView } = await res.json()
        onOrderChange(body.order)
        return
      }
    } catch {
      // sigue abajo con el mensaje genérico
    }
    setForceDone(true)
  }

  async function handleConfirm() {
    if (!pickedFile || fieldError) return
    setUploadError(null)
    const result = await uploadTransferReceipt(token, pickedFile, setPhase)
    setPhase(null)

    if (!result.ok) {
      if (result.status === 409) {
        // Otra pestaña (u otro reintento) ya ganó la carrera: la fuente de
        // verdad es el pedido real, no un supuesto local.
        await refetchOrder()
        return
      }
      setUploadError(result.error)
      return
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPickedFile(null)
    setPreviewUrl(null)
    onOrderChange(result.order)
  }

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <h2 className="text-sm font-semibold">Transferí para confirmar tu pedido</h2>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-sm">Monto exacto</span>
        <Price cents={order.totalCents} currency={order.currency} exact className="tabular text-3xl leading-none font-semibold" />
      </div>

      {order.bankAccount ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">{order.bankAccount.cbu ? 'CBU o CVU' : 'Alias'}</span>
            <CopyValue
              value={order.bankAccount.cbu ?? order.bankAccount.alias ?? ''}
              label={order.bankAccount.cbu ? 'el CBU' : 'el alias'}
            />
            {order.bankAccount.cbu && order.bankAccount.alias ? (
              <p className="text-muted-foreground text-xs">
                Alias: <span className="text-foreground font-medium">{order.bankAccount.alias}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-medium">{order.bankAccount.holderName}</span>
            {order.bankAccount.bankName ? <span className="text-muted-foreground">{order.bankAccount.bankName}</span> : null}
          </div>

          <div className="border-border flex items-center justify-between gap-3 rounded-(--radius-md) border border-dashed px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">Poné como referencia</span>
            <span className="tabular font-semibold">#{order.shortCode}</span>
          </div>

          {/* `aria-live` porque el pasaje de "picker" a "recibido" pasa SOLO
              (la respuesta de `handleConfirm`), sin que el foco se mueva ahí
              — sin esto, alguien con lector de pantalla no se entera de que
              la subida terminó. */}
          <div aria-live="polite" className="contents">
            {uploaded ? (
              <div className="bg-muted flex items-start gap-2.5 rounded-(--radius-md) px-3 py-3">
                <StatusPill tone="live" dot className="shrink-0">
                  Comprobante recibido
                </StatusPill>
                <p className="text-muted-foreground text-sm">
                  El local lo está revisando. Te avisamos por WhatsApp en cuanto confirme el pago.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {pickedFile ? (
                  <>
                    <FilePreview file={pickedFile} previewUrl={previewUrl} />

                    {fieldError ? (
                      <p role="alert" className="text-destructive text-xs">
                        {fieldError}
                      </p>
                    ) : (
                      <div className="bg-warning/20 text-warning-foreground flex items-start gap-2 rounded-(--radius-md) px-3 py-2.5 text-xs">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>Revisá que se lea bien el monto y la fecha. Solo podés subir un comprobante.</span>
                      </div>
                    )}

                    {uploading ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" aria-hidden />
                          <span className="text-muted-foreground text-xs">{PHASE_LABEL[phase]}</span>
                        </div>
                        <div
                          className="bg-muted h-1 w-full overflow-hidden rounded-pill"
                          role="progressbar"
                          aria-label="Subiendo comprobante"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={PHASE_PROGRESS[phase]}
                        >
                          <div
                            className="bg-primary h-full rounded-pill transition-[width] duration-(--dur-base)"
                            style={{ width: `${PHASE_PROGRESS[phase]}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" className="h-11 flex-1 rounded-pill" onClick={openPicker}>
                          Elegir otro
                        </Button>
                        {!fieldError ? (
                          <Button type="button" className="h-11 flex-1 rounded-pill" onClick={handleConfirm}>
                            Confirmar y subir
                          </Button>
                        ) : null}
                      </div>
                    )}

                    {uploadError ? (
                      <Alert variant="destructive" aria-live="assertive">
                        <AlertDescription>{uploadError}</AlertDescription>
                      </Alert>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={openPicker}
                    className="border-border text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-(--radius-md) border border-dashed px-4 py-6 text-center transition-colors duration-(--dur-fast) outline-none focus-visible:ring-3"
                  >
                    <span className="text-foreground text-sm font-medium">Subí tu comprobante</span>
                    <span className="text-xs">Foto o PDF, hasta 4 MB — una sola vez</span>
                  </button>
                )}

                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    // Sin esto, elegir el MISMO archivo dos veces seguidas (ej.
                    // después de un error) no dispara `change` la segunda vez.
                    event.target.value = ''
                    handleFilePicked(file)
                  }}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          No pudimos cargar los datos de la cuenta del local. Escribinos por WhatsApp para coordinar el pago.
        </p>
      )}

      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Escribinos por WhatsApp, abre en otra pestaña"
          className="text-muted-foreground hover:text-foreground flex min-h-11 items-center justify-center gap-2 text-sm underline-offset-4 hover:underline"
        >
          <WhatsApp className="size-4 shrink-0" aria-hidden />
          ¿Subiste el comprobante equivocado? Escribinos por WhatsApp
        </a>
      ) : null}
    </Panel>
  )
}
