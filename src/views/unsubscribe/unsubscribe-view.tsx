import { MailX } from 'lucide-react'
import { SiteFooter } from '@/views/shared/site-footer'
import { UnsubscribeButton } from '@/views/unsubscribe/unsubscribe-button'

/**
 * `/baja/[token]`, de nivel raíz y de la PLATAFORMA: nunca inyecta el tema de
 * ninguna tienda, igual que `/legal/*`. Es la única razón por la que este
 * componente no vive bajo `/[store]` ni recibe `store_branding`.
 *
 * `target === null` cubre TRES casos a propósito indistinguibles (§5.12.2):
 * token inexistente, token de una baja ya confirmada, y el balde
 * `unsubscribe:ip` agotado. Los tres son "no hay nada que hacer acá", y
 * mostrar el mismo texto genérico para los tres es lo que evita que este
 * endpoint público funcione como oráculo de qué tokens existen.
 *
 * Server Component puro: cero estado, cero fetch — el token ya se resolvió
 * en `page.tsx` y acá solo se decide qué prosa mostrar.
 */
export function UnsubscribeView({
  token,
  target,
}: {
  token: string
  target: { storeName: string } | null
}) {
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          {target ? (
            <UnsubscribeButton token={token} storeName={target.storeName} />
          ) : (
            <>
              <MailX className="text-muted-foreground size-10" aria-hidden />
              <h1 className="display text-2xl font-semibold text-balance">Nada pendiente en este link</h1>
              <p className="text-muted-foreground text-base text-balance">
                Este link no tiene ninguna baja para procesar: ya se usó, o no corresponde a ningún envío nuestro. No
                vas a recibir promociones por acá.
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
