# 03-review — Ajustes en tres páginas

**Revisor:** code-reviewer · **Rama:** `feat/ajustes-por-secciones` contra `origin/main`

## Veredicto

**APROBADO CON OBSERVACIONES** — no hay violaciones de las invariantes duras del
repo (MVC, dinero, `courier_collects_payment`, permisos, `.pick()` de columnas),
y el corte de datos está bien hecho. Pero hay **un hallazgo bloqueante** de
producto (un banner que miente sobre cuándo se aplica un cambio, en el switch
maestro de "tomando pedidos") y **dos hallazgos de accesibilidad** que
incumplen directamente lo que el propio brief pedía verificar. Los tres son
arreglables sin rehacer nada — no ameritan volver a Slice A ni tocar el corte
de columnas.

## Alcance revisado

```
 .../src-views-admin-ajustes-schedule-editor-tsx.md | 177 +++----
 00-architecture-horarios.md                        |  88 ++++
 00-architecture.md                                 | 110 +++++
 01-tasks.md                                        | 110 +++++
 02-development-backend.md                          | 221 +++++++++
 02-development-frontend.md                         | 232 +++++++++
 02-development-horarios.md                         | 230 +++++++++
 src/app/admin/(app)/ajustes/horarios/page.tsx       |  34 ++
 src/app/admin/(app)/ajustes/layout.tsx              |  21 +
 src/app/admin/(app)/ajustes/page.tsx                |  34 +-
 src/app/admin/(app)/ajustes/pedidos/page.tsx        |  15 +
 src/controllers/admin.actions.ts                    |  37 +-
 src/models/schemas/store.schema.ts                  |  50 ++
 src/models/store.model.ts                           |  57 ++-
 src/views/admin/ajustes/fields.tsx                  | 212 ++++++++
 src/views/admin/ajustes/location-map-field.tsx      |   8 +-
 settings-form.tsx => ordering-form.tsx              | 534 +++------------------
 src/views/admin/ajustes/profile-form.tsx            | 302 ++++++++++++
 src/views/admin/ajustes/schedule-editor.tsx         | 186 ++++++-
 src/views/admin/ajustes/schedule-track.tsx          | 129 +++++
 src/views/admin/ajustes/settings-tabs.tsx           |  57 +++
```

(Más `tests/` y `docs/`, que no son mi alcance — los tocó/está tocando
`test-engineer` en paralelo; `03-tests.md` no existía todavía al momento de
este review.)

Verifiqué contra el código real, no contra los informes: `npx next typegen &&
npm run typecheck` (limpio), `npm run lint` (limpio), `npm test` (502 pasan, 139
se saltean sin Docker — ninguno de los saltados es de este pipeline), y leí
línea por línea `store.schema.ts`, `store.model.ts`, `admin.actions.ts`,
`profile-form.tsx`, `ordering-form.tsx`, `fields.tsx`, `settings-tabs.tsx`,
`location-map-field.tsx` (diff), `schedule-editor.tsx` y `schedule-track.tsx`.
Confirmé con la doc de Next (`context7`) el comportamiento de
`revalidatePath(path, 'layout')`.

---

## Hallazgos

### 1. [BLOQUEANTE] El banner "se aplica al instante" miente al prender "Tomando pedidos"

**Archivo:** `src/views/admin/ajustes/ordering-form.tsx:93-103` (`ImmediateControl`)
y `:340-353` (uso envolviendo `AcceptingOrdersToggle`), contra `:189-253`
(`AcceptingOrdersToggle`, sin cambios de comportamiento respecto de la versión
en `settings-form.tsx` de `origin/main`).

`ImmediateControl` es un wrapper nuevo de este slice que dice, siempre, "Se
aplica al instante, no espera a 'Guardar cambios'". Se usa para dos controles:

- `CourierCollectsPaymentField`: cierto en los dos sentidos (prender y apagar
  piden código por mail, ninguno pasa por el submit general). Ningún problema acá.
- `AcceptingOrdersToggle` ("Tomando pedidos"): **solo es cierto para apagarlo**.
  `handleToggle` (línea 205): si `next === true`, hace `onChange(true)` y
  devuelve — eso únicamente actualiza el estado local de `react-hook-form`. El
  propio comentario de la función lo dice: *"Prender de vuelta... sigue el
  camino normal del formulario, sin interrumpir"* (línea 207-208). O sea que
  prender el switch **sí espera** a "Guardar cambios", justo lo que el banner
  de arriba niega.

**Escenario concreto:** un local pausó pedidos a la mañana (diálogo
destructivo, se aplicó solo). A la tarde el encargado quiere reabrir: entra a
`/admin/ajustes/pedidos`, prende "Tomando pedidos", ve el rayo y el texto "Se
aplica al instante, no espera a 'Guardar cambios'" pegado arriba del switch, y
cierra la pestaña sin bajar a tocar "Guardar cambios" (¿para qué, si ya dijo que
no hacía falta?). `accepting_orders` sigue en `false` en la base. El local cree
que reabrió y sigue sin tomar pedidos — exactamente la clase de bug que
`00-architecture.md` señala como "consecuencia real, no hipotética" del defecto
que este pipeline vino a resolver, ahora en la dirección opuesta: antes no
había señal, ahora hay una señal falsa.

**Arreglo sugerido (a elección, no implementado acá):** o (a) el toggle en
`true` también se aplica solo (una acción dedicada, sin esperar al submit
general), para que el banner sea cierto en los dos sentidos; o (b) sacar
`AcceptingOrdersToggle` de `ImmediateControl` y señalar la asimetría de otra
forma (p. ej. el banner solo aparece cuando el camino que se está por disparar
es el destructivo, no siempre).

### 2. [BLOQUEANTE] El foco al abrir un día no llega al primer campo editable, llega al botón "Listo"

**Archivo:** `src/views/admin/ajustes/schedule-editor.tsx:353-357` (el
`useEffect` de foco) contra `:452-469` (el JSX del panel abierto).

```ts
useEffect(() => {
  if (openDay === null) return
  const firstField = openPanelRef.current?.querySelector<HTMLElement>('input, button')
  firstField?.focus()
}, [openDay])
```

`openPanelRef` está puesto en el `<div>` que envuelve **todo** el panel del día
abierto, incluida la cabecera con el botón "Listo" (línea 453-459), que se
renderiza **antes** que la lista de `RangeRow` con los `<input type="time">`
(línea 460 en adelante). `querySelector('input, button')` devuelve el primer
elemento que matchea en orden de documento — y ese es el botón "Listo", no el
primer input de hora.

**Escenario concreto:** un usuario de teclado/lector de pantalla presiona Enter
sobre la fila "Viernes" (el `<button>` de `DayBar`). El panel se abre y el foco
salta a "Listo" en vez de al primer campo de hora. Si el usuario, esperando
estar parado en un campo editable, presiona Enter o Space de nuevo, **cierra el
panel que acaba de abrir** sin haber llegado nunca a los inputs. Esto contradice
directamente lo que el propio informe de desarrollo (`02-development-horarios.md`)
dice haber resuelto ("el foco queda en el primer campo editable del panel que
se abrió") y lo que pedía la revisión (punto 6 del brief: "El día se abre con
teclado").

**Arreglo sugerido:** acotar el `querySelector` al contenedor de rangos (el
segundo `<div>`, no el panel entero), o buscar específicamente
`input[type="time"]` en vez de `input, button` genérico.

### 3. [MAYOR] Las excepciones por fecha no replican el manejo de foco — foco huérfano al expandir

**Archivo:** `src/views/admin/ajustes/schedule-editor.tsx` — `OverrideRow`
(≈536-803) y `OverridesEditor` (≈805-879), comparado con `WeekEditor`
(`openPanelRef` + `useEffect`, ≈320-357).

El propio informe de desarrollo dice que las excepciones se compactaron "con la
misma lógica de reposo/apertura" que los días de la semana. Es cierto para el
colapso/expansión, pero **no** para el foco: `WeekEditor` tiene el
`useEffect`+`ref` que mueve el foco al abrir un día (aunque termine en el lugar
equivocado, hallazgo 2); `OverrideRow`/`OverridesEditor` no tienen ningún
mecanismo equivalente. Al tocar una fila compacta de excepción (el `<button>`
de línea 691-700), React la desmonta y monta el formulario completo sin mover
el foco a ningún elemento — por defecto del navegador, el foco queda huérfano
en `<body>`.

**Escenario concreto:** un usuario de teclado navega a "Excepciones por
fecha", presiona Enter sobre "12 de septiembre, Cerrado todo el día" para
editarla. La fila colapsada desaparece del DOM, el formulario se expande, pero
el foco no sigue a nada: para seguir navegando con teclado, el usuario tiene
que volver a tabular desde el principio del documento. Mismo defecto que el
hallazgo 2 pero sin ningún intento de arreglo, en la misma pantalla.

**Arreglo sugerido:** mismo patrón que `WeekEditor` (ref sobre el contenedor
del formulario expandido + `useEffect` sobre `isOpen`/`openKey`), acotado al
primer campo editable real (ver hallazgo 2 para no repetir el mismo error de
alcance).

### 4. [NIT] Comentarios sueltos que nombran `settings-form.tsx`, que ya no existe

**Archivos (fuera del alcance de este pipeline, ninguno de los dos agentes es
dueño):** `src/views/admin/catalogo/product-drawer.tsx:392` y
`src/views/shared/money-input.tsx:10`. Ambos informes de desarrollo ya lo
señalan como "quedó afuera / no es mío". Cosmético, cero impacto funcional —
lo dejo anotado para quien toque esos archivos después.

### 5. [Para `test-engineer`, no bloqueante] Mock colgado

`tests/services/invite-rate-limit.test.ts:57` mockea
`updateStoreSettings: vi.fn()` dentro de un factory de `vi.mock('@/models/store.model')`.
Esa función ya no existe en `store.model.ts` (se eliminó, reemplazada por
`updateStoreProfile`/`updateStoreOrdering`). Vitest no valida la forma del
mock contra el módulo real, así que no rompe nada hoy, pero es una clave
muerta. Ya reportado por el agente de backend en `02-development-backend.md`;
lo confirmo acá para que quede en el registro del reviewer también. No bloquea
este commit — es trabajo de `test-engineer`, que ya está activo en el árbol
(`tests/models/store-settings-split.model.test.ts` nuevo, y
`tests/models/store.schema.test.ts` / `tests/services/invite-rate-limit.test.ts`
modificados al momento de este review).

---

## Lo que está bien hecho (verificado contra el código, no contra los informes)

- **Corte de columnas sin huérfanas ni duplicados.** Conté las 29 claves de
  `storeSettingsInputSchema` una por una contra las 12 de
  `storeProfileInputSchema` + las 15 de `storeOrderingInputSchema`: la unión da
  exactamente las 27, y las 2 que faltan (`timezone`, `currency`) son las que
  `00-architecture.md` documenta como excluidas a propósito — y en efecto no se
  editan en ninguna página nueva, solo se siguen leyendo de `session.store`
  (`horarios/page.tsx:28-29`). Los dos `.update()` de `store.model.ts` enumeran
  exactamente sus columnas, sin interpolación dinámica.
- **`courier_collects_payment` no volvió a ningún schema ni `.update()` de
  staff.** Verificado con grep sobre todo `src/`: solo aparece en el comentario
  que explica por qué no está, y en `confirmPendingChangeAction`, que sigue
  siendo el único camino (con `createAdminClient()` detrás del código de 6
  dígitos).
- **`revalidatePath('/admin/ajustes', 'layout')` es correcto.** Confirmé contra
  la documentación de Next: `type: 'layout'` invalida el layout, todos los
  layouts anidados y todas las páginas debajo — exactamente lo que hace falta
  para que `/admin/ajustes/pedidos` refresque tras confirmar el código.
- **Permisos intactos.** Las dos acciones nuevas mantienen
  `requireStoreMembership(storeId)` sin `{ role: 'owner' }` — cualquier staff,
  igual que antes. `CourierCollectsPaymentField` sigue exigiendo
  `role === 'owner'` del lado de UI (la autoridad real sigue siendo el servidor
  vía `requestCourierPaymentPolicyChangeAction`/`requireOwnerForPaymentChange`,
  no tocado).
- **Cada `page.tsx` re-verifica sesión.** Las tres llaman
  `resolveAdminSession()` y redirigen a `/admin/acceso` si no está `ok`; el
  `layout.tsx` es estructura pura, sin `@supabase/*` en ningún `page.tsx`.
- **Dinero.** `scaleUpInt()` se usa para el ejemplo de multiplicador de demanda
  (no `Math.ceil(base * mult)`); `MoneyInput` para todos los campos de
  centavos; el ejemplo de envío usa las mismas funciones puras
  (`deliveryFeeFor`/`deliveryMinutesFor`) que el servidor, no una cuenta
  paralela.
- **`computeWeekAxis` no tiene casos degenerados.** Repasé los bordes a mano:
  semana vacía → `null` (sin dividir por cero en `DayBar`, que lo guarda detrás
  de `axis ?`); un solo rango corto → el span mínimo de 8h evita el 100%; el
  cruce de medianoche funciona sin caso especial porque `durationMinutes` ya
  viene expresado por sobre 1440 desde `draftRangeToDuration`. `left`/`width`
  nunca dan negativo ni superan 100% dentro del eje que los contiene, y
  `end - start >= 8` siempre, así que no hay división por cero.
- **La pista es decorativa correctamente.** `aria-hidden` en el `<div>` de la
  barra (`schedule-track.tsx:103-106`), el dato accesible es el `aria-label`
  del `<button>` que envuelve la fila entera, con el texto exacto pedido por el
  brief ("Viernes, 19:00 a 02:00"). Targets de 44px (`min-h-11`) en `DayBar`,
  en los tabs de `SettingsTabs` y en los chips de `CopyToControl`.
- **`isTabActive`/`isEmpty`/aislamiento entre páginas.** Cada página tiene su
  propio `useForm` (o ninguno, en Horarios); no hay un solo formulario
  compartido detrás de tabs de cliente, así que es literalmente imposible
  guardar un campo de una página parado en otra — la garantía central del
  corte se cumple.
- **Tailwind v4 y piso de calidad.** Sin `rounded-[...]` de sintaxis v3 en
  ningún archivo nuevo; sin `Panel` anidado; sin emoji como ícono; sin
  `border-left` de color (de hecho `ImmediateControl` lo descarta
  explícitamente en su propio razonamiento, documentado en
  `02-development-frontend.md`).
- **Typecheck y lint limpios**, y `npm test` (502/641, resto salteado sin
  Docker) no muestra ninguna regresión atribuible a este diff.

---

## Bloqueantes (a resolver antes de commitear)

1. El banner "Se aplica al instante" en `AcceptingOrdersToggle` (hallazgo 1).
2. El foco al abrir un día en el horario semanal aterriza en "Listo", no en el
   primer campo editable (hallazgo 2).
3. Las excepciones por fecha no mueven el foco al expandirse (hallazgo 3) —
   mismo defecto de fondo que 2, en la pantalla vecina.

Ninguno de los tres requiere reabrir el corte de columnas ni volver a Slice A:
son ajustes acotados a `ordering-form.tsx` (hallazgo 1) y `schedule-editor.tsx`
(hallazgos 2 y 3), del agente de frontend.
