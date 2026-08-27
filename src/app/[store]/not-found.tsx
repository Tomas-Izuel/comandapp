import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'

/**
 * Sin esto, un slug inexistente mostraba el 404 default de Next —en inglés,
 * sin el tema de la tienda (F-02)—, rompiendo "el cliente está en la web de
 * la hamburguesería" (PRODUCT.md). Se dispara desde `requireStore` (el
 * layout y `getStorefront` llaman `notFound()` cuando `getStoreBySlug`
 * devuelve `null`), así que vive al lado de `layout.tsx` para capturarlo.
 */
export default function StoreNotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <EmptyState
        className="flex-1"
        title="No encontramos este local"
        description="Revisá el link — puede tener un error, o el local ya no está disponible."
        action={
          <Button asChild size="lg" className="h-11">
            <Link href="/mis-pedidos">Ver mis pedidos</Link>
          </Button>
        }
      />
    </div>
  )
}
