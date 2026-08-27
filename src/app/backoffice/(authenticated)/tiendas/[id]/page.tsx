import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getPlatformStoreById } from '@/models/platform.model'
import { StoreDetail } from '@/views/backoffice/store-detail'

export async function generateMetadata(props: PageProps<'/backoffice/tiendas/[id]'>): Promise<Metadata> {
  const { id } = await props.params
  const store = await getPlatformStoreById(Number(id))
  return { title: store ? `${store.name} — Backoffice` : 'Tienda — Backoffice' }
}

export default async function BackofficeStoreDetailPage(props: PageProps<'/backoffice/tiendas/[id]'>) {
  const { id } = await props.params
  const storeId = Number(id)
  if (!Number.isInteger(storeId)) notFound()

  const store = await getPlatformStoreById(storeId)
  if (!store) notFound()

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
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{store.name}</h1>
          <p className="text-muted-foreground font-mono text-xs">/{store.slug}</p>
        </div>
      </div>

      <StoreDetail store={store} />
    </div>
  )
}
