# Slice B — frontend

**Agente:** frontend-react-craftsman · **Rama:** `feat/ajustes-por-secciones`

## Qué se hizo

Partió `/admin/ajustes` (una sola página, 1130 líneas de `settings-form.tsx` +
`schedule-editor.tsx` + `location-map-field.tsx`) en tres sub-rutas reales con
nav de tabs, según el contrato de `01-tasks.md` (Slice B). Consumí los
schemas/acciones que expuso el Slice A (`storeProfileInputSchema` /
`storeOrderingInputSchema`, `updateStoreProfileAction` /
`updateStoreOrderingAction`) — ya estaban terminados cuando empecé a integrar,
así que no hubo que trabajar contra un contrato todavía inexistente.

### Archivos nuevos

- `src/app/admin/(app)/ajustes/layout.tsx` — `PageFrame title="Ajustes"
  width="form"` + `<SettingsTabs />` + `children`. **No resuelve sesión**: es
  estructura pura, la autorización real está en cada `page.tsx` (regla dura
  del repo).
- `src/app/admin/(app)/ajustes/page.tsx` — reescrita. Ahora solo `ProfileForm`
  ("El local"). Dejó de pedir `getStoreHoursData`/`getMaxPrepMinutes`.
- `src/app/admin/(app)/ajustes/pedidos/page.tsx` — nueva. `OrderingForm`
  ("Pedidos y envío").
- `src/app/admin/(app)/ajustes/horarios/page.tsx` — nueva. Es la única que
  pide `getStoreHoursData` + `getMaxPrepMinutes`, y monta `ScheduleEditor`
  (importado tal cual, sin cambios).
- `src/views/admin/ajustes/fields.tsx` — `Field`, `DraftNumberInput`,
  `ToggleField`, `toEmptyToNull`, `SaveBar`. Los primeros cuatro son
  extracción literal de la extinta `settings-form.tsx`, comentarios incluidos.
  `SaveBar` es la barra pegajosa de guardado, antes JSX inline al final del
  `<form>`, ahora un componente parametrizado por `pending` / `errorMessages`
  / `label` para que la usen las dos páginas con `useForm`.
- `src/views/admin/ajustes/profile-form.tsx` — "El local": datos, dirección +
  mapa, canales. `useForm<StoreProfileInput>` propio,
  `updateStoreProfileAction` propio.
- `src/views/admin/ajustes/ordering-form.tsx` — "Pedidos y envío": pedidos,
  envío propio, programados, multiplicador de demanda. `useForm<StoreOrderingInput>`
  propio, `updateStoreOrderingAction` propio. Se lleva `AcceptingOrdersToggle`
  y `CourierCollectsPaymentField` (los dos controles que se aplican solos).
- `src/views/admin/ajustes/settings-tabs.tsx` — nav de tabs, cliente solo por
  `usePathname`.

### Eliminado

- `src/views/admin/ajustes/settings-form.tsx` (1130 líneas, reemplazado por
  los tres archivos de arriba).

### Tocados, no reescritos

- `src/views/admin/ajustes/location-map-field.tsx`: el único cambio real es
  el tipo del prop `control`, de `Control<StoreSettingsInput>` a
  `Control<StoreProfileInput>` — necesario porque ahora vive dentro de
  `profile-form.tsx`, que tiene un `useForm` acotado a 12 campos en vez de los
  29 originales. Verificado que el componente solo lee `latitude`,
  `longitude` y `address` vía `useController`/`useWatch`, los tres presentes
  en `StoreProfileInput` — cero lógica de geocoding/mapa tocada. De paso
  actualicé dos comentarios internos que nombraban a `settings-form.tsx` por
  su nombre viejo (ahora dicen `profile-form.tsx` / `fields.tsx`).
- `src/views/admin/ajustes/schedule-editor.tsx`: sin cambios, se importa igual
  que antes desde `horarios/page.tsx`.

## La convención visual para "esto se aplica solo" (punto 1 del brief)

**El problema real, no el síntoma.** En `pedidos/` conviven 13 campos que
esperan el botón "Guardar cambios" con dos controles que se aplican en el
momento: `AcceptingOrdersToggle` (abre un diálogo destructivo si hay
programados pagados de por medio) y `CourierCollectsPaymentField` (pide un
código de 6 dígitos por mail). Antes de este slice, los tres mecanismos vivían
en la misma pantalla sin ninguna señal — exactamente el defecto de fondo que
`00-architecture.md` nombra como la razón real detrás del síntoma del scroll.

**Decisión.** Un wrapper (`ImmediateControl`, privado en `ordering-form.tsx` —
solo dos consumidores hoy, no ameritaba todavía subir a un archivo
compartido) que envuelve exactamente esos dos controles: un marco propio
(`rounded-lg border p-2`) con un renglón arriba, en la misma línea visual que
el control, con un ícono de rayo (`Zap`, lucide) y el texto "Se aplica al
instante, no espera a 'Guardar cambios'". Nada de badge flotante ni color de
alerta — el rayo es una metáfora neutra ("instantáneo"), no "cuidado", así
que no compite con el tono realmente destructivo que ya pone el diálogo de
`AcceptingOrdersToggle` cuando corresponde.

**Por qué esta forma y no otras que se descartaron:**
- Un `border-left` de color en vez del marco completo — prohibido por el piso
  de calidad (`craft-floor.md`: colored border-left/right arriba de 1px, ban
  sin excepción).
- Un `Badge` (shadcn) suelto al lado del label — se probó mentalmente y quedaba
  como una etiqueta de estado (Nuevo/Beta), que es una metáfora distinta a
  "esto no espera al botón de abajo"; el rótulo de texto completo con ícono es
  más explícito y no depende de que el dueño conozca el color de un badge.
  El vocabulario "punto + texto" que ya usa `shell.tsx` para
  Activo/Suspendido quedó descartado por el mismo motivo: ahí el punto de
  color SÍ es semántico (verde/rojo = ok/mal); acá no hay bueno/malo, hay
  "ahora" vs. "después", y reusar la misma forma para un significado distinto
  hubiera sido más confuso, no menos.
- Fondo teñido en vez de solo borde — se descartó: `ToggleField` ya trae su
  propio `hover:bg-muted`, y anidar un fondo teñido detrás de otro fondo de
  hover leía mal (dos grises pisándose). Solo borde + texto arriba deja que el
  hover del control interno siga leyéndose limpio.
- El texto es siempre el mismo en los dos usos ("Se aplica al instante, no
  espera a 'Guardar cambios'"): la explicación de CUÁL es el mecanismo
  (diálogo destructivo vs. código por mail) sigue viviendo en el `hint` propio
  de cada control, que ya la tenía. El wrapper no duplica esa explicación,
  solo señala "esto es distinto a lo de abajo".

**Alcance de la convención.** Vive solo en `ordering-form.tsx` hoy porque es
la única página con controles de este tipo. Si `profile-form.tsx` o una
página futura necesita el mismo patrón, `ImmediateControl` debería subir a
`fields.tsx` (o a `views/admin/shared/`, si el consumo cruza páginas) — dejo
la nota acá para no reinventarlo.

## Otras decisiones

- **`SaveBar` genérico, no un componente por página.** Recibe `pending`,
  `errorMessages: string[]` (ya mapeados a labels legibles por el caller,
  porque cada page tiene su propio `FIELD_LABELS` tipado a su propio
  sub-schema) y un `label` opcional (default `"Guardar cambios"`). Antes decía
  "Guardar ajustes"; cambié el texto porque ahora hay dos páginas con esta
  barra y ninguna es "los ajustes" a secas — cada una guarda una porción.
- **`FIELD_LABELS` se partió en dos `Record`s**, uno por sub-schema
  (`Record<keyof StoreProfileInput, string>` / `Record<keyof
  StoreOrderingInput, string>`), no un objeto grande compartido con claves de
  más: así TypeScript obliga a que cada página declare exactamente sus propias
  claves y una nueva clave en un schema que no se etiquetó explota en
  `tsc`, no en producción.
- **`horarios/page.tsx` no tiene `<PageFrame>` propio** (ya lo pone
  `layout.tsx`) y **no monta `SaveBar`**: es la única página sin barra de
  guardado, y esa ausencia es la señal de que se guarda sola — tal como pide
  `00-architecture.md`.
- **Tabs con `border-b-2` (subrayado), no pills.** Elegí el patrón de
  subrayado en vez de replicar los pills `bg-primary` del nav lateral de
  `shell.tsx`: son navegaciones de nivel distinto (secciones del panel vs.
  sub-secciones de una sección), y usar la misma forma para las dos hubiera
  leído como "esto también es nivel panel". `aria-current="page"` en el tab
  activo, `min-h-11` (44px) en cada `<Link>`, `overflow-x-auto` +
  `[scrollbar-width:none]` para que en mobile se pueda scrollear sin barra
  visible si el texto no entra (hoy entra sin problema en 375px, pero no
  quería depender de eso).
- **`isTabActive` usa match exacto para la raíz `/admin/ajustes`** y
  `startsWith` para las otras dos — con `startsWith` a secas la raíz también
  matchea `/admin/ajustes/pedidos` y las tres tabs quedarían marcadas juntas
  en esa sub-ruta. Mismo problema que ya resuelve `isNavActive` en
  `shell.tsx` para `/admin` — no toqué ese archivo, pero repetí el mismo
  criterio acá.

## Contratos consumidos (Slice A, ya cerrado cuando integré)

- `storeProfileInputSchema` / `StoreProfileInput` (12 claves) y
  `storeOrderingInputSchema` / `StoreOrderingInput` (15 claves) en
  `src/models/schemas/store.schema.ts`.
- `updateStoreProfileAction(storeId, input)` / `updateStoreOrderingAction(storeId, input)`
  en `src/controllers/admin.actions.ts`, ambas `ActionResult`.
- `resolveAdminSession()` (memoizada con `cache()`, confirmado leyendo
  `admin.controller.ts` antes de asumir costo extra por invocarla en cada
  page).
- `getStoreHoursData` (`store-hours.model.ts`) y `getMaxPrepMinutes`
  (`catalog.model.ts`), sin cambios, ahora solo importados desde
  `horarios/page.tsx`.

No hubo que tocar `src/controllers/`, `src/models/` ni
`src/views/admin/shell.tsx` — el Slice A ya había dejado `revalidatePath`
apuntando a `'layout'` y no hizo falta ningún ajuste de mi lado ahí.

## Comportamiento visible para el test-engineer

- **`/admin/ajustes`** ("El local"): formulario con nombre, descripción,
  teléfono, WhatsApp, dirección + mapa, redes/canales. Validación Zod inline
  por campo (`aria-invalid`, `aria-describedby`, mensaje con `role="alert"`).
  Sin dirección cargada, aviso visible (no bloqueante) de que el cliente no
  sabrá dónde retirar. Guardar llama `updateStoreProfileAction`; error de
  servidor mapea a `setError` por campo vía `result.fieldErrors`; éxito
  dispara toast "Guardaste los datos del local". Errores de campos listados
  en la `SaveBar` al pie, con los nombres legibles de `FIELD_LABELS`.
- **`/admin/ajustes/pedidos`** ("Pedidos y envío"):
  - "Tomando pedidos" (`AcceptingOrdersToggle`, envuelto en el marco
    "se aplica al instante"): apagarlo abre `CancelScheduledOrdersDialog`
    con el conteo real de programados afectados; confirmar dispara
    `pauseScheduledNightAction` y refresca; cancelar deja el toggle en su
    valor anterior. Prenderlo no interrumpe nada.
  - "Permitir pago al retirar", pedido mínimo (`MoneyInput`), automatización
    (`Empezar a cocinar solo` / `Marcar listo solo`, con aviso de riesgo si se
    activa "Marcar listo solo"): estos sí viajan en el `useForm` y esperan
    "Guardar cambios".
  - "Envío propio": toggle general; si está prendido, aparecen costo, envío
    gratis desde, mínimo propio, minutos con/sin repartidores libres (con
    aviso si "sin repartidores libres" queda por debajo del normal), un
    ejemplo numérico en vivo, y `CourierCollectsPaymentField` (envuelto en el
    mismo marco "se aplica al instante"): cambia el switch pide un código de 6
    dígitos por mail vía `ConfirmWithCode`; solo editable si `role === 'owner'`
    (un encargado ve el control deshabilitado con el motivo explicado en el
    hint).
  - "Pedidos programados": toggle de programar-con-envío, deshabilitado si
    "Envío propio" está apagado (con el hint que lo explica); tope opcional
    por noche (checkbox + `DraftNumberInput`).
  - "Multiplicador de demanda": umbral y multiplicador, con ejemplo en vivo
    del ETA resultante.
  - Guardar llama `updateStoreOrderingAction`; mismo patrón de errores por
    campo y toast que "El local".
- **`/admin/ajustes/horarios`** ("Horarios"): sin cambios de comportamiento,
  es literalmente `ScheduleEditor` sin tocar, ahora en su propia URL y sin
  `SaveBar` (se guarda solo por RPC).
- **Nav de tabs**: tres `<Link>` con `aria-current="page"` en el activo,
  `min-h-11`, deep-link real (entrar directo a `/admin/ajustes/pedidos`
  funciona sin pasar por `/admin/ajustes` antes).
- **Aislamiento entre páginas**: cambiar un campo en "Pedidos y envío" y
  navegar a "Horarios" sin guardar no persiste nada (son dos `useForm`
  independientes en dos árboles de React distintos, no dos tabs de cliente
  sobre un solo formulario) — es la garantía central que pedía
  `00-architecture.md` y vale la pena que el test-engineer la ejerza
  explícitamente (ir a `pedidos/`, tocar un campo, navegar a `horarios/`,
  volver a `pedidos/` y confirmar que el campo volvió al valor persistido).

## Verificación

- `npx next typegen` (necesario: `layout.tsx` es la primera ruta con layout
  propio en `/admin/ajustes/*`, y sin regenerar `.next/types/routes.d.ts` el
  tipo `LayoutProps<'/admin/ajustes'>` no existe todavía — mismo motivo que
  el commit `50fcf19` ya documentó para CI) + `npm run typecheck` → limpio.
- `npm run lint` → limpio.

## Qué quedó afuera / follow-ups

- `ImmediateControl` es hoy privado a `ordering-form.tsx`. Si se necesita en
  otra página, subirlo a `fields.tsx` o `views/admin/shared/` en vez de
  copiarlo.
- No toqué `src/views/admin/catalogo/product-drawer.tsx` ni
  `src/views/shared/money-input.tsx`, que tienen comentarios mencionando
  `settings-form.tsx` por nombre (ya no existe). Quedan fuera de mi slice
  (no son míos), lo dejo anotado para quien los toque después.
- No encontré referencias a `updateStoreSettingsAction`/`StoreSettingsInput`
  en `tests/` ni en código vivo fuera de `store.schema.ts` (que conserva el
  schema base intacto a propósito, como fuente de los dos `.pick()`).

## Round de arreglos (`03-review.md`, tres hallazgos bloqueantes)

Sobre el mismo slice, rama `feat/ajustes-por-secciones`. Dueño exclusivo de
`ordering-form.tsx`, `schedule-editor.tsx` y `schedule-track.tsx` para esta
ronda; el agente de backend trabajó en paralelo sobre `store.schema.ts` /
`store.model.ts` / `admin.actions.ts` (sacó `acceptingOrders` de
`storeOrderingInputSchema` y del `.update()` de `updateStoreOrdering`, y
agregó `resumeAcceptingOrdersAction(storeId: number): Promise<ActionResult>`
en `admin.actions.ts` — nombre confirmado leyendo el archivo, coincide con
el que pedía el prompt de esta ronda).

### Arreglo 1 — el banner que mentía al prender "Tomando pedidos" (hallazgo #1)

`src/views/admin/ajustes/ordering-form.tsx`:

- `acceptingOrders` salió del `useForm` de `OrderingForm`: fuera de
  `storeToOrderingInput` (ya no arma esa clave) y de `FIELD_LABELS` (el
  `Record<keyof StoreOrderingInput, string>` deja de necesitarla porque el
  tipo ya no la tiene, del lado de backend).
- `AcceptingOrdersToggle` dejó de recibir `checked`/`onChange` desde un
  `Controller` de react-hook-form. Ahora administra su propio estado
  (`useState(initialValue)`, sembrado desde `store.acceptingOrders`) y las dos
  direcciones pegan directo al servidor:
  - **Apagar**: sin cambios de flujo — diálogo destructivo
    (`CancelScheduledOrdersDialog`) con preview real de programados afectados
    vía `previewScheduledNightAction`, y solo al confirmar corre
    `pauseScheduledNightAction`.
  - **Prender**: llama a `resumeAcceptingOrdersAction(storeId)` y el switch
    queda deshabilitado (`disabled={resuming}`) mientras la promesa está en
    vuelo, para que un doble tap no dispare dos reaperturas. Solo con
    `result.ok` se actualiza el `useState` a `true`, sale el toast de éxito y
    se llama `router.refresh()`. Si `result.ok` es `false`, el switch se queda
    en `false` (no se optimiza el valor) y sale un toast de error con
    `result.error`.
- Con esto el banner de `ImmediateControl` ("Se aplica al instante, no espera
  a 'Guardar cambios'") pasa a ser literalmente cierto en los dos sentidos, y
  el `useForm` general deja de poder pisar el campo con un valor viejo si
  otra pestaña/dispositivo pausó o reabrió el local mientras esta pantalla
  seguía abierta (el segundo agujero que señalaba el hallazgo).
- El JSX de "Pedidos" pasó de un `Controller name="acceptingOrders"` que
  envolvía `ImmediateControl` a `<ImmediateControl><AcceptingOrdersToggle
  storeId={storeId} currency={store.currency}
  initialValue={store.acceptingOrders} /></ImmediateControl>` directo, sin
  `Controller` de por medio.

**Spec para el test-engineer**: con `resumeAcceptingOrdersAction` mockeada
para devolver `{ ok: false, error: '...' }`, el switch de "Tomando pedidos"
tiene que volver a mostrarse apagado y aparecer un toast de error — nunca
quedar "prendido" visualmente sin que el servidor lo confirmó. Con `{ ok:
true }`, el switch pasa a prendido, sale un toast de éxito y se dispara
`router.refresh`. Mientras la promesa de `resumeAcceptingOrdersAction` no
resolvió, el checkbox subyacente tiene que estar deshabilitado (verificable
por el atributo `disabled`/`aria-disabled` del control).

### Arreglos 2 y 3 — foco huérfano al abrir un día / una excepción (hallazgos #2 y #3)

`src/views/admin/ajustes/schedule-track.tsx`:

- `DayBar` pasó a `forwardRef<HTMLButtonElement, …>` para reenviar el `ref`
  al `<button>` real. Es la única primitiva nueva que agregué en esta ronda:
  la necesita `WeekEditor` para poder devolver el foco a la fila del día
  cuando se cierra su panel (antes no había forma de referenciar ese botón
  desde afuera). `npm test -- schedule-track` (11 tests) sigue en verde tras
  el cambio.

`src/views/admin/ajustes/schedule-editor.tsx` (`WeekEditor`):

- El bug real del hallazgo #2 era de ALCANCE: el `querySelector('input,
  button')` corría sobre el `<div>` del panel entero, que incluye la
  cabecera con "Listo" — y ese botón va ANTES en el DOM que los
  `<input type="time">` de `RangeRow`. Reemplacé `openPanelRef` (apuntaba al
  panel completo) por `rangesContainerRef`, puesto solo en el `<div>` que
  envuelve la lista de `RangeRow` + "Agregar rango" + `CopyToControl` — ya
  sin la cabecera adentro. El selector quedó `'input[type="time"], button'`
  (no genérico `input, button`): prioriza el primer campo real y cae a
  "Agregar rango" como fallback razonable en un día recién abierto sin
  rangos todavía (ninguno de los dos hallazgos cubre ese borde
  explícitamente, pero dejarlo sin foco alguno era peor).
- Agregué el camino de vuelta: `dayTriggerRefs` (un `Map<number,
  HTMLButtonElement>` poblado por el `ref` callback de cada `DayBar` en
  reposo) + `previousOpenDayRef` para saber, cuando `openDay` pasa a `null`,
  a qué día devolverle el foco. El mismo `useEffect` que ponía el foco al
  abrir ahora cubre las dos direcciones: abre → primer campo real; cierra →
  el botón de la fila que lo abrió (nunca `<body>`).

`src/views/admin/ajustes/schedule-editor.tsx` (`OverrideRow`):

- Mismo patrón, adaptado: `formContainerRef` en el `<div>` que envuelve el
  formulario expandido, `triggerRef` en el `<button>` de la fila compacta
  (que solo existe cuando `!draft.isNew && !isOpen`), y un `useEffect([isOpen,
  draft.isNew])` que compara contra `wasOpenRef` para detectar la
  transición: `false → true` enfoca el primer campo real (`input[type=date],
  input[type=checkbox], input[type=time]`, en ese orden porque una excepción
  existente siempre tiene fecha ya cargada — el checkbox "Cerrado todo el
  día" o el primer horario son los primeros campos que de verdad se editan);
  `true → false` devuelve el foco al `<button>` de la fila compacta.
  `draft.isNew` sale temprano del efecto: una excepción recién creada
  siempre se ve entera (`isOpen` se ignora para ella, según el comentario ya
  existente en el tipo `OverrideDraft`), así que no hay transición
  reposo↔abierto que atender ahí — y de hecho, al guardarse o descartarse,
  React desmonta esa instancia entera (cambia de key `new-…` a la fecha, o
  desaparece de la lista), así que no había ningún foco previo que
  preservar.

**Spec para el test-engineer** (los dos arreglos comparten forma): con
teclado —Tab hasta la fila del día/excepción, Enter/Space para abrir—, el
foco tiene que terminar en el primer `<input>` editable del panel/formulario
recién expandido, nunca en el botón "Listo" ni huérfano en `document.body`.
Al cerrar ese mismo panel (botón "Listo" para un día; botón "Listo" para una
excepción existente), el foco tiene que volver al elemento que lo abrió (la
fila/botón compacto correspondiente), verificable con
`document.activeElement` en cada paso. Para una excepción recién creada
("Agregar excepción"), no aplica el chequeo de retorno de foco: se remueve
del árbol entero al guardar o cancelar.

## Verificación de esta ronda

- `npx next typegen && npm run typecheck` → limpio en los tres archivos de
  este slice. El único error de `tsc` en todo el repo es
  `tests/models/store-settings-split.model.test.ts:167` (`acceptingOrders`
  ya no existe en `StoreOrderingInput`), archivo de `tests/` que no es mío —
  es la paridad de schema que el propio prompt de esta ronda avisa que va a
  fallar hasta que el test-engineer lo actualice.
- `npm run lint` → limpio.
- `npm run build` → falla en el mismo paso de `tsc` que arriba (mismo
  archivo de test), nada en `src/`.
- `npm test` → 577 pasan, 143 se saltean sin Docker, 2 fallan: los dos son
  exactamente la paridad de schema (`store.schema.test.ts` y
  `store-settings-split.model.test.ts`) que el prompt dijo que iba a fallar
  y que no debía tocar. `tests/views/schedule-track.test.ts` (11 tests,
  cubre `DayBar`/`computeWeekAxis`/`formatAxisHour`) sigue en verde después
  de convertir `DayBar` a `forwardRef`.
