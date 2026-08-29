import { cn } from '@/lib/utils'

/**
 * El marco de TODA sección del panel. Es la pieza que faltaba.
 *
 * Antes, `<main>` era solo `flex-1` y cada página improvisaba su propio marco:
 * cuatro de siete no tenían padding (el texto pegado al borde del viewport),
 * los títulos iban `text-xl` en una y `text-2xl` en cinco, los anchos eran
 * `max-w-3xl` / `max-w-xl` / nada, y los `max-w-xl` iban sin `mx-auto`, o sea
 * una columna de 576px clavada contra el borde izquierdo de un monitor de
 * 1920. Siete páginas que parecían de siete personas distintas.
 *
 * Reglas que esta pieza fija de una vez:
 * - El padding es del marco, no de la página. Nadie más lo pone.
 * - El ancho se declara por INTENCIÓN (`board` / `table` / `form`), no en rem
 *   sueltos, y siempre centrado.
 * - El título es plano y chico. La vara del panel es Linear/Stripe, no la voz
 *   de marca del local: nada de `.display`, versalitas ni `tracking-tight`
 *   heroico. `/admin` comparte tokens y controles con la cara del cliente, no
 *   composición.
 * - Sin kicker/eyebrow arriba del título. Prohibido en todo el producto.
 */

type FrameWidth = 'board' | 'table' | 'form'

const WIDTH: Record<FrameWidth, string> = {
  board: 'max-w-(--admin-max-board)',
  table: 'max-w-(--admin-max-table)',
  form: 'max-w-(--admin-max-form)',
}

export function PageFrame({
  title,
  description,
  action,
  width = 'form',
  className,
  children,
  /**
   * El tablero de cocina monta su propia barra pegajosa a ancho completo y
   * necesita que el marco no le meta padding horizontal arriba de ella.
   * Es la única sección que lo usa.
   */
  bleed,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  width?: FrameWidth
  className?: string
  children: React.ReactNode
  bleed?: React.ReactNode
}) {
  return (
    <>
      {bleed}
      <div
        className={cn(
          'mx-auto w-full px-(--admin-gutter) py-6 lg:px-(--admin-gutter-lg) lg:py-8',
          WIDTH[width],
          className,
        )}
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-foreground text-xl font-semibold lg:text-2xl">{title}</h1>
            {description ? (
              <p className="text-muted-foreground mt-1.5 max-w-[65ch] text-sm">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
        {children}
      </div>
    </>
  )
}

/**
 * Encabezado de un bloque DENTRO de una sección.
 *
 * Existe porque el patrón ya estaba de facto —`text-lg font-semibold` en
 * ajustes, apariencia y métricas— pero sin componente, así que el margen de
 * abajo era `mb-3`, `mb-1` o nada según el archivo. No se llama
 * `SectionHeading` a propósito: esa es la de `views/shared/surfaces.tsx`, que
 * es la voz de la cara del cliente y no se hereda acá.
 */
export function PanelHeading({
  as: Tag = 'h2',
  title,
  description,
  action,
  className,
}: {
  as?: 'h2' | 'h3'
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <Tag className="text-foreground text-lg font-semibold">{title}</Tag>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
