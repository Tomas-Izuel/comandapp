import { SignOutButton } from '@/views/courier/sign-out-button'

/**
 * El chrome entero del portal: el nombre de quien está logueado y la salida.
 * Nada de navegación lateral, nada de tabs — la tarjeta activa es el resto de
 * la pantalla completa, siempre.
 *
 * Server Component: la única parte interactiva (`SignOutButton`) se hunde
 * sola en su propio cliente.
 */
export function CourierChrome({
  courierName,
  email,
  children,
}: {
  /** `undefined` cuando la sesión existe pero no es (todavía, o ya no) repartidor de ningún local. */
  courierName?: string
  email: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border bg-card flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{courierName ?? 'Repartidor'}</p>
          <p className="text-muted-foreground truncate text-xs">{email}</p>
        </div>
        <SignOutButton />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}
