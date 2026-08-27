import { Panel, SectionHeading } from '@/views/shared/surfaces'
import { StoreStatusBadge } from '@/views/backoffice/status-badge'
import { StoreStatusDialog } from '@/views/backoffice/store-status-dialog'
import { CopyLoginLink } from '@/views/backoffice/copy-login-link'
import { Price } from '@/views/shared/money'
import { formatCentsCompact } from '@/lib/money'
import { formatDateTimeLong } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { PlatformStoreRow } from '@/models/types'

/**
 * Nota para quien retome esto: el backoffice todavía NO puede mostrar si una
 * tienda está cobrando con credenciales de prueba de Mercado Pago (el estado
 * "warning" que pide el brief de superficie). `store_payment_credentials` no
 * tiene grants para `authenticated` y `platform_stores()` no selecciona
 * `is_sandbox`, así que `PlatformStoreRow` no trae el dato — no es un olvido
 * de esta vista, es que no existe forma de leerlo desde acá todavía. Falta
 * sumar `is_sandbox` al SELECT de `platform_stores()` (RPC, ya
 * `security definer`) y mapearlo a `PlatformStoreRow.hasSandboxCredentials`
 * antes de poder pintar `<StatusPill tone="warning">`.
 */

function SpecList({
  items,
}: {
  items: { label: string; value: React.ReactNode; muted?: boolean }[]
}) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground text-sm">{item.label}</dt>
          <dd className={cn('text-right text-sm font-medium', item.muted && 'text-muted-foreground font-normal')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function StoreDetail({ store }: { store: PlatformStoreRow }) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
        <StoreStatusBadge status={store.status} />
        <StoreStatusDialog storeId={store.id} slug={store.slug} currentStatus={store.status} />
      </div>

      <Panel elevated={false}>
        <dl className="divide-border divide-y">
          <div className="flex items-baseline justify-between gap-4 px-5 py-4">
            <dt className="text-muted-foreground text-sm">Pedidos últimos 30 días</dt>
            <dd className="tabular text-xl font-semibold">{store.ordersLast30}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 px-5 py-4">
            <dt className="text-muted-foreground text-sm">Facturación últimos 30 días</dt>
            <dd className="tabular text-xl font-semibold">
              <Price cents={store.revenueLast30Cents} currency={store.currency} />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 px-5 py-4">
            <dt className="text-muted-foreground text-sm">Dada de alta</dt>
            <dd className="text-sm">{formatDateTimeLong(store.createdAt, store.timezone)}</dd>
          </div>
        </dl>
      </Panel>

      <SectionHeading as="h2">Dueño</SectionHeading>
      <Panel elevated={false} className="flex flex-col gap-3 p-5">
        <p className="text-sm">{store.ownerEmail ?? 'Sin dueño asignado'}</p>
        <p className="text-muted-foreground max-w-[60ch] text-xs">
          Recibió una invitación por mail con un link directo al panel. Vencen en 1 hora — si no llegó a entrar a
          tiempo, reenviá uno nuevo. Vos nunca ves ni definís su contraseña.
        </p>
        {store.ownerEmail ? (
          <div>
            <CopyLoginLink storeId={store.id} />
          </div>
        ) : null}
      </Panel>

      <SectionHeading as="h2">Operación</SectionHeading>
      <Panel elevated={false} className="p-5">
        <SpecList
          items={[
            {
              label: 'Pago en el local',
              value: store.inStorePaymentEnabled ? 'Habilitado' : 'Deshabilitado',
              muted: !store.inStorePaymentEnabled,
            },
            { label: 'Mínimo', value: formatCentsCompact(store.minOrderCents, store.currency) },
            { label: 'Multiplicador de demanda', value: `×${store.demandMultiplier}` },
          ]}
        />
      </Panel>

      <SectionHeading as="h2">Contacto</SectionHeading>
      <Panel elevated={false} className="p-5">
        <SpecList
          items={[
            { label: 'Teléfono', value: store.phoneE164 ?? '—', muted: !store.phoneE164 },
            { label: 'WhatsApp', value: store.whatsappPhoneE164 ?? '—', muted: !store.whatsappPhoneE164 },
            { label: 'Dirección', value: store.address ?? '—', muted: !store.address },
          ]}
        />
      </Panel>
    </div>
  )
}
