import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'

/**
 * 404 raíz (F-02). Sin este archivo, un slug de tienda inexistente o
 * cualquier ruta rota fuera de un local mostraba el 404 default de Next: en
 * inglés y sin el sistema de la etiqueta. Vive fuera de cualquier
 * [data-store-theme] a propósito — como la landing raíz, es neutro.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <EmptyState
        title="No encontramos esta página"
        description="El link puede estar mal escrito o la página ya no existe. Volvé al inicio para buscar el link de tu local."
        action={
          <Button asChild size="lg">
            <Link href="/">Ir al inicio</Link>
          </Button>
        }
      />
    </div>
  )
}
