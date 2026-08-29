'use client'

import * as React from 'react'

/**
 * Prefijo de host resuelto por `/[store]/layout.tsx` (Server Component, con
 * `storeBasePath()` de `@/lib/urls` sobre el header `Host`) y bajado como
 * prop — ninguna Client Component puede leer `Host` por su cuenta (T4). El
 * valor es `''` cuando el request ya llegó por el subdominio de ESTA tienda
 * (el rewrite de `next.config.ts` ya puso al usuario en el árbol correcto) o
 * `` `/${slug}` `` en cualquier otro caso (apex, local, preview, u otra tienda).
 *
 * `null` como default distingue "todavía no se proveyó" de "prefijo vacío a
 * propósito": las dos son strings válidos (`''`), así que un booleano o un
 * string vacío como sentinela hubiera escondido el error de árbol en vez de
 * tirarlo (`useStoreBasePath`, más abajo).
 */
const StoreBasePathContext = React.createContext<string | null>(null)

export function StoreBasePathProvider({ basePath, children }: { basePath: string; children: React.ReactNode }) {
  return <StoreBasePathContext.Provider value={basePath}>{children}</StoreBasePathContext.Provider>
}

/**
 * Lee el basePath ya resuelto. Tira si se llama afuera del árbol de
 * `/[store]` (sin `<StoreBasePathProvider>` arriba) — mejor un error de
 * desarrollo temprano y explícito que un `<Link>` roto en producción que
 * nadie nota hasta que un cliente lo reporta.
 */
export function useStoreBasePath(): string {
  const basePath = React.useContext(StoreBasePathContext)
  if (basePath === null) {
    throw new Error(
      'useStoreBasePath: no hay <StoreBasePathProvider> en el árbol. ¿Este componente se está usando fuera de /[store]?',
    )
  }
  return basePath
}

/**
 * Arma un `href` interno de la vitrina a partir del basePath ya resuelto.
 * Nadie compone `` `/${slug}${path}` `` a mano — eso es exactamente lo que
 * rompe en un subdominio (ver `00-architecture.md` §2.1): con `basePath` ya
 * resuelto, este helper es la ÚNICA forma de construir el link y funciona
 * igual en los dos modos de host.
 *
 * La ruta de inicio (`'/'` o `''`) es un caso especial: con `basePath`
 * vacío (subdominio propio) el home ES la raíz (`/`), nunca la cadena vacía
 * — un `<Link href="">` navega a la URL actual, no a la carta.
 */
export function storeHref(basePath: string, path: string): string {
  if (path === '' || path === '/') return basePath || '/'
  return `${basePath}${path}`
}
