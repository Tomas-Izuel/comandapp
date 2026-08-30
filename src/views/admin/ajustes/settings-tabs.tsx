'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Sub-nav de las tres páginas de Ajustes. Son `<Link>` reales a sub-rutas, no
 * un `Tabs` de cliente con estado propio — a propósito (00-architecture.md):
 * con un solo `useForm` viviendo detrás de tabs de cliente, los cambios de
 * una tab inactiva siguen vivos y la barra de guardado los aplica igual. Acá
 * cada page tiene su propio `useForm` (o ninguno, en Horarios) y solo carga
 * lo que necesita — es imposible guardar un campo que no estás viendo.
 *
 * Cliente solo por `usePathname`: el resto es navegación de plataforma.
 */
const TABS = [
  { href: '/admin/ajustes', label: 'El local' },
  { href: '/admin/ajustes/pedidos', label: 'Pedidos y envío' },
  { href: '/admin/ajustes/horarios', label: 'Horarios' },
] as const

function isTabActive(pathname: string, href: string): boolean {
  // La raíz necesita match exacto: con `startsWith` a secas, "/admin/ajustes"
  // matchea también "/admin/ajustes/pedidos" y las tres tabs quedarían
  // marcadas a la vez en esa sub-ruta.
  return href === '/admin/ajustes' ? pathname === href : pathname.startsWith(href)
}

export function SettingsTabs() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Secciones de Ajustes"
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
