"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * `next-themes` salió del proyecto (F-14, decisión de producto): leía
 * `useTheme()` sin ningún `ThemeProvider` montado, así que `theme` daba
 * siempre "system" — un toast que sigue el modo oscuro del OS del cliente en
 * vez del tema del local, y JS de más para devolver `undefined`.
 *
 * Acá no hay tema ambiente: el que monta este componente decide. Sin `theme`
 * explícito cae a "light", que es lo correcto para el único caller de hoy (el
 * fallback neutro de `app/layout.tsx`, fuera de cualquier marca de tienda).
 */
const Toaster = ({ theme = "light", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
