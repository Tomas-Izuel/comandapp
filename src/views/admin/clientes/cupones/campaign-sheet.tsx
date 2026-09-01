'use client'

import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Mail } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { MoneyInput } from '@/views/shared/money-input'
import { formatDayShort, zonedDay } from '@/lib/dates'
import { describeDiscount } from '@/lib/coupon'
import { previewCampaignAction, sendCampaignAction, requestCampaignQuotaAction } from '@/controllers/marketing.actions'
import type { CampaignPreview, CampaignSegment, Coupon } from '@/models/types'

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: CampaignPreview }
  | { status: 'error'; message: string }

/**
 * El flujo de mandar un cupón por mail (§5.6 y §5.10.3.1). Es un PASO DE
 * CONFIRMACIÓN, no un botón que manda: elegir segmento → el servidor
 * devuelve `CampaignPreview` → se muestra la cuenta completa → recién ahí
 * "Mandar". Un envío que no se puede deshacer no se dispara con un click.
 *
 * El preview se pide con un botón explícito ("Calcular destinatarios"), no en
 * cada tecla de los inputs de N / monto — mismo criterio que el checkout, que
 * cobra un balde en el fallo justamente para no necesitar debounce acá
 * tampoco: cada preview es una decisión del dueño, no una tecla más.
 */
export function CampaignSheet({
  storeId,
  timezone,
  currency,
  storeName,
  coupon,
  open,
  onOpenChange,
  onSent,
}: {
  storeId: number
  timezone: string
  currency: string
  storeName: string
  coupon: Coupon | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent: () => void
}) {
  const [segmentKind, setSegmentKind] = useState<CampaignSegment['kind']>('all')
  const [topN, setTopN] = useState(10)
  const [minSpentCents, setMinSpentCents] = useState(0)
  const [subject, setSubject] = useState(`Un cupón de ${storeName} para vos`)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const [sending, startSendTransition] = useTransition()
  const [previewing, startPreviewTransition] = useTransition()

  const [quotaOpen, setQuotaOpen] = useState(false)
  const [quotaMessage, setQuotaMessage] = useState('')
  const [quotaSent, setQuotaSent] = useState(false)
  const [quotaFailed, setQuotaFailed] = useState(false)
  const [quotaPending, startQuotaTransition] = useTransition()

  const subjectId = useId()
  const messageId = useId()
  const sendReasonId = useId()

  if (!coupon) return null

  function buildSegment(): CampaignSegment {
    if (segmentKind === 'all') return { kind: 'all' }
    if (segmentKind === 'top_n') return { kind: 'top_n', topN }
    return { kind: 'min_spent', minSpentCents }
  }

  function handlePreview() {
    setPreview({ status: 'loading' })
    startPreviewTransition(async () => {
      const result = await previewCampaignAction(storeId, { couponId: coupon!.id, segment: buildSegment() })
      if (!result.ok) {
        setPreview({ status: 'error', message: result.error })
        return
      }
      setPreview({ status: 'ready', preview: result.data })
    })
  }

  function handleSend() {
    if (preview.status !== 'ready') return
    startSendTransition(async () => {
      const result = await sendCampaignAction(storeId, {
        couponId: coupon!.id,
        segment: buildSegment(),
        subject,
        message: message.trim() || null,
      })
      if (!result.ok) {
        toast.error('No se pudo mandar la campaña', { description: result.error })
        return
      }
      toast.success('Campaña encolada. Se va a mandar de a poco, respetando el cupo diario.')
      onSent()
    })
  }

  function handleQuotaRequest() {
    if (preview.status !== 'ready') return
    startQuotaTransition(async () => {
      const result = await requestCampaignQuotaAction(storeId, {
        requestedRecipients: preview.preview.willSend,
        daysNeeded: preview.preview.daysNeeded,
        message: quotaMessage,
      })
      if (!result.ok) {
        setQuotaFailed(true)
        return
      }
      setQuotaSent(true)
    })
  }

  const readyPreview = preview.status === 'ready' ? preview.preview : null
  const blocked = readyPreview !== null && !readyPreview.fitsBeforeExpiry
  const noRecipients = readyPreview !== null && readyPreview.willSend === 0

  const sendDisabledReason = !readyPreview
    ? 'Calculá los destinatarios antes de mandar.'
    : noRecipients
      ? 'Nadie de este segmento tiene mail, o todos se dieron de baja.'
      : blocked
        ? 'El cupón vence antes de terminar de mandarse con el cupo actual.'
        : null

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <DrawerHeader>
          <DrawerTitle>Mandar {coupon.code} por mail</DrawerTitle>
          <DrawerDescription>
            {describeDiscount(coupon, currency)} · elegí a quién, mirá la cuenta, y recién ahí mandá.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">A quién</legend>
            <RadioGroup
              value={segmentKind}
              onValueChange={(v) => {
                setSegmentKind(v as CampaignSegment['kind'])
                setPreview({ status: 'idle' })
              }}
              className="flex flex-col gap-2"
            >
              <Label
                htmlFor="segment-all"
                className="border-border flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3"
              >
                <RadioGroupItem id="segment-all" value="all" />
                Todos los clientes
              </Label>
              <Label
                htmlFor="segment-top-n"
                className="border-border flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3"
              >
                <RadioGroupItem id="segment-top-n" value="top_n" />
                <span className="shrink-0">Los mejores</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={topN}
                  disabled={segmentKind !== 'top_n'}
                  onChange={(e) => {
                    setTopN(Math.max(1, Number(e.target.value) || 1))
                    setPreview({ status: 'idle' })
                  }}
                  className="tabular h-8 w-20"
                  aria-label="Cantidad de clientes"
                />
                <span className="shrink-0">por plata gastada</span>
              </Label>
              <Label
                htmlFor="segment-min-spent"
                className="border-border flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3"
              >
                <RadioGroupItem id="segment-min-spent" value="min_spent" />
                <span className="shrink-0">Gastaron más de</span>
                <MoneyInput
                  cents={minSpentCents}
                  onCentsChange={(v) => {
                    setMinSpentCents(v)
                    setPreview({ status: 'idle' })
                  }}
                  currency={currency}
                  disabled={segmentKind !== 'min_spent'}
                  aria-label="Monto mínimo gastado"
                  className="h-8 w-28"
                />
              </Label>
            </RadioGroup>
            <Button
              type="button"
              variant="outline"
              onClick={handlePreview}
              disabled={previewing}
              className="w-fit gap-2"
            >
              {previewing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Calcular destinatarios
            </Button>
          </fieldset>

          {preview.status === 'error' ? (
            <p role="alert" className="text-destructive text-sm">
              {preview.message}
            </p>
          ) : null}

          {readyPreview ? (
            <div className="flex flex-col gap-2">
              <p className="bg-muted/50 rounded-lg px-3 py-2.5 text-sm">
                <span className="tabular font-medium">{readyPreview.inSegment}</span> en el segmento ·{' '}
                <span className="tabular font-medium">{readyPreview.withEmail}</span> con email ·{' '}
                <span className="tabular font-medium">{readyPreview.optedOut}</span> se dieron de baja · se manda a{' '}
                <span className="tabular font-medium">{readyPreview.willSend}</span>
              </p>

              {readyPreview.willSend > 0 ? (
                <p className="text-sm">
                  Con el cupo de 15 por día son <span className="tabular font-medium">{readyPreview.daysNeeded}</span>{' '}
                  {readyPreview.daysNeeded === 1 ? 'día' : 'días'}: el último mail sale el{' '}
                  <span className="tabular font-medium">{formatDayShort(readyPreview.lastSendDate)}</span>.
                  {readyPreview.couponEndsAt ? (
                    <>
                      {' '}
                      El cupón vence el{' '}
                      <span className="tabular font-medium">
                        {formatDayShort(zonedDay(readyPreview.couponEndsAt, timezone))}
                      </span>
                      {blocked ? null : ' — entra.'}
                    </>
                  ) : null}
                </p>
              ) : null}

              {blocked ? (
                <p role="alert" className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2.5 text-sm">
                  Con este cupo, el último mail sale el {formatDayShort(readyPreview.lastSendDate)} y el cupón vence el{' '}
                  {readyPreview.couponEndsAt ? formatDayShort(zonedDay(readyPreview.couponEndsAt, timezone)) : ''}. Estirá la
                  vigencia hasta esa fecha, mandá a menos gente, o pedí más cupo.
                </p>
              ) : null}

              {coupon.maxRedemptions < readyPreview.willSend ? (
                <p className="text-muted-foreground text-sm">
                  Cupón para <span className="tabular">{coupon.maxRedemptions}</span> usos, se manda a{' '}
                  <span className="tabular">{readyPreview.willSend}</span> personas. Es normal: la tasa de canje de un
                  cupón por mail es baja.
                </p>
              ) : null}

              {/* La vía comercial aparece SOLO acá, y solo cuando el cupo
                  molesta de verdad (daysNeeded > 1) — nunca permanente
                  (00-architecture.md §5.10.6). */}
              {readyPreview.daysNeeded > 1 ? (
                <div className="border-border rounded-lg border border-dashed p-3">
                  {quotaSent ? (
                    <p role="status" className="text-sm">
                      Listo, le avisamos al equipo. Te contestamos por mail.
                    </p>
                  ) : !quotaOpen ? (
                    <Button type="button" variant="link" onClick={() => setQuotaOpen(true)} className="h-11 justify-start px-0">
                      ¿15 por día no te alcanza? Pedí más cupo
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium">Pedir más cupo de mail</p>
                      <Textarea
                        value={quotaMessage}
                        onChange={(e) => setQuotaMessage(e.target.value.slice(0, 500))}
                        placeholder="Contanos qué necesitás (opcional)"
                        rows={2}
                        maxLength={500}
                        aria-label="Mensaje para el equipo"
                      />
                      {quotaFailed ? (
                        <p className="text-muted-foreground text-sm">
                          No pudimos mandar el pedido. Escribinos directo a{' '}
                          <a href="mailto:ventas@comandapp.ar" className="underline">
                            ventas@comandapp.ar
                          </a>
                          .
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button type="button" onClick={handleQuotaRequest} disabled={quotaPending} className="gap-1.5">
                          {quotaPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                          Mandar pedido
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setQuotaOpen(false)} disabled={quotaPending}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={subjectId}>Asunto</Label>
            <Input
              id={subjectId}
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, 150))}
              placeholder={`Un cupón para vos`}
              maxLength={150}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={messageId}>Mensaje (opcional)</Label>
            <Textarea
              id={messageId}
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              placeholder="Un par de líneas de tu parte, además del código y el descuento"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DrawerFooter className="border-t pt-4">
          <p id={sendReasonId} className="text-muted-foreground min-h-4 text-xs">
            {sendDisabledReason ?? ''}
          </p>
          <div className="flex justify-end gap-2">
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DrawerClose>
            <Button
              type="button"
              onClick={handleSend}
              disabled={sending || !!sendDisabledReason || !subject.trim()}
              aria-describedby={sendReasonId}
              className="gap-2"
            >
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" aria-hidden />}
              Mandar
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
