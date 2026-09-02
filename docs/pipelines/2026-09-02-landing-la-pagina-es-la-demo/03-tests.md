# 03 — Tests (ronda 4, "el hero es un storyboard")

## Veredicto

**SUITE GREEN.**

Ronda 3 había quedado en rojo por un bug real de `hero-flow.tsx` (solo 1 de
4 títulos de `HERO_FLOW` se leía en el HTML servido). El dev agent (Slice F,
por instrucción explícita del orquestador) resolvió el hallazgo cambiando el
criterio de aceptación: el `<ol>` del mapa de pasos dejó de ser `aria-hidden`
y ahora muestra el `short` de cada paso SIEMPRE, sin depender de `stepIndex`;
la región `aria-live` sigue mostrando un solo `title` (el del paso actual).
Slice H reescribió además el hero entero como storyboard de 5 cuadros
(`pide`, `paga`, `cocina`, `listo`, `reparto`) con un pedido de delivery
nuevo, `HERO_ORDER` (#C64E).

Esta pasada actualizó las aserciones viejas para el contrato nuevo y agregó
la cobertura pedida sobre `HERO_ORDER`. No se debilitó ningún test viejo: se
reemplazó una aserción que probaba un criterio de aceptación que el propio
encargo cambió (documentado en `02-development-slice-f.md` § Correcciones),
y se sumó cobertura donde antes no existía.

---

## Qué cambié

### 1. `tests/lib/landing.test.ts`

- **`HERO_FLOW`**: el describe pasó de "4 pasos" a "5 pasos, storyboard".
  Nuevos/actualizados:
  - `tiene 5 pasos`.
  - horas de los 5 pasos (`pide → paga → cocina → listo → reparto`) no
    decrecientes (extendido de 4 a 5 elementos, mismo mecanismo de antes).
  - `los 5 ids son únicos`.
- **`HERO_ORDER`** (describe nuevo, el pedido de delivery #C64E que narra el
  storyboard):
  - `subtotalCents` es la suma real de `unitCents × quantity` de sus 3
    ítems (Doble Cheddar ×2, Papas Clásicas ×1, Coca-Cola ×2 → `2_860_000`).
  - `totalCents === subtotalCents + deliveryFeeCents` — el mismo CHECK que
    `orders_total_is_subtotal_plus_delivery_check` en Postgres
    (`2_860_000 + 180_000 = 3_040_000`, matchea el literal del guion).
  - `deliveryFeeCents === DELIVERY_DEMO.feeCents` — el envío del hero es el
    de la MISMA tienda de demostración que cotiza el resto de la página, no
    un número inventado aparte para esta escena.
  - el `timeline` (`confirmed → preparing → ready → on_the_way → delivered`)
    no retrocede, mismo mecanismo de minutos que ya usaba `DEMO_ORDER`.

### 2. `tests/lib/landing-render.test.ts`

Reemplacé el describe bloqueante de la ronda anterior
(`'el hero cuenta el flujo entero sin JS: los cuatro pasos de HERO_FLOW
tienen que leerse en el HTML servido'`, con la única aserción de "los 4
`title`") por uno que prueba el criterio nuevo:

- **Los 5 `short` de `HERO_FLOW`** (`Pide`, `Paga`, `Cocina`, `Listo`, `En
  camino`) aparecen en el HTML de `LandingHero` — el `<ol>` del mapa de
  pasos los itera sin depender de `stepIndex`, así que los 5 tienen que
  estar siempre, con o sin JS.
- **Al menos el `title` del ÚLTIMO paso** ("El repartidor del local lo
  lleva") se lee en el HTML — reemplaza la vieja aserción de "los 4
  títulos": el SSR arranca en `stepIndex = LAST_STEP` a propósito (el
  escenario se sirve completo, no vacío), así que la región `aria-live`
  muestra ese título nada más. Verificado que es efectivamente así (no un
  accidente de texto): el `title` es literal del último elemento de
  `HERO_FLOW`, no un string genérico.
- **`HERO_ORDER.addressLine`** ("Av. San Martín 1240, Mendoza") se lee en el
  HTML servido: los 5 cuadros del storyboard están siempre montados
  (`position: absolute`, ordenados solo por `transform`/`opacity`), así que
  el texto del cuadro "reparto" tiene que estar presente en el markup aunque
  otro cuadro sea el visualmente activo — es la misma garantía de "estático
  de verdad" que ya cubrían `DEMO_SCENE_CAPTION`/`SCREENSHOT_CAPTION`.

### 3. `tests/lib/landing-source-scan.test.ts`

El barrido de motion (`00-architecture.md` § Gramática de motion, punto 7)
pasó de comprobar `landing-msg-in`/`landing-row-in` a las **tres** clases:
sumé `landing-num-in` a la lista prohibida en el HTML de primer render (SSR)
de las 19+ exportaciones de componentes de `src/views/landing/**`. Es el
mismo mecanismo que ya existía, extendido: las tres calculadoras
(`eta-demo.tsx`, `delivery-quote.tsx`, `pricing-calculator.tsx`) la gatean
ahora con `hasChanged` (ronda de correcciones sobre el hallazgo no
bloqueante que dejé documentado en el informe anterior), así que las tres
clases son una sola familia de regla y el barrido las trata como tal. Sigue
en verde: ninguna de las tres aparece en ningún HTML servido.

No toqué la allowlist de las 8 islas cliente ni el resto de los describe de
ese archivo (GSAP, el `<h1>` estático, `IVA_DISCLOSED`) — siguen vigentes
sin cambios.

---

## Resultado de `npm test`

```
Test Files  71 passed | 33 skipped (104)
     Tests  1042 passed | 314 skipped (1356)
```

- Los 33 archivos / 314 tests "skipped" son toda la carpeta `tests/db/`: se
  saltean solos porque no hay Docker/stack local corriendo en este entorno
  (`[tests/db] No se pudo conectar a "supabase_db_burger-shop"...`),
  comportamiento esperado y documentado en `CLAUDE.md`. No corrí
  `npm run db:start` ni toqué la base.
- `npx tsc --noEmit -p .` — limpio.
- `npx eslint tests/lib/landing-source-scan.test.ts tests/lib/landing-render.test.ts tests/lib/landing.test.ts` — limpio.

## `npm run build`

Corrido una vez. `/` sale `○ (Static)` en la tabla de rutas, sin cambios
necesarios de mi parte. Ninguna otra ruta de `src/views/landing/**` afecta
esa tabla (todo lo demás bajo `/[store]`, `/admin`, `/backoffice`, etc. ya
era `ƒ` antes de esta ronda).

## Archivos tocados por mí (test-engineer)

- `/Volumes/SSD/Work/burger-shop/tests/lib/landing.test.ts` (extendido —
  `HERO_FLOW` a 5 pasos, describe nuevo de `HERO_ORDER`)
- `/Volumes/SSD/Work/burger-shop/tests/lib/landing-render.test.ts`
  (describe bloqueante reemplazado por el criterio nuevo + test de
  `addressLine`)
- `/Volumes/SSD/Work/burger-shop/tests/lib/landing-source-scan.test.ts`
  (barrido de motion extendido a `landing-num-in`)

No toqué `src/**`, `supabase/**` ni ningún otro archivo de `tests/**`.

## Hallazgos pendientes de rondas anteriores

Ninguno abierto. El hallazgo bloqueante de la ronda 3 (título único en el
HTML servido) fue resuelto por Slice F con un cambio de criterio aprobado
por el orquestador, y el hallazgo no bloqueante de `landing-num-in` (rondas
D/E) fue corregido en su propia ronda de correcciones y ahora está cubierto
por un test que lo haría fallar si reapareciera.

## Para el orquestador

**Suite verde, build verde, sin hallazgos nuevos.** Queda pendiente del lado
de `code-reviewer` el veredicto en paralelo sobre esta misma ronda 4 (el
storyboard de `hero-flow.tsx`); de mi lado no hay bloqueantes para mergear.
