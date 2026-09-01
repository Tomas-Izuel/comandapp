'use client'

import { useState, useTransition } from 'react'
import { BellOff, CircleCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmUnsubscribeAction } from '@/controllers/unsubscribe.actions'

/**
 * El único tramo interactivo de `/baja/[token]`. Todo lo demás de la página
 * es prosa estática — esto es lo que dispara el `POST` de verdad.
 *
 * Llama a la Server Action directo (no al `route.ts` del mismo directorio):
 * ese `route.ts` existe para el `POST` automático de RFC 8058 que hacen los
 * propios clientes de mail (List-Unsubscribe-Post), sin JS de por medio. Acá
 * hay una persona tocando un botón, así que el camino normal de Server
 * Action alcanza y evita un viaje de red extra.
 *
 * Nada de `useActionState` con `<form action>`: no hay ningún dato de
 * formulario que mandar más que el token, que ya viene por prop.
 */
export function UnsubscribeButton({ token, storeName }: { token: string; storeName: string }) {
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await confirmUnsubscribeAction(token)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDone(true)
    })
  }

  if (done) {
    return (
      <>
        <CircleCheck className="text-primary size-10" aria-hidden />
        <h1 className="display text-2xl font-semibold text-balance">Listo, ya estás afuera</h1>
        <p className="text-muted-foreground text-base text-balance">
          No vas a recibir más promociones de <span className="text-foreground font-medium">{storeName}</span> por
          email. El seguimiento de tus pedidos y lo que el local te escriba por WhatsApp no cambian.
        </p>
      </>
    )
  }

  return (
    <>
      <BellOff className="text-muted-foreground size-10" aria-hidden />
      <h1 className="display text-2xl font-semibold text-balance">Darte de baja de {storeName}</h1>
      <p className="text-muted-foreground text-base text-balance">
        Vas a dejar de recibir promociones de {storeName} por email. No afecta el aviso de tus pedidos ni lo que el
        local te escriba por WhatsApp.
      </p>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        onClick={handleClick}
        disabled={pending}
        size="lg"
        className="mt-2 h-11 gap-2 px-6"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Darme de baja
      </Button>
    </>
  )
}
