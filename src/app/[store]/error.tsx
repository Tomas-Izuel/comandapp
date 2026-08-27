'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'

/**
 * Sin esto, una excepción de Supabase mostraba el "Application error" de
 * Next: en inglés y sin el tema de la tienda (F-02). El log estructurado del
 * lado servidor ya corrió antes de que este boundary se monte; acá solo se
 * deja rastro en la consola del cliente para poder correlacionar con el
 * `digest` si hace falta.
 */
export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col">
      <EmptyState
        className="flex-1"
        title="Algo salió mal"
        description="No pudimos cargar esto. Probá de nuevo en un momento."
        action={
          <Button type="button" size="lg" className="h-11" onClick={reset}>
            Reintentar
          </Button>
        }
      />
    </div>
  )
}
