# Tests — ajustes-por-secciones

**Agente:** test-engineer · **Rama:** `feat/ajustes-por-secciones`

## Round 2 — arreglos de `03-review.md` (hallazgo bloqueante #1: `acceptingOrders`)

Después del primer pase, backend/frontend sacaron `acceptingOrders` de
`storeOrderingInputSchema` (14 claves, antes 15) y de la columna que escribe
`updateStoreOrdering` (14 columnas), y agregaron `resumeAcceptingOrders`
(`store.model.ts`) + `resumeAcceptingOrdersAction` (`admin.actions.ts`), que
escriben `accepting_orders = true` con el cliente de SESIÓN (RLS), no el
admin — verificado el grant de columna para `authenticated` en
`20260826120000_hardening.sql:424`. El motivo: el formulario tenía dos caminos
de escritura para la misma columna, y el del submit general podía pisar en
silencio una pausa/reapertura hecha desde otro dispositivo.

Se actualizó lo siguiente (detalle en las secciones §1/§2 de abajo, ya
reflejan el estado final):

- `tests/models/store.schema.test.ts` — el conjunto de exclusión de la
  paridad pasa de `{timezone, currency}` a `{timezone, currency,
  acceptingOrders}`, con un test dedicado que explica por qué
  `acceptingOrders` sale por un motivo distinto a `timezone`/`currency`
  (tiene su propio camino de escritura inmediato; las otras dos no se editan
  en ninguna parte) y otro que confirma que `storeSettingsInputSchema` NO
  cambió (la clave sigue ahí, solo que ningún `.pick()` la hereda).
- `tests/models/store-settings-split.model.test.ts` — `ORDERING_COLUMNS` baja
  a 14 (sin `accepting_orders`), que se sumó a `FORBIDDEN_FOR_BOTH` con un
  test dedicado ("LA REGRESIÓN QUE ESTE ARREGLO PREVIENE") que fuerza
  `acceptingOrders: true` en el input de `updateStoreOrdering` (cast `as
  never`) y confirma que el `.update()` de abajo no la referencia — mismo
  tratamiento que ya tenía `courier_collects_payment`, y así de importante a
  partir de ahora. Se agregó un `describe` nuevo para `resumeAcceptingOrders`
  (5 tests): payload exacto `{ accepting_orders: true }`, apunta a la fila
  correcta, cualquier staff puede llamarlo, un `courier` no puede, y alguien
  sin fila en `store_members` tampoco. El archivo no mockea
  `@/lib/supabase/admin` a propósito: si la función alguna vez usara
  `createAdminClient()` en lugar del cliente de sesión, el import real de ese
  módulo (sin sus env vars, no seteadas en este archivo) fallaría con un error
  distinto al esperado — una segunda señal además del assert de payload.

Los dos tests que el coordinador marcó como rojos a propósito
(`store.schema.test.ts` y `store-settings-split.model.test.ts`, ambos
todavía referenciando el shape viejo de `storeOrderingInputSchema`) quedaron
verdes después de esta actualización — confirmado con `npx vitest run` sobre
los dos archivos antes de correr la suite completa.

## Qué se agregó (estado final, primer pase + round 2)

### 1. `tests/models/store-settings-split.model.test.ts` (65 tests)

La invariante que motivó todo el corte (00-architecture.md): `updateStoreProfile`,
`updateStoreOrdering` y `resumeAcceptingOrders` no pueden pisarse las columnas
entre sí. Se mockea el único borde real (`@/lib/supabase/server`, dispatcher
por tabla igual que `order.model.test.ts`/`platform-owner-invite.model.test.ts`)
y se deja correr `requireStoreMembership` de verdad — es la misma función que
las tres llaman primero.

Por cada función se prueba, leyendo el payload REAL que llega a `.update()`:

- El set de columnas es **exactamente** el documentado (12 para perfil, 14
  para pedidos/envío, 1 para reapertura) — ni de más ni de menos.
- **Ninguna de las dos toca las columnas de la otra** (`it.each` sobre las
  14/12 columnas del otro lado): es el bug concreto que el corte vino a hacer
  imposible.
- **Ninguna de las dos toca** `id`, `slug`, `status`, `created_at`, `updated_at`,
  `timezone`, `currency`, `courier_collects_payment`, `online_payment_enabled`
  ni **`accepting_orders`** — incluso forzando `courierCollectsPayment`/
  `acceptingOrders` en el input de `updateStoreOrdering` (cast `as never`),
  para probar que aunque alguien reabra el schema, el `.update()` de abajo no
  los referencia. El de `accepting_orders` es, desde el round 2, tan
  importante como el de `courier_collects_payment`: es exactamente la
  regresión (pisar una pausa/reapertura de otro dispositivo) que motivó sacar
  la columna de `updateStoreOrdering`.
- Normalización "las dos o ninguna" de `latitude`/`longitude` (3 casos: solo
  latitud, solo longitud, las dos).
- Cualquier `staff` (no solo `owner`) puede guardar/reabrir; un `courier` no
  puede (corta en `requireStoreMembership`, antes de tocar la base — se
  verifica `updateCalls` en 0); alguien sin fila en `store_members` tampoco.
- Las dos acciones de guardado llamadas en secuencia nunca producen un único
  `.update()` con columnas mezcladas: cada una es su propio round-trip.
- `resumeAcceptingOrders`: el payload es exactamente `{ accepting_orders:
  true }`, apunta a la fila correcta, y corre sobre el cliente de SESIÓN (no
  se mockea `@/lib/supabase/admin` en este archivo a propósito).

### 2. `tests/models/store.schema.test.ts` (agregado un `describe`)

Paridad de cobertura: `storeProfileInputSchema.shape` ∪
`storeOrderingInputSchema.shape` tiene que ser exactamente
`storeSettingsInputSchema.shape` menos `{timezone, currency,
acceptingOrders}`, sin solapamiento entre los dos `.pick()`. Mismo patrón que
`tests/db/reserved-slugs-parity.test.ts`, pero en TypeScript puro porque este
contrato no vive en Postgres — falla si alguien agrega una clave nueva al
schema base y se olvida de sumarla a un `.pick()` (o la suma a los dos).

Las tres exclusiones tienen cada una su propio test con el motivo escrito
explícitamente, porque NO comparten el mismo motivo:

- `timezone`/`currency`: no se editan en ninguna pantalla.
- `acceptingOrders`: SÍ se edita, pero por su propio camino inmediato
  (`resumeAcceptingOrdersAction`/`pauseScheduledNightAction`), nunca por el
  submit del formulario — se confirma además que `storeSettingsInputSchema`
  sigue teniendo la clave (no cambió), solo que ningún `.pick()` la hereda.
- `courier_collects_payment`: ni siquiera vive en `storeSettingsInputSchema`
  — nunca tuvo un camino de escritura desde el staff, ni inmediato ni por
  submit (a diferencia de `acceptingOrders`).

### 3. `tests/views/schedule-track.test.ts` (nuevo — primer test bajo `tests/views/`)

`computeWeekAxis`/`formatAxisHour` de `schedule-track.tsx` son lógica pura sin
Supabase ni JSX, así que se testean directo sin necesitar jsdom (la config del
proyecto corre en Node). Cubre los bordes del brief
(`00-architecture-horarios.md`):

- Semana vacía → `null`.
- **Borde de span mínimo**: un rango de exactamente 8h no necesita padding
  (`{start:0,end:8}`); uno de 9h tampoco se recorta; uno de 1h se estira a 8h.
- Un solo día con dos turnos (mañana/noche) sin cruzar medianoche.
- **Cruce de medianoche**: combinando un rango temprano con uno que cruza la
  medianoche, el eje se estira a 26 (02:00 del día siguiente) por el cruce en
  sí, no por el padding del span mínimo (se aísla a propósito para no
  confundir las dos causas).
- Varios días con varios rangos: además de validar `{start, end}`, se recalculan
  los porcentajes de `left`/`width` de cada rango individual (la misma cuenta
  que hace `DayBar`) y se afirma que ninguno cae fuera de `[0, 100]` — es la
  búsqueda explícita de un eje degenerado que pidió la tarea.
- `formatAxisHour`: 24 exactas → `"00:00"` (no "las 24"), 26 → `"02:00"`.

No se testeó `DayBar` (el componente): requiere render y el proyecto corre en
Node, no jsdom (`vitest.config.ts`); el brief de aceptación de foco/mobile/ARIA
queda fuera del alcance de vitest tal como está configurado hoy.

### 4. `tests/controllers/confirm-pending-change.actions.test.ts` (nuevo, 4 tests)

Cubre el `revalidatePath` que el backend reportó como cambiado:
`confirmPendingChangeAction` (rama `courier_collects_payment`) ahora llama
`revalidatePath('/admin/ajustes', 'layout')` en vez de sin el segundo
argumento. Sin el `'layout'`, la confirmación por código aplicaba en la base
pero `/admin/ajustes/pedidos` (la sub-ruta real donde vive el switch) no se
invalidaba. Se prueba:

- La llamada exacta (`toHaveBeenCalledExactlyOnceWith('/admin/ajustes',
  'layout')`).
- Que escribe con el admin client (`createAdminClient()`), no el de sesión.
- Que si el `UPDATE` falla, NO revalida nada (no hay que fingir que se aplicó).
- Que la otra rama (`payment_credentials`) sigue revalidando `/admin/pagos` sin
  tocar `/admin/ajustes` — control de que el fix no se filtró a la rama que no
  correspondía.

### 5. Limpieza — `tests/services/invite-rate-limit.test.ts:57`

El mock huérfano `updateStoreSettings: vi.fn()` (reportado por el backend
agent) se reemplazó por `updateStoreProfile: vi.fn(), updateStoreOrdering:
vi.fn()`, que son las claves reales que exporta `@/models/store.model` hoy.
No cambiaba el resultado de ningún test (nada en ese archivo llamaba a esa
función), pero un mock de módulo con una forma que no corresponde a la real es
exactamente el tipo de cosa que "pasa en verde y rompe en producción" que
CLAUDE.md pide evitar.

### 6. `tests/db/grants-stores-courier-collects-payment.test.ts` (nuevo — se saltea sin Docker)

No existía cobertura real de esta invariante — el informe del backend
asumía que ya estaba cubierta de antes de este pipeline, pero
`grants-stores.test.ts` (S-01) solo prueba `status` y `slug`. Este archivo
prueba, contra el Postgres real del stack local:

- Un **owner** no puede tocar `courier_collects_payment` por PostgREST directo
  (`set local role authenticated` con sus claims reales) — `permission denied
  for table stores`.
- Un **staff** (no owner) tampoco — mismo resultado, por si algún día el chequeo
  de rol se relaja y hay que confirmar que el grant solo igual frena.
- El mismo `UPDATE`, tocando solo `name` (permitida), SÍ pasa — prueba que la
  fila no está bloqueada entera, solo la columna.
- `service_role` (`set local role service_role`, no el superusuario de la
  conexión) SÍ puede — es el camino real de `confirmPendingChangeAction`.

**No se pudo ejecutar**: no hay Docker disponible en este entorno (`docker
info` falla), así que la suite completa de `tests/db/` corre con
`describe.skipIf(!dbAvailable)` y queda en skipped, como el resto de
`tests/db/`. El archivo se armó siguiendo al pie la convención de
`grants-stores.test.ts`/`online-payment-flag.test.ts` (mismos helpers,
mismo estilo de fixture) y quedaría en verde apenas alguien lo corra con
`npm run db:start` — recomendado antes de mergear, ya que es el único test que
prueba esta invariante contra Postgres real en vez de contra un mock de
TypeScript.

## Hallazgos (no bloqueantes, reportados — no tocados)

Ninguno nuevo en `src/`, en ninguna de las dos rondas. Los reportes previos
se verificaron y quedaron resueltos:

- El mock huérfano de `invite-rate-limit.test.ts` — limpiado (ver §5 más
  arriba, primer pase).
- El `TS2724` de `settings-form.tsx` importando `updateStoreSettingsAction` —
  no aplica: ese archivo fue reemplazado por `profile-form.tsx` /
  `ordering-form.tsx` en el slice de frontend, y no existe más en el diff.
- Los 3 hallazgos bloqueantes de `03-review.md` (banner de
  `AcceptingOrdersToggle`, foco al abrir un día, foco huérfano en
  excepciones): el #1 (`acceptingOrders`) es el que motivó este round 2 y ya
  está cubierto por las nuevas pruebas de `resumeAcceptingOrders`. Los
  hallazgos #2 y #3 son de foco/DOM en `schedule-editor.tsx` — no verificados
  acá porque `vitest.config.ts` corre en Node, no jsdom; quedan para quien
  cierre esa parte del round de arreglos (frontend/reviewer).

Revisé además el `.update()` de `resumeAcceptingOrders` y el de
`pauseScheduledNightAction` uno al lado del otro: los dos llaman
`requireStoreMembership(id)` sin `{ role: 'owner' }` — permiso simétrico entre
apagar y prender, sin la asimetría de rol que hubiera sido un hallazgo real.

## Verificación

```
npm test          → 37 test files passed | 20 skipped (57)
                     587 tests passed | 143 skipped (730)
npm run typecheck  → limpio
npm run lint       → limpio
```

Los 20 archivos skipped son toda la suite de `tests/db/`, porque Docker no
está disponible en este entorno (`docker info` falla). Nada de lo agregado
depende de Docker salvo `grants-stores-courier-collects-payment.test.ts`
(primer pase), que está diseñado para saltearse igual que el resto.

## Veredicto

**SUITE GREEN**
