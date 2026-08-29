'use client'

import { useEffect } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'

/**
 * Sin esto, una excepción de Supabase (RLS, timeout, RPC caída) mostraba el
 * "Application error" genérico de Next: en inglés, sin tema, y sin salida.
 * El mensaje del servidor ya viene saneado en producción (Next solo reenvía
 * un id de rastreo, nunca el detalle interno), así que acá no hay nada que
 * ocultar — pero tampoco nada útil que mostrar más que "reintentar".
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    // `<main>` del chasis no pone padding ni ancho (eso es de `PageFrame`), así
    // que un estado que reemplaza a `{children}` tiene que traer su propia
    // geometría — si no, el mensaje queda pegado al borde del viewport.
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-(--admin-max-form) items-center justify-center px-(--admin-gutter) py-10 lg:px-(--admin-gutter-lg)">
      <EmptyState
        title="Algo falló en el panel"
        description={
          error.digest
            ? `Reintentá en un momento. Si sigue pasando, pasá este código: ${error.digest}`
            : 'Reintentá en un momento. Si sigue pasando, avisale a soporte.'
        }
        action={
          <Button size="lg" onClick={retry}>
            <RotateCw />
            Reintentar
          </Button>
        }
      />
    </div>
  )
}
