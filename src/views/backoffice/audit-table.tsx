import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTimeLong } from '@/lib/dates'
import type { AuditEntry } from '@/models/types'

/**
 * Una entrada de auditoría no pertenece a un local particular —puede ser el
 * alta de una tienda que todavía no existía— así que no hay `store.timezone`
 * que pedirle. Hoy toda la plataforma opera en una sola zona (el default de
 * `platform.schema.ts` al crear una tienda), así que se ancla ahí en vez de
 * mentir con la zona del proceso.
 */
const PLATFORM_TIMEZONE = 'America/Argentina/Buenos_Aires'

const ACTION_LABEL: Record<string, string> = {
  'store.created': 'Alta de tienda',
  'store.status_changed': 'Cambio de estado',
}

function formatPayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
  if (entries.length === 0) return '—'
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Acción</TableHead>
          <TableHead>Objetivo</TableHead>
          <TableHead>Detalle</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
              {formatDateTimeLong(entry.createdAt, PLATFORM_TIMEZONE)}
            </TableCell>
            <TableCell className="whitespace-nowrap">{entry.actorEmail ?? '—'}</TableCell>
            <TableCell className="whitespace-nowrap">{ACTION_LABEL[entry.action] ?? entry.action}</TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
              {entry.targetType ? `${entry.targetType} #${entry.targetId}` : '—'}
            </TableCell>
            <TableCell className="text-muted-foreground max-w-[40ch] truncate text-xs" title={formatPayload(entry.payload)}>
              {formatPayload(entry.payload)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
