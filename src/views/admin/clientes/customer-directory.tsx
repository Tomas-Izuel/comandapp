'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import { Panel, SearchField } from '@/views/shared/surfaces'
import { EmptyState } from '@/views/shared/states'
import { CUSTOMER_GRID_COLS, CustomerRow } from './customer-row'
import { CustomerSheet } from './customer-sheet'
import type { Coupon, CustomerDirectory, StoreCustomer } from '@/models/types'

/** Cabecera de columnas, solo en `lg` — abajo la fila colapsa y las etiquetas van inline (ver `customer-row.tsx`). */
function ColumnHeader() {
  return (
    <div
      className={`text-muted-foreground border-border hidden text-xs font-medium lg:grid ${CUSTOMER_GRID_COLS} lg:gap-4 lg:border-b lg:pb-2`}
    >
      <span>Cliente</span>
      <span>Gastado</span>
      <span>Pedidos</span>
      <span>Ticket prom.</span>
      <span>Última compra</span>
      <span>Contacto</span>
    </div>
  )
}

/** Búsqueda por nombre o teléfono, del lado del cliente: el padrón de un local entra en una sola lectura (§5.5). */
function matchesQuery(customer: StoreCustomer, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (customer.displayName.toLowerCase().includes(q)) return true
  // El teléfono se busca por dígitos: nadie tipea el "+" del E.164.
  const qDigits = q.replace(/\D/g, '')
  return qDigits.length > 0 && customer.phoneE164.replace(/\D/g, '').includes(qDigits)
}

export function CustomerDirectoryView({
  storeId,
  storeName,
  storeSlug,
  timezone,
  currency,
  directory,
  activeCoupons = [],
}: {
  storeId: number
  storeName: string
  storeSlug: string
  timezone: string
  currency: string
  directory: CustomerDirectory
  /** Cupones que el menú de WhatsApp puede ofrecer. Vacío = el menú no aparece. */
  activeCoupons?: Coupon[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  // `selectedId` y `sheetOpen` van separados a propósito (mismo patrón que
  // `drawer.product`/`drawer.open` en `category-list.tsx`): al cerrar, solo
  // cambia `sheetOpen`. Si también se limpiara `selectedId` en el mismo
  // instante, el contenido de la hoja desaparecería a mitad de la animación
  // de salida de `vaul` en vez de deslizarse afuera con el cliente todavía
  // adentro.
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const filtered = useMemo(
    () => directory.customers.filter((customer) => matchesQuery(customer, query)),
    [directory.customers, query],
  )
  // Lee siempre del array actual (no de una copia capturada al abrir), así
  // que un guardado que llega mientras la hoja está abierta (nota, baja) se
  // ve reflejado ahí mismo apenas `router.refresh()` trae los datos nuevos.
  const selectedCustomer = selectedId === null ? null : (directory.customers.find((c) => c.id === selectedId) ?? null)

  if (directory.customers.length === 0) {
    return (
      <Panel className="p-4 sm:p-5">
        <EmptyState
          icon={<Users className="size-8" />}
          title="Todavía no tenés clientes"
          description="Acá van a aparecer los clientes cuando entren los primeros pedidos."
        />
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tres números, en texto — nunca tarjetas (piso de calidad). */}
      <p className="text-muted-foreground text-sm">
        <span className="tabular text-foreground font-medium">{directory.totals.customers}</span>{' '}
        {directory.totals.customers === 1 ? 'cliente' : 'clientes'} ·{' '}
        <span className="tabular text-foreground font-medium">{directory.totals.withEmail}</span> con email ·{' '}
        <span className="tabular text-foreground font-medium">{directory.totals.inactive30}</span> sin comprar hace más
        de 30 días
      </p>

      <SearchField
        value={query}
        onValueChange={setQuery}
        label="Buscar cliente por nombre o teléfono"
        placeholder="Buscar por nombre o teléfono…"
        className="h-11 max-w-sm"
      />

      <Panel className="p-4 sm:p-5">
        <ColumnHeader />
        {filtered.length === 0 ? (
          <EmptyState
            title="Ningún cliente coincide"
            description={`Probá con otro nombre o teléfono — "${query}" no encontró resultados.`}
          />
        ) : (
          <div className="divide-border divide-y">
            {filtered.map((customer) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                storeName={storeName}
                storeSlug={storeSlug}
                activeCoupons={activeCoupons}
                currency={currency}
                onOpenDetail={() => {
                  setSelectedId(customer.id)
                  setSheetOpen(true)
                }}
              />
            ))}
          </div>
        )}
      </Panel>

      <CustomerSheet
        storeId={storeId}
        customer={selectedCustomer}
        timezone={timezone}
        currency={currency}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}
