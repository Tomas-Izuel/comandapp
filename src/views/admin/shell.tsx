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
  Bike,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOutAction } from '@/controllers/admin.actions'
import type { StoreStatus } from '@/models/types'

/**
 * Nav del panel: siete secciones, siempre en el mismo lugar.
 *
 * La escena primaria ahora es el monitor fijo del mostrador. En ≥lg (1024px)
 * eso se traduce en un rail lateral de `--admin-rail`: las siete secciones
 * quedan visibles a la vez, sin scroll y sin overflow, en posición constante.
 * 240px son el 12,5% de un monitor de 1920 — comprar ese wayfinding permanente
 * es exactamente el criterio nº1 del brief ("retomar el hilo después de una
 * interrupción sin volver a leer la pantalla entera"). Por debajo de `lg` la
 * escena es el celular en la mano: ahí una sidebar (angosta o ancha) no
 * corresponde, así que se mantiene el riel horizontal de chips tal cual —
 * ya está bien resuelto para el pulgar.
 */
const NAV_ITEMS = [
  { href: '/admin', label: 'Cocina', icon: ChefHat, ownerOnly: false },
  { href: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, ownerOnly: false },
  { href: '/admin/catalogo', label: 'Catálogo', icon: UtensilsCrossed, ownerOnly: false },
  { href: '/admin/dashboard', label: 'Métricas', icon: BarChart3, ownerOnly: false },
  { href: '/admin/apariencia', label: 'Apariencia', icon: Palette, ownerOnly: false },
  // Gestión de repartidores: alta, baja y reenvío de invitación tocan a quién
  // le entra plata y quién queda como responsable de una entrega, así que es
  // del dueño — mismo criterio que Pagos.
  { href: '/admin/repartidores', label: 'Repartidores', icon: Bike, ownerOnly: true },
  { href: '/admin/pagos', label: 'Pagos', icon: CreditCard, ownerOnly: false },
  { href: '/admin/ajustes', label: 'Ajustes', icon: Settings, ownerOnly: false },
] as const

function isNavActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
}

/** Compartido por el header mobile, el rail y el chasis sin tienda: una sola acción de salir. */
function useSignOut() {
  const router = useRouter()
  return async () => {
    await signOutAction()
    router.replace('/admin/acceso')
    router.refresh()
  }
}

function SuspendedNotice({ className }: { className?: string }) {
  return (
    <div role="status" className={cn('bg-destructive/10 text-destructive flex items-start gap-2', className)}>
      <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="text-sm font-medium">
        Este local está suspendido por la plataforma: los clientes no pueden verlo ni pedir hasta que se
        reactive.
      </span>
    </div>
  )
}

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
  const signOut = useSignOut()
  // Repartidores es de gestión de dueño (ver comentario en NAV_ITEMS): un
  // encargado ni siquiera ve el ítem, no alcanza con que la page lo redirija.
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.ownerOnly || role === 'owner')

  return (
    /*
      El chasis del panel es una ventana fija, no un documento largo.
      `h-dvh` + `overflow-hidden` en TODOS los tamaños, no solo en `lg`: el
      documento entero deja de scrollear, y la única región que scrollea en
      todo `/admin` es `<main>`. Eso es lo que elimina el "doble scroll" de
      raíz en vez de perseguirlo página por página — antes, abajo de `lg` el
      documento scrolleaba (2892px de alto en Ajustes) y encima de eso cada
      sección podía abrir su propio contenedor, así que había dos superficies
      de scroll compitiendo y ninguna era dueña de la página.

      Consecuencias que hay que respetar al tocar esto:
      - El header y el rail son PANELES, no contenido pegajoso: quedan fuera
        del contenedor que scrollea, así que ya no necesitan `sticky` ni z-index
        alto para sobrevivir al scroll, y `--admin-header-h` vale 0 (globals.css).
      - `min-h-0` en `<main>` no es decorativo: un hijo `flex-1` de un flex
        column NO puede achicarse abajo de su contenido sin eso, así que sin
        `min-h-0` el `overflow-y-auto` nunca llega a activarse y el chasis se
        estira igual que antes.
    */
    <div className="flex h-dvh w-full flex-col overflow-hidden lg:flex-row">
      <header className="border-border bg-card shrink-0 border-b lg:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{storeName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {role === 'owner' ? 'Dueño' : 'Encargado'} · {email}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
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
          {visibleNavItems.map((item) => {
            const active = isNavActive(pathname, item.href)
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
        {/* Adentro del `<header>` a propósito: en mobile el aviso es parte
            del chrome de arriba, no del área de trabajo, así que tiene que
            quedarse fijo con él en vez de scrollear con el contenido. */}
        {storeStatus === 'suspended' ? (
          <SuspendedNotice className="border-destructive/20 border-t px-4 py-2.5 sm:px-6" />
        ) : null}
      </header>

      {/* Rail de escritorio: al costado, nunca arriba de `<main>`. Por eso el
          aviso de suspensión vive acá adentro y no como franja horizontal
          sobre el área de trabajo. */}
      <aside className="border-border bg-card hidden min-h-0 shrink-0 flex-col border-r lg:flex lg:w-(--admin-rail)">
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
          <div className="mb-3 min-w-0">
            <p className="text-foreground truncate text-base font-semibold">{storeName}</p>
            <p className="text-muted-foreground truncate text-sm">
              {role === 'owner' ? 'Dueño' : 'Encargado'} · {email}
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium">
              <span
                className={cn('size-1.5 shrink-0 rounded-full', storeStatus === 'active' ? 'bg-primary' : 'bg-destructive')}
                aria-hidden
              />
              <span className={storeStatus === 'active' ? 'text-muted-foreground' : 'text-destructive'}>
                {storeStatus === 'active' ? 'Activo' : 'Suspendido'}
              </span>
            </p>
          </div>

          {storeStatus === 'suspended' ? (
            <SuspendedNotice className="mb-3 rounded-lg px-3 py-2.5" />
          ) : null}

          <nav aria-label="Secciones del panel" className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const active = isNavActive(pathname, item.href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="border-border border-t p-3">
          <button
            type="button"
            onClick={signOut}
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors focus-visible:ring-3 focus-visible:outline-none"
          >
            <LogOut className="size-5" />
            Salir
          </button>
        </div>
      </aside>

      {/*
        La ÚNICA región que scrollea en todo `/admin`, en todos los tamaños.
        Sin padding ni ancho: eso es de `PageFrame`.

        `overflow-x: hidden` es un guardarraíl deliberado, no un tapón: por la
        regla de acoplamiento de CSS, declarar `overflow-y: auto` ya volvía
        `overflow-x` implícito `auto`, así que cualquier hijo un pixel más
        ancho que su columna sacaba una segunda barra —horizontal— al lado de
        la vertical. Eso es la mitad de los "dos scrolls" reportados. El
        contenido ancho de verdad (la tabla del historial) tiene y tiene que
        seguir teniendo SU propio `overflow-x-auto`; el área de trabajo nunca
        scrollea de costado.
      */}
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
    </div>
  )
}

/**
 * Chasis mínimo para los dos estados sin tienda que mostrar: sin local
 * asignado y error del panel. Sin las siete secciones (ninguna tiene sentido
 * sin un store resuelto), pero con la misma salida y la misma geometría del
 * resto de `/admin` — nada flota suelto con estilos inventados de una vez.
 */
export function AdminBareChrome({ children }: { children: React.ReactNode }) {
  const signOut = useSignOut()
  return (
    // Misma geometría que `AdminShell`: ventana fija, chrome fuera del scroll.
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <header className="border-border bg-card flex shrink-0 items-center justify-end border-b px-(--admin-gutter) py-2 lg:px-(--admin-gutter-lg)">
        <button
          type="button"
          onClick={signOut}
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:outline-none"
        >
          <LogOut className="size-4" />
          Salir
        </button>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-x-hidden overflow-y-auto px-(--admin-gutter) py-10 lg:px-(--admin-gutter-lg)">
        {children}
      </main>
    </div>
  )
}
