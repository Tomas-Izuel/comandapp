'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChefHat,
  ClipboardList,
  UtensilsCrossed,
  BarChart3,
  Palette,
  CreditCard,
  Settings,
  LogOut,
  Ban,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOutAction } from '@/controllers/admin.actions'
import type { StoreStatus } from '@/models/types'

/**
 * Nav del panel. Misma fila, siempre en el mismo lugar, siempre visible: es
 * lo que permite retomar sin releer la pantalla entera después de una
 * interrupción. Nada de sidebar ancha que le come lugar a la cola de cocina.
 */
const NAV_ITEMS = [
  { href: '/admin', label: 'Cocina', icon: ChefHat },
  { href: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList },
  { href: '/admin/catalogo', label: 'Catálogo', icon: UtensilsCrossed },
  { href: '/admin/dashboard', label: 'Métricas', icon: BarChart3 },
  { href: '/admin/apariencia', label: 'Apariencia', icon: Palette },
  { href: '/admin/pagos', label: 'Pagos', icon: CreditCard },
  { href: '/admin/ajustes', label: 'Ajustes', icon: Settings },
] as const

export function AdminShell({
  storeName,
  role,
  email,
  storeStatus,
  children,
}: {
  storeName: string
  role: 'owner' | 'staff'
  email: string
  storeStatus: StoreStatus
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-border bg-card sticky top-0 z-40 border-b">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{storeName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {role === 'owner' ? 'Dueño' : 'Encargado'} · {email}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await signOutAction()
              router.replace('/admin/acceso')
              router.refresh()
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:outline-none"
          >
            <LogOut className="size-4" />
            Salir
          </button>
        </div>
        <nav
          aria-label="Secciones del panel"
          className="flex gap-1 overflow-x-auto px-2 pb-2 sm:px-4 [scrollbar-width:none]"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        {/* Adentro del `<header>` (no como hermano) a propósito: el tablero de
            cocina mide el alto de `header` con `ResizeObserver` para ubicar su
            propia barra pegajosa debajo — si el aviso quedara afuera, ese
            cálculo lo ignoraría y la barra del tablero taparía el aviso. */}
        {storeStatus === 'suspended' ? (
          <div
            role="status"
            className="bg-destructive/10 text-destructive flex items-center gap-2 border-t border-destructive/20 px-4 py-2.5 text-sm font-medium sm:px-6"
          >
            <Ban className="size-4 shrink-0" aria-hidden />
            Este local está suspendido por la plataforma: los clientes no pueden verlo ni pedir hasta que se reactive.
          </div>
        ) : null}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
