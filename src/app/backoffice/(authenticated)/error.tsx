'use client'

import { useEffect } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'

/** Mismo motivo que `/admin/(app)/error.tsx`: nunca el "Application error" en inglés. */
export default function BackofficeError({
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
    <EmptyState
      title="Algo falló en el backoffice"
      description={
        error.digest
          ? `Reintentá en un momento. Si sigue pasando, pasá este código: ${error.digest}`
          : 'Reintentá en un momento. Si sigue pasando, revisá los logs del servidor.'
      }
      action={
        <Button size="lg" onClick={retry}>
          <RotateCw aria-hidden="true" />
          Reintentar
        </Button>
      }
    />
  )
}
