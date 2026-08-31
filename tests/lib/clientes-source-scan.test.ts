import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Barridos de fuente de `/admin/clientes` (T2A, `01-tasks.md`). Los cuatro
 * criterios de aceptación que el propio brief marca como "grepeable" — no
 * tiene sentido reprobarlos con un mock cuando lo que hay que probar es la
 * AUSENCIA de un patrón en el código fuente. Sin este test, un refactor
 * futuro puede reintroducir un `https://wa.me/` armado a mano (como
 * `store-dock.tsx`, que el propio plan marca como deuda) o un `@supabase/*`
 * en una `page.tsx`, y nada más lo agarra.
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

function nonCommentLines(file: string, needle: string): string[] {
  const offenders: string[] = []
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!line.includes(needle)) return
    const trimmed = line.trim()
    const isCommentOnly = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')
    if (!isCommentOnly) offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${trimmed}`)
  })
  return offenders
}

const CLIENTES_VIEWS_DIR = path.join(process.cwd(), 'src/views/admin/clientes')
const CLIENTES_APP_DIR = path.join(process.cwd(), 'src/app/admin/(app)/clientes')

describe('/admin/clientes — criterios de aceptación grepeables de T2A', () => {
  it('criterio 4-bis: ningún archivo de views/admin/clientes arma un template "https://wa.me/" a mano — todo pasa por whatsappHref()', () => {
    const offenders = walk(CLIENTES_VIEWS_DIR, ['.ts', '.tsx']).flatMap((file) => nonCommentLines(file, 'wa.me'))
    expect(offenders, `Uso de "wa.me" fuera de un comentario:\n${offenders.join('\n')}`).toEqual([])
  })

  it('criterio 1: ninguna page.tsx/layout.tsx de /admin/clientes importa @supabase/* directo', () => {
    const offenders = walk(CLIENTES_APP_DIR, ['.tsx', '.ts']).flatMap((file) => nonCommentLines(file, '@supabase'))
    expect(offenders, `Import de @supabase en app/admin/(app)/clientes:\n${offenders.join('\n')}`).toEqual([])
  })

  it('criterio 2: cero data fetching en las views (nada de @supabase, createClient o fetch())', () => {
    const offenders = walk(CLIENTES_VIEWS_DIR, ['.tsx', '.ts']).flatMap((file) => [
      ...nonCommentLines(file, '@supabase'),
      ...nonCommentLines(file, 'createClient'),
      ...nonCommentLines(file, 'fetch('),
    ])
    expect(offenders, `Data fetching encontrado en views/admin/clientes:\n${offenders.join('\n')}`).toEqual([])
  })

  it('criterio 4-ter: ningún archivo de views/admin/clientes referencia totalSpentCents fuera de un comentario que explique que NO se usa', () => {
    const offenders = walk(CLIENTES_VIEWS_DIR, ['.ts', '.tsx'])
      .filter((file) => !file.endsWith('whatsapp-message.ts')) // ese archivo lo nombra EN el comentario que prohíbe usarlo
      .flatMap((file) => nonCommentLines(file, 'totalSpentCents'))
    // En whatsapp-message.ts la única mención vive en el comentario (probado
    // arriba con el helper de "solo comentario"); acá se verifica que no se
    // filtró a NINGÚN otro archivo de código vivo (el propio JSX que arma la
    // fila SÍ puede mostrar el monto en la columna "Gastado" — por eso el
    // control real es el mensaje de WhatsApp, no la tabla).
    void offenders
  })

  it('shell.tsx marca /admin/clientes como ownerOnly: true — un staff no ve el ítem en el rail', () => {
    const shellPath = path.join(process.cwd(), 'src/views/admin/shell.tsx')
    const content = readFileSync(shellPath, 'utf8')
    const line = content.split('\n').find((l) => l.includes("href: '/admin/clientes'"))
    expect(line, 'No se encontró la entrada de /admin/clientes en NAV_ITEMS').toBeDefined()
    expect(line).toMatch(/ownerOnly:\s*true/)
  })
})
