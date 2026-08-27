/**
 * No es el foco de este slice: cada local vive en /[store]. Esta raíz no
 * tiene un directorio de tiendas que ofrecer, así que es una landing mínima
 * y neutra —sin el tema de ningún local— que solo explica cómo llegar.
 */
export default function RootPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-24 text-center">
      <p className="text-foreground text-xl font-semibold tracking-tight">Pedidos</p>
      <p className="text-muted-foreground max-w-[40ch] text-sm">
        Pedí, pagá y seguí tu pedido sin escribirle a nadie. Buscá el link de tu local para empezar.
      </p>
    </div>
  )
}
