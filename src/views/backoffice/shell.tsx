'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOutAction } from '@/controllers/platform.actions'

/**
 * Chrome persistente de las rutas autenticadas. Nada de kicker ni de tarjeta:
 * es una barra de navegación de producto, cliente porque necesita saber en
 * qué sección está para resaltarla — el resto de la superficie es server.
 */

const NAV_ITEMS = [
  { href: '/backoffice', label: 'Métricas' },
  { href: '/backoffice/tiendas', label: 'Tiendas' },
  { href: '/backoffice/auditoria', label: 'Auditoría' },
] as const

export function BackofficeShell({
  identity,
  children,
}: {
  identity: { email: string }
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-border bg-background sticky top-0 z-10 border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">Backoffice</span>

          <nav aria-label="Secciones del backoffice" className="flex flex-1 flex-wrap gap-x-1">
            {NAV_ITEMS.map((item) => {
              const active = item.href === '/backoffice' ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center border-b-2 px-2 text-sm font-medium transition-colors',
                    active
                      ? 'text-foreground border-primary'
                      : 'text-muted-foreground hover:text-foreground border-transparent',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-muted-foreground hidden text-xs sm:inline">{identity.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground focus-visible:outline-ring flex min-h-11 items-center gap-1.5 px-2 text-sm font-medium transition-colors"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
