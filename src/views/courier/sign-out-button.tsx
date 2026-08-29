'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { courierSignOutAction } from '@/controllers/courier.actions'

/**
 * Un solo botón de salir, sin menú ni confirmación: en este portal cada
 * pantalla es una sola decisión, y "salir" no es distinta.
 */
export function SignOutButton() {
  const router = useRouter()

  async function handleClick() {
    await courierSignOutAction()
    router.replace('/repartidor/acceso')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 flex h-14 shrink-0 items-center gap-2 rounded-lg px-4 text-base font-medium transition-colors focus-visible:ring-3 focus-visible:outline-none"
    >
      <LogOut className="size-5" aria-hidden />
      Salir
    </button>
  )
}
