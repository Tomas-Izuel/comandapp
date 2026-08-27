import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Los tests corren en Node, no en jsdom: lo que hay que cubrir es el servidor
 * —precio del carrito, máquina de estados, firma del webhook, invariantes de
 * Postgres—, no el DOM. Si algún día hace falta testear un componente, se agrega
 * un `environmentMatchGlobs` para esos archivos y nada más.
 *
 * `vite-tsconfig-paths` hace que el alias `@/` funcione igual que en Next, así
 * que un test importa exactamente lo mismo que importa la app.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` tira al importarse fuera de un entorno de servidor de
      // React, así que sin este alias vitest no puede cargar ni un modelo. La
      // garantía real la sigue aplicando `next build`, que es donde importa.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Los tests que hablan con Postgres comparten una sola base local: si
    // corren en paralelo se pisan las filas entre ellos.
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
  },
})
