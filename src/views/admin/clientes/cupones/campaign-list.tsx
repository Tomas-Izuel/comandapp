'use client'

import { Send } from 'lucide-react'
import { Panel, StatusPill } from '@/views/shared/surfaces'
import { EmptyState } from '@/views/shared/states'
import { formatDateTime } from '@/lib/dates'
import { campaignStoppedReasonLabel, segmentLabel } from './format'
import type { CampaignStatus, CouponCampaign } from '@/models/types'

/**
 * El log de campañas: solo lectura (§5.6). `stopped` y `failed` NO se ven
 * iguales — es una de las cinco cosas que este slice no puede errar
 * (00-architecture.md §5.10.3.1): `failed` es que falló lo NUESTRO,
 * `stopped` es que la oferta dejó de valer, y su caso más común es "se agotó
 * porque funcionó".
 */
const STATUS_TONE: Record<CampaignStatus, 'neutral' | 'live' | 'warning' | 'danger' | 'done'> = {
  queued: 'neutral',
  sending: 'live',
  sent: 'done',
  stopped: 'neutral',
  failed: 'danger',
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  queued: 'En cola',
  sending: 'Mandando',
  sent: 'Enviada',
  stopped: 'Cortada',
  failed: 'Falló',
}

function resultLabel(campaign: CouponCampaign): string {
  if (campaign.status === 'stopped' && campaign.stoppedReason) {
    return `${campaign.sentCount} enviados · ${campaignStoppedReasonLabel(campaign.stoppedReason)}`
  }
  const parts = [`${campaign.sentCount} enviados`]
  if (campaign.failedCount > 0) parts.push(`${campaign.failedCount} falló`)
  if (campaign.skippedCount > 0) parts.push(`${campaign.skippedCount} de baja`)
  return parts.join(' · ')
}

export function CampaignList({ campaigns, timezone }: { campaigns: CouponCampaign[]; timezone: string }) {
  if (campaigns.length === 0) {
    return (
      <Panel className="p-4 sm:p-5">
        <EmptyState
          icon={<Send className="size-8" />}
          title="Todavía no mandaste ninguna campaña"
          description="Cuando mandes un cupón por mail desde la lista de arriba, el resultado va a quedar acá."
        />
      </Panel>
    )
  }

  return (
    <Panel className="p-4 sm:p-5">
      <div className="text-muted-foreground hidden text-xs font-medium lg:grid lg:grid-cols-[6rem_minmax(0,1fr)_9rem_minmax(0,1.2fr)] lg:gap-4 lg:border-b lg:pb-2">
        <span>Cupón</span>
        <span>Segmento</span>
        <span>Cuándo</span>
        <span>Resultado</span>
      </div>
      <div className="divide-border divide-y">
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="flex flex-col gap-1.5 py-3 lg:grid lg:grid-cols-[6rem_minmax(0,1fr)_9rem_minmax(0,1.2fr)] lg:items-center lg:gap-4 lg:py-2.5">
            <span className="text-foreground font-mono text-sm font-semibold">{campaign.couponCode}</span>
            <span className="text-muted-foreground text-sm">{segmentLabel(campaign.segment)}</span>
            <span className="text-muted-foreground tabular text-sm">{formatDateTime(campaign.createdAt, timezone)}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill tone={STATUS_TONE[campaign.status]}>{STATUS_LABEL[campaign.status]}</StatusPill>
              <span className="text-muted-foreground tabular">{resultLabel(campaign)}</span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
