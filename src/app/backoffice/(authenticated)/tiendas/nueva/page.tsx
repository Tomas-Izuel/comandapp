import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Panel } from '@/views/shared/surfaces'
import { StoreCreateForm } from '@/views/backoffice/store-create-form'

export const metadata: Metadata = { title: 'Nueva tienda — Backoffice' }

export default function BackofficeNewStorePage() {
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
