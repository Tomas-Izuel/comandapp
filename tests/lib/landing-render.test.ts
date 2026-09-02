import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEMO_SCENE_CAPTION, HERO_FLOW, HERO_ORDER, SCREENSHOT_CAPTION, SECTIONS } from '@/lib/landing'
import { LandingHero } from '@/views/landing/hero'
import { TodayVersus } from '@/views/landing/versus'
import { OrderJourney } from '@/views/landing/screens'
import { WhatOnlyComandApp } from '@/views/landing/edge'
import { DeliverySection } from '@/views/landing/delivery'
import { WhatsIncluded } from '@/views/landing/included'
import { Pricing } from '@/views/landing/pricing'
import { Faq } from '@/views/landing/faq'

/**
 * Renderizado estático de las secciones reales (`renderToStaticMarkup`,
 * mismo mecanismo que usa `landing-source-scan.test.ts`): no jsdom, no
 * navegador — lo que importa es lo que Next sirve ANTES de que hidrate un
 * solo componente cliente, porque esa es la promesa de `00-architecture.md`:
 * "el HTML servido es el estado final" y "sin JS el flujo se ve".
 *
 * Si algún Client Component de `src/views/landing/**` rompiera acá (por
 * llamar `window`/`document`/`matchMedia` de forma síncrona en el cuerpo del
 * render, en vez de detrás de un efecto o un `useSyncExternalStore` con
 * snapshot de servidor), esta suite entera fallaría con un stack trace que
 * apunta al archivo culpable — eso ES la cobertura, no un efecto colateral.
 */

function renderSection(Component: () => React.ReactElement): string {
  return renderToStaticMarkup(React.createElement(Component))
}

/** Extrae el `<section ...>` de apertura que declara un `id` dado, sea cual sea el orden de sus atributos. */
function findSectionTag(html: string, id: string): string {
  const matches = html.match(/<section\b[^>]*>/g) ?? []
  const tag = matches.find((m) => m.includes(`id="${id}"`))
  if (!tag) {
    throw new Error(`No se encontró <section id="${id}"> en:\n${html}`)
  }
  return tag
}

describe('cada sección de SECTIONS es observable por la barra de progreso (id + data-scroll-anchor + data-landing-section)', () => {
  // Una función por id: así una sección que se rompe no oculta el resultado de las demás.
  const renderers: Record<string, () => React.ReactElement> = {
    'como-funciona': TodayVersus,
    recorrido: OrderJourney,
    diferencias: WhatOnlyComandApp,
    delivery: DeliverySection,
    incluido: WhatsIncluded,
    precio: Pricing,
    faq: Faq,
  }

  it('SECTIONS y los renderers de este test cubren exactamente los mismos ids (si agregás una sección a landing.ts, agregala acá)', () => {
    expect(Object.keys(renderers).sort()).toEqual(SECTIONS.map((s) => s.id).sort())
  })

  for (const section of SECTIONS) {
    it(`"${section.id}" (${section.label}) lleva id, data-scroll-anchor y data-landing-section en su <section> raíz`, () => {
      const render = renderers[section.id]
      const html = renderSection(render)
      const tag = findSectionTag(html, section.id)

      expect(tag).toContain('data-scroll-anchor')
      expect(tag).toContain('data-landing-section')
    })
  }
})

describe('DEMO_SCENE_CAPTION marca toda escena dramatizada (hero, la carrera, las pruebas)', () => {
  it('aparece en el hero (HeroFlow)', () => {
    expect(renderSection(LandingHero)).toContain(DEMO_SCENE_CAPTION)
  })

  it('aparece en "la carrera" (VersusRace, dentro de TodayVersus)', () => {
    expect(renderSection(TodayVersus)).toContain(DEMO_SCENE_CAPTION)
  })

  it('aparece en "las dos cosas que WhatsApp no puede dar" (EventsDemo, dentro de WhatOnlyComandApp)', () => {
    expect(renderSection(WhatOnlyComandApp)).toContain(DEMO_SCENE_CAPTION)
  })
})

describe('SCREENSHOT_CAPTION marca toda captura real', () => {
  it('aparece en el recorrido (OrderJourney) — al menos una vez por captura montada', () => {
    const html = renderSection(OrderJourney)
    expect(html).toContain(SCREENSHOT_CAPTION)
  })
})

/**
 * Ronda 4 ("el hero es un storyboard"): el criterio de aceptación cambió por
 * instrucción explícita del orquestador (ver `02-development-slice-f.md`,
 * sección "Correcciones", punto 1). Ya NO se exige que los 5 `title` de
 * `HERO_FLOW` aparezcan en el HTML servido — la región `aria-live` sigue
 * mostrando solo `HERO_FLOW[stepIndex].title`, y como el SSR arranca en
 * `stepIndex = LAST_STEP` (estado final, a propósito, para que el escenario
 * se sirva completo) eso es el título del ÚLTIMO paso nada más. Lo que SÍ
 * tiene que sobrevivir sin JS es el mapa de pasos: el `<ol>` dejó de ser
 * `aria-hidden` y ahora muestra el `short` de cada uno de los 5 SIEMPRE,
 * fuera de `stepIndex` — es la lectura del flujo completo para un visitante
 * sin JavaScript o un crawler.
 */
describe('el hero cuenta el flujo entero sin JS: el mapa de pasos (HERO_FLOW[].short) se lee completo en el HTML servido', () => {
  it('los cinco rótulos short de HERO_FLOW aparecen en el HTML de LandingHero', () => {
    const html = renderSection(LandingHero)
    const missing = HERO_FLOW.filter((step) => !html.includes(step.short)).map((step) => `${step.id} → "${step.short}"`)

    expect(
      missing,
      `HERO_FLOW tiene 5 pasos pero el HTML servido del hero no incluye el rótulo short de:\n${missing.join('\n')}\n\n` +
        `El <ol> del mapa de pasos itera HERO_FLOW y muestra flowStep.short para cada uno, sin depender de ` +
        `stepIndex — es la única lectura sin JS del storyboard entero.`,
    ).toEqual([])
  })

  it('el título del ÚLTIMO paso se lee en el HTML — el SSR sirve el cuadro final de la escena, no uno vacío', () => {
    const html = renderSection(LandingHero)
    const lastStep = HERO_FLOW[HERO_FLOW.length - 1]

    expect(
      html,
      `El HTML servido de LandingHero no incluye "${lastStep.title}" (el título del último paso, ` +
        `${lastStep.id}). HeroFlow arranca con stepIndex = LAST_STEP a propósito, así que sin JS el visitante ` +
        `tiene que leer al menos el título del cuadro con el que la escena queda servida.`,
    ).toContain(lastStep.title)
  })

  it('addressLine de HERO_ORDER se lee en el HTML servido — el cuadro "reparto" está siempre montado, aunque no sea el activo', () => {
    const html = renderSection(LandingHero)

    expect(
      html,
      `El HTML servido de LandingHero no incluye "${HERO_ORDER.addressLine}". Los cinco cuadros del storyboard ` +
        `están siempre montados (position: absolute, ordenados solo por transform/opacity), así que el texto del ` +
        `cuadro "reparto" tiene que estar presente en el HTML aunque otro cuadro sea el visualmente activo.`,
    ).toContain(HERO_ORDER.addressLine)
  })
})
