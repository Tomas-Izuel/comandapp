import Link from 'next/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Price } from '@/views/shared/money'
import { StoreStatusBadge } from '@/views/backoffice/status-badge'
import { formatDateTimeLong } from '@/lib/dates'
import type { PlatformStoreRow } from '@/models/types'

export function StoreTable({ stores }: { stores: PlatformStoreRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tienda</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Dueño</TableHead>
          <TableHead className="text-right">Pedidos 30d</TableHead>
          <TableHead className="text-right">Facturación 30d</TableHead>
          <TableHead>Alta</TableHead>
          <TableHead className="sr-only">Detalle</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stores.map((store) => (
          <TableRow key={store.id}>
            <TableCell>
              <Link href={`/backoffice/tiendas/${store.id}`} className="hover:underline">
                <span className="block font-medium">{store.name}</span>
                <span className="text-muted-foreground font-mono text-xs">/{store.slug}</span>
              </Link>
            </TableCell>
            <TableCell>
              <StoreStatusBadge status={store.status} />
            </TableCell>
            <TableCell className="text-muted-foreground">{store.ownerEmail ?? '—'}</TableCell>
            <TableCell className="tabular text-right">{store.ordersLast30}</TableCell>
            <TableCell className="tabular text-right">
              <Price cents={store.revenueLast30Cents} currency={store.currency} />
            </TableCell>
            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
              {formatDateTimeLong(store.createdAt, store.timezone)}
            </TableCell>
            <TableCell>
              <Link
                href={`/backoffice/tiendas/${store.id}`}
                className="text-muted-foreground hover:text-foreground text-xs font-medium"
              >
                Ver
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
