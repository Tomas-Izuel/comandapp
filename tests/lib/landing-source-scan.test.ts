import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PRICING } from '@/lib/landing'

/**
 * Invariantes de `00-architecture.md`/`src/app/layout.tsx` (ronda 3, "el hero
 * es la demo") que se rompen SOLAS en el próximo cambio, porque nada en
 * TypeScript las hace explotar:
 *
 * 1. "Estático de verdad" ya no significa "cero JS de cliente": esta ronda
 *    reemplazó la única excepción de la ronda anterior (`split-text.tsx`, GSAP
 *    en el H1) por OCHO islas cliente, una por demo (`01-tasks.md`). La
 *    allowlist tiene que ser esa lista exacta — ni un archivo de más (motion
 *    genérico coincidiendo en `views/landing/**`) ni uno de menos (una demo
 *    que se olvidó de declarar `'use client'` y en producción explota con
 *    "useState is not a function" apenas Next intenta usar un hook de
 *    servidor).
 * 2. GSAP se fue del todo: nada en `src/` ni en `package.json` puede seguir
 *    nombrando el paquete. Si algo lo reimporta, la ruta deja de ser
 *    estática de verdad (motion de terceros compitiendo con la escena del
 *    hero, que es la única animación autorizada del primer viewport).
 * 3. La deuda declarada de `PRICING.IVA_DISCLOSED = false`: mientras esté en
 *    `false`, la página no puede afirmar NI negar el IVA. Se prueba
 *    RENDERIZANDO los componentes reales (no grepeando el código fuente),
 *    porque la implementación correcta de esta regla es un condicional en
 *    JSX que contiene la palabra "IVA" en la fuente sin que aparezca nunca en
 *    la salida — un grep de texto la marcaría como infractora por error.
 * 4. La gramática de motion (`00-architecture.md` § "Gramática de motion",
 *    punto 7): los keyframes que solo el JS puede agregar
 *    (`landing-msg-in`/`landing-row-in`/`landing-num-in`) no pueden aparecer
 *    en el HTML que sirve el servidor de NINGÚN componente — ni siquiera de
 *    las islas cliente, cuyo primer render (SSR y primer paint antes de
 *    hidratar) tiene que ser un estado sin animar. Las tres demos numéricas
 *    (`eta-demo.tsx`, `delivery-quote.tsx`, `pricing-calculator.tsx`) gatean
 *    `landing-num-in` con `hasChanged` (ronda de correcciones sobre
 *    `03-tests.md`/`03-review.md`, slices D y E) exactamente con el mismo
 *    criterio que `landing-msg-in`/`landing-row-in`, así que el barrido las
 *    trata como una sola familia.
 */

const LANDING_DIR = path.join(process.cwd(), 'src/views/landing')

/**
 * Las ocho islas cliente de la ronda "la página es la demo" (`01-tasks.md`).
 * Lista cerrada a propósito: un noveno archivo con `'use client'` tiene que
 * seguir haciendo fallar el barrido de abajo, así declare la directiva por
 * las razones que sea.
 */
const ALLOWED_CLIENT_FILES = [
  'landing-bar-progress.tsx',
  'hero-flow.tsx',
  'versus-race.tsx',
  'order-journey.tsx',
  'eta-demo.tsx',
  'events-demo.tsx',
  'delivery-quote.tsx',
  'pricing-calculator.tsx',
].map((f) => path.join(LANDING_DIR, f))

function landingFiles(): string[] {
  return readdirSync(LANDING_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => path.join(LANDING_DIR, f))
}

const USE_CLIENT_DIRECTIVE = /^(['"])use client\1;?$/

function hasUseClientDirective(file: string): boolean {
  return readFileSync(file, 'utf8')
    .split('\n')
    .some((line) => USE_CLIENT_DIRECTIVE.test(line.trim()))
}

describe('barrido — la landing tiene EXACTAMENTE ocho islas cliente, una por demo (src/app/layout.tsx § LANDING)', () => {
  it('la allowlist apunta a archivos reales que de verdad llevan \'use client\'', () => {
    // Sin este chequeo, borrar o renombrar una de las ocho no rompe nada del
    // barrido de abajo (que solo mira "nada FUERA de la lista"), y la
    // excepción quedaría documentada en un test que ya no prueba lo que dice
    // probar.
    for (const file of ALLOWED_CLIENT_FILES) {
      const relative = path.relative(process.cwd(), file)
      expect(existsSync(file), `${relative} no existe: la allowlist quedó apuntando a la nada`).toBe(true)
      expect(
        hasUseClientDirective(file),
        `${relative} ya no lleva 'use client': ¿dejó de ser una isla cliente? Sacalo de la allowlist`,
      ).toBe(true)
    }
  })

  it('ningún archivo FUERA de la allowlist lleva la directiva \'use client\'', () => {
    const offenders: string[] = []

    for (const file of landingFiles()) {
      if (ALLOWED_CLIENT_FILES.includes(file)) continue
      if (hasUseClientDirective(file)) offenders.push(path.relative(process.cwd(), file))
    }

    expect(
      offenders,
      `Archivos con 'use client' fuera de la allowlist de ocho islas:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('faq.tsx explícitamente NO es una isla cliente: el acordeón es <details> nativo, sin una línea de JS', () => {
    const faqFile = path.join(LANDING_DIR, 'faq.tsx')
    expect(existsSync(faqFile)).toBe(true)
    expect(hasUseClientDirective(faqFile)).toBe(false)
  })
})

describe('la landing no arrastra GSAP: se fue entero con el hero viejo (split-text.tsx, hero-ticket.tsx)', () => {
  function walkSourceFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...walkSourceFiles(full))
      } else if (/\.(tsx?|css|json)$/.test(entry.name)) {
        files.push(full)
      }
    }
    return files
  }

  it('ningún archivo de src/ menciona "gsap" (case-sensitive: es el nombre real del import, no un comentario que lo nombre en mayúsculas al explicar por qué se fue)', () => {
    const srcDir = path.join(process.cwd(), 'src')
    const offenders: string[] = []

    for (const file of walkSourceFiles(srcDir)) {
      const content = readFileSync(file, 'utf8')
      if (content.includes('gsap')) offenders.push(path.relative(process.cwd(), file))
    }

    expect(offenders, `Archivos que todavía nombran "gsap":\n${offenders.join('\n')}`).toEqual([])
  })

  it('package.json no lista gsap ni @gsap/react como dependencia', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    const gsapDeps = Object.keys(allDeps).filter((name) => name.includes('gsap'))

    expect(gsapDeps, `package.json todavía lista: ${gsapDeps.join(', ')}`).toEqual([])
  })
})

describe('el H1 del hero se sirve en el HTML del servidor, ESTÁTICO (ronda 3: sin GSAP, sin opacity-0 de arranque)', () => {
  it('LandingHero renderiza el texto real del titular en el markup — es texto plano desde el primer byte', async () => {
    const { LandingHero } = await import('@/views/landing/hero')
    const html = renderToStaticMarkup(React.createElement(LandingHero))

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
    expect(h1Match, `No se encontró un <h1> en el HTML de LandingHero:\n${html}`).not.toBeNull()

    const text = h1Match![1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    // Literal a propósito: lo que este test prueba es la INVARIANTE de SEO
    // (el texto real está en el HTML servido por el servidor), no el copy en
    // sí. Si el titular cambia de redacción, actualizá este literal — no
    // aflojes el test a "no vacío".
    expect(text).toBe('Vendé online sin que nadie escriba un WhatsApp.')
  })

  it('el <h1> NO depende de JS para verse: ninguna clase de ocultamiento (opacity-0) en su tag de apertura', async () => {
    const { LandingHero } = await import('@/views/landing/hero')
    const html = renderToStaticMarkup(React.createElement(LandingHero))

    const h1OpenTag = html.match(/<h1[^>]*>/)
    expect(h1OpenTag, `No se encontró un <h1> en el HTML de LandingHero:\n${html}`).not.toBeNull()

    // La ronda anterior arrancaba el H1 en `opacity-0` a la espera de GSAP
    // SplitText, y la inspección real lo encontró a medio camino ("Ve"). El
    // titular de esta ronda es texto ESTÁTICO: si algún día alguien reintenta
    // una entrada animada, este chequeo tiene que fallar antes de que vuelva
    // a salir un H1 invisible al primer paint.
    expect(h1OpenTag![0]).not.toMatch(/\bopacity-0\b/)
  })
})

/**
 * Encuentra los componentes de presentación exportados por cada archivo de la
 * landing: funciones exportadas, sin argumentos requeridos, con nombre en
 * PascalCase (la convención de todo el slice — ver `01-tasks.md`, todas las
 * firmas son `export function Algo()`). Filtra de paso cosas como
 * `FAQ_ITEMS` (no es función) sin tener que listar los componentes a mano, así
 * que un componente nuevo entra solo a este barrido.
 *
 * A diferencia de la ronda anterior, esta vez NO se excluye a las islas
 * cliente: ninguna usa GSAP ni depende de un DOM real para su primer render
 * (`useSyncExternalStore` con snapshot de servidor, `matchMedia` solo dentro
 * de efectos o detrás de un guard de `typeof window`), así que si alguna
 * rompe al renderizar en Node esto tiene que fallar acá — es exactamente el
 * bug que "estático de verdad" existe para atrapar. `OrderJourneyClient`
 * queda afuera solo porque exige props (`stations`), no por ser cliente.
 */
async function loadLandingComponents(): Promise<{ file: string; name: string; render: () => string }[]> {
  const components: { file: string; name: string; render: () => string }[] = []

  for (const file of landingFiles()) {
    const specifier = `@/views/landing/${path.basename(file).replace(/\.tsx?$/, '')}`
    const mod: Record<string, unknown> = await import(specifier)

    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function' && value.length === 0 && /^[A-Z]/.test(name)) {
        const Component = value as () => React.ReactElement
        components.push({
          file: path.relative(process.cwd(), file),
          name,
          render: () => renderToStaticMarkup(React.createElement(Component)),
        })
      }
    }
  }

  return components
}

describe('barrido — PRICING.IVA_DISCLOSED en false: la página no afirma ni niega el IVA (deuda declarada)', () => {
  it.runIf(PRICING.IVA_DISCLOSED === false)(
    'el HTML renderizado de NINGÚN componente de src/views/landing/** menciona "IVA"',
    async () => {
      const components = await loadLandingComponents()
      expect(components.length).toBeGreaterThan(0) // que el barrido no se quedó sin nada que mirar

      const offenders: string[] = []
      for (const { file, name, render } of components) {
        const html = render()
        if (/\bIVA\b/i.test(html)) offenders.push(`${file} → ${name}`)
      }

      expect(offenders, `Componentes que renderizan "IVA" mientras IVA_DISCLOSED es false:\n${offenders.join('\n')}`).toEqual(
        [],
      )
    },
  )

  // Si `IVA_DISCLOSED` pasa a `true`, `it.runIf` arriba se salta solo (queda
  // "skipped" en el resumen de vitest, nunca "passed en silencio"): es la
  // señal de que este barrido hay que invertirlo para EXIGIR la mención en
  // vez de seguir prohibiéndola, no borrarlo.
})

describe('barrido — motion: landing-msg-in / landing-row-in / landing-num-in nunca en el HTML SERVIDO (00-architecture.md § Gramática de motion, punto 7)', () => {
  it('el HTML del primer render (SSR) de NINGÚN componente lleva las clases que solo el JS agrega durante una escena', async () => {
    const components = await loadLandingComponents()
    expect(components.length).toBeGreaterThan(0)

    const MOTION_CLASSES = ['landing-msg-in', 'landing-row-in', 'landing-num-in']
    const offenders: string[] = []
    for (const { file, name, render } of components) {
      const html = render()
      const found = MOTION_CLASSES.filter((cls) => html.includes(cls))
      if (found.length > 0) offenders.push(`${file} → ${name} (${found.join(', ')})`)
    }

    expect(
      offenders,
      `Componentes cuyo HTML servido ya lleva alguna de landing-msg-in/landing-row-in/landing-num-in ` +
        `(deberían aparecer recién cuando el JS las agrega, gateadas por hasPlayed/hasChanged):\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
