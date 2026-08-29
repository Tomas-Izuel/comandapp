import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Barridos de fuente de "subdominio por local" (T5/T6, `01-tasks.md`).
 * Ninguno de los dos necesita Postgres ni un mock: son la red que atrapa un
 * call site que alguien se olvidó de migrar — el tipo de regresión que un
 * test unitario de una función aislada no puede ver, porque el bug está en
 * OTRO archivo que dejó de llamarla.
 */

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, exts))
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

const SRC_ROOT = path.join(process.cwd(), 'src')

describe('barrido — NEXT_PUBLIC_SITE_URL solo se lee en src/lib/urls.ts (y los dos schemas de env)', () => {
  const ALLOWED_FILES = new Set(
    ['src/lib/urls.ts', 'src/lib/env.server.ts', 'src/lib/env.client.ts'].map((p) => path.join(process.cwd(), p)),
  )

  it('ningún otro archivo de src/ referencia NEXT_PUBLIC_SITE_URL en CÓDIGO vivo (comentarios documentando la variable están bien)', () => {
    const offenders: string[] = []

    for (const file of walk(SRC_ROOT, ['.ts', '.tsx'])) {
      if (ALLOWED_FILES.has(file)) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!line.includes('NEXT_PUBLIC_SITE_URL')) return
        const trimmed = line.trim()
        // Comentario de línea o dentro de un bloque /** ... */ que documenta
        // la variable: no es un call site real. Cualquier otra forma (un
        // `serverEnv().NEXT_PUBLIC_SITE_URL`, una interpolación) sí lo es.
        const isCommentOnly = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')
        if (!isCommentOnly) {
          offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${trimmed}`)
        }
      })
    }

    expect(offenders, `Call sites de NEXT_PUBLIC_SITE_URL fuera de src/lib/urls.ts:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('barrido — ningún href de la vitrina interpola el slug a mano (T6)', () => {
  const SCAN_DIRS = [path.join(SRC_ROOT, 'views', 'storefront'), path.join(SRC_ROOT, 'app', '[store]')]
  // El patrón prohibido: una template string que arma `/${algo}` donde "algo"
  // contiene "slug" — es la forma que tenían los 10 href antes de T6
  // (`` `/${store.slug}/carrito` ``, `` `/${storeSlug}` ``, etc).
  const FORBIDDEN = /`\/\$\{[^}]*[Ss]lug[^}]*\}/

  it('ningún archivo vivo de views/storefront/** o app/[store]/** arma un href con `/${...slug...}` a mano', () => {
    const offenders: string[] = []

    for (const dir of SCAN_DIRS) {
      for (const file of walk(dir, ['.ts', '.tsx'])) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, i) => {
          const trimmed = line.trim()
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return // comentario explicando el patrón prohibido, no código
          if (FORBIDDEN.test(line)) {
            offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${trimmed}`)
          }
        })
      }
    }

    expect(offenders, `hrefs con el slug interpolado a mano:\n${offenders.join('\n')}`).toEqual([])
  })
})
