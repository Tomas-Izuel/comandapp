# 03 — Tests (2026-08-31-detalles-qc)

Estado de partida confirmado: 73 archivos, 913 tests, 4 skippeados, stack
local de Supabase arriba. Estado final: **74 archivos, 926 tests, 4
skippeados** (`npm test`, y por separado `npx vitest run tests/db` con
reporter verbose: **24 archivos, 188 tests**, todos en verde — el stack local
corrió de verdad, nada se saltea). `npm run typecheck` y `npm run lint`
también en verde.

## Qué se cubrió

### 1. `hourTicks` (T4) — `tests/views/schedule-track.test.ts`

Era lógica pura nueva sin un test. Agregué un `describe('hourTicks', …)` con
8 casos, junto a lo que ya había para `computeWeekAxis`/`formatAxisHour`
(intactos, no los toqué):

- Span mínimo (8h) → paso de 2h, marcas estrictamente internas.
- BORDE: `axis.start` cae justo en un múltiplo del paso → no se duplica como
  marca (ej. `{start:8,end:16}` no incluye `8`).
- Las marcas nunca son `axis.end`, incluso cuando cae en un múltiplo exacto
  del paso (`{start:0,end:8}` no incluye ni `0` ni `8`).
- Los tres escalones de `tickStepHours` (no exportada; se prueba por el
  efecto observable — la separación entre marcas): span=10 → 2h, span=11 →
  3h, span=18 → 3h, span=19 → 4h. Los cuatro son los bordes exactos donde
  cambia el paso.
- Eje que cruza medianoche (`{start:8,end:26}`, el mismo caso que ya prueba
  `computeWeekAxis` para el viernes 19:00–02:00): todas las marcas quedan
  estrictamente adentro de `(start,end)` aunque superen 24, y `24` aparece
  como una marca más que `formatAxisHour` lee como `"00:00"`.

### 2. Cuenta bancaria solo-alias (T1) — `tests/models/bank-account.schema.test.ts`

Revisé la cobertura existente antes de escribir nada nuevo: `bankAccountInputSchema`
**ya tenía** los tres casos que pedía el brief — acepta solo-alias (línea 58),
acepta solo-cbu (línea 28), rechaza los dos vacíos (línea 73) — así que no
dupliqué. Lo único que faltaba era el mensaje concreto que el dueño lee
cuando rechaza los dos vacíos; se lo agregué a ese mismo test:
`expect(result.error.issues[0].message).toBe('Cargá un CBU, un CVU o un alias')`,
con un comentario que ata el test al síntoma reportado (T1) para que si el
mensaje se rompe o desaparece, quede claro por qué importa.

No agregué nada en `tests/db/`: `grants-store-bank-accounts.test.ts` ya cubre
exactamente lo que el reporte de T1 pedía blindar — el INSERT solo-alias pasa
el CHECK (`D3: SOLO alias (sin cbu) entra`) y el INSERT sin ninguno de los dos
rebota (`sin CBU ni alias, el CHECK ... rebota`) — así que también ahí hubiera
sido duplicar.

### 3. Invariante cantidad ↔ carrito del stepper (T2) — `tests/lib/cart.test.ts` (archivo nuevo)

`lineKey` es pura y exportada desde `src/lib/cart.tsx`, y es literalmente la
función de la que depende que el stepper de la tarjeta encuentre la línea
correcta: la tarjeta busca con `lineKey({productId, optionIds:[], notes:null})`
y `addLine`/`setQuantity` mergean con el mismo `lineKey()` sobre la línea real.
Escribí 5 tests que prueban esa unión sin montar React (ver la nota de más
abajo sobre lo que NO se montó):

- La clave de lookup de la tarjeta es la misma que la que tendría la línea que
  crea `addLine` para ese producto sin opciones.
- Dos productos sin opciones nunca colisionan en la misma clave.
- **Aislamiento** (el caso que de verdad importa): la línea "quick add" sin
  opciones de un producto no se confunde con una línea del MISMO producto con
  opciones ya cargada desde la ficha — si colisionaran, el stepper de la
  tarjeta mostraría o modificaría la cantidad de una línea con opciones
  distintas.
- El orden de `optionIds` no cambia la clave (necesario para que el merge de
  `addLine` encuentre la línea sin importar en qué orden llegaron las
  opciones).
- `notes` distintas (incluida la ausencia) producen claves distintas.

## Qué decidí NO cubrir, y por qué

- **Montar `CartProvider`/`product-card.tsx` con Testing Library.** El brief
  pedía explícitamente no traer aparato nuevo por un solo caso. `addLine` es
  un setter de hook, no una función pura: probarlo "de verdad" pide jsdom +
  Testing Library, que esta suite no tiene (corre en Node — `vitest.config.ts`
  lo dice explícito: "si algún día hace falta testear un componente, se
  agrega un `environmentMatchGlobs`"). La invariante real —que la tarjeta y
  `addLine` concuerdan sobre qué línea es cuál— pasa enteramente por
  `lineKey()`, que sí es pura, así que cubrirla ahí prueba lo mismo que
  importa sin el costo de montar un DOM para un caso.
- **Animaciones, geometría en píxeles y verificación visual de T2/T3** (el
  fit de 108px del stepper vertical, el contraste del verde de WhatsApp, el
  `mix-blend-difference` del marcador de medianoche). Son propiedades de
  render/CSS que el dev agent ya verificó a mano en el navegador (documentado
  en `02-development-t2-stepper-tarjeta.md` y `02-development-t3-t4-admin.md`)
  y que esta suite, en Node sin DOM, no puede ejercer de forma significativa.
- **`useAddFeedback`, animaciones de motion, `MAX_QUICK_ADD_QUANTITY`
  disabled-state del botón**: son comportamiento de componente React montado,
  mismo motivo que el punto anterior.
- **T5 (footer/mail)**: es un cambio de contenido estático (constantes de
  string) en Server Components sin lógica condicional que testear — no hay
  una invariante de dominio ahí, solo un valor. No agregué un test que solo
  reafirme el literal del mail: sería exactamente el tipo de test-scaffolding
  que las reglas de este rol prohíben ("si no podés decir qué bug atrapa, no
  es cobertura").

## Hallazgos para rutear

Ninguno propio. El único hallazgo de esta tanda ya está documentado por el
dev agent de T1 en `02-development-t1-cuenta-bancaria.md` ("Hallazgo
colateral"): `confirmPendingChangeAction` llama `revalidatePath` DESPUÉS de
`upsertBankAccount` dentro del mismo `try`, así que si `revalidatePath` (o
cualquier otra cosa post-escritura) tirara, el dueño vería `ok:false` sobre un
cambio que en realidad ya se guardó. No lo reproduje yo misma ni agregué un
test para eso: no es un bug hoy (en Next real `revalidatePath` no falla), es
una fragilidad teórica que el propio dev agent ya dejó señalada para que el
hilo principal decida si amerita su propio slice. No hay nada nuevo que
reportar de mi paso por la suite.

## Archivos tocados

- `tests/views/schedule-track.test.ts` — agregado `describe('hourTicks', …)`.
- `tests/models/bank-account.schema.test.ts` — reforzada la aserción del
  mensaje en el test de "los dos vacíos rechazan".
- `tests/lib/cart.test.ts` — nuevo, invariante `lineKey`.

## Veredicto

**SUITE GREEN** — 74 archivos / 926 tests pasando (4 skip, sin cambios de
motivo respecto del baseline), incluidos los 24 archivos / 188 tests de
`tests/db/` corridos contra el stack local real. `npm run typecheck` y
`npm run lint` en verde.
