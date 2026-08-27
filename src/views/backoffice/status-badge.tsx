import { StatusPill } from '@/views/shared/surfaces'
import type { StoreStatus } from '@/models/types'

const STATUS_LABEL: Record<StoreStatus, string> = {
  active: 'Activa',
  suspended: 'Suspendida',
}

export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  return (
    <StatusPill tone={status === 'active' ? 'live' : 'danger'} dot>
      {STATUS_LABEL[status]}
    </StatusPill>
  )
}
