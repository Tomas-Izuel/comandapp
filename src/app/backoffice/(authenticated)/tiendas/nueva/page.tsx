import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireBackofficeSession } from '@/controllers/platform.controller'
import { Panel } from '@/views/shared/surfaces'
import { StoreCreateForm } from '@/views/backoffice/store-create-form'

export const metadata: Metadata = { title: 'Nueva tienda — Backoffice' }

export default async function BackofficeNewStorePage() {
  // Esta page no lee nada, así que no tira — pero sin el guard un usuario en
  // `aal1` alcanza a renderizar el formulario de alta antes de que el redirect
  // del layout gane la carrera. El alta en sí ya está protegida en el server
  // action; esto es para que las cinco pages del backoffice se guarden igual y
  // no haya que recordar cuál era la excepción.
  await requireBackofficeSession()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/backoffice/tiendas"
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Tiendas
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Nueva tienda</h1>
      </div>

      <Panel className="max-w-2xl p-6">
        <StoreCreateForm />
      </Panel>
    </div>
  )
}
