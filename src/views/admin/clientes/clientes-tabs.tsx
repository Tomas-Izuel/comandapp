'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Sub-nav de las dos superficies de Clientes: el Padrón (T2A) y Cupones
 * (T4B, todavía sin page.tsx al momento de escribir esto). Mismo patrón que
 * `SettingsTabs` (`views/admin/ajustes/settings-tabs.tsx`): `<Link>` reales a
 * sub-rutas, no un `Tabs` de cliente con estado propio — cada page resuelve
 * su propia sesión y trae sus propios datos, así que no hay estado
 * compartido que un tab de cliente pudiera esconder.
 *
 * Cliente solo por `usePathname`.
 */
const TABS = [
  { href: '/admin/clientes', label: 'Padrón' },
  { href: '/admin/clientes/cupones', label: 'Cupones' },
] as const

function isTabActive(pathname: string, href: string): boolean {
  // La raíz necesita match exacto: con `startsWith` a secas, "/admin/clientes"
  // matchea también "/admin/clientes/cupones" y las dos tabs quedarían
  // marcadas a la vez ahí.
  return href === '/admin/clientes' ? pathname === href : pathname.startsWith(href)
}

export function ClientesTabs() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Secciones de Clientes"
      className="border-border -mt-1 flex gap-1 overflow-x-auto border-b [scrollbar-width:none]"
    >
      {TABS.map((tab) => {
        const active = isTabActive(pathname, tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
