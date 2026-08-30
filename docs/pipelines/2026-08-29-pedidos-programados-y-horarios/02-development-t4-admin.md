# T4 — Admin (Operate): horarios + pedidos programados

Slice frontend B. Implementado por `frontend-react-craftsman`, en paralelo con
T1 (backend horarios), T2 (backend pedido programado) y T3 (frontend vitrina).
Este documento es la bitácora de MI lane: `src/views/admin/ajustes/**`,
`src/views/admin/pedidos/**`, `src/views/admin/shared/**`, y las `page.tsx` de
`ajustes/` y `pedidos/`.

## Archivos nuevos

- `src/views/admin/shared/cancel-scheduled-orders-dialog.tsx` — el diálogo
  destructivo compartido (item 7 del shape), con `describeCancellationImpact()`
  exportada: arma las TRES piezas de información obligatorias (cuántos se
  cancelan, cuántos pagados y por cuánto, la frase de reembolso manual) en un
  solo lugar, para que los tres consumidores nunca digan cosas distintas.
- `src/views/admin/ajustes/schedule-editor.tsx` — editor semanal (7 filas,
  lunes→domingo en la UI, `dayOfWeek` interno 0=domingo) + calendario de
  excepciones por fecha, en el mismo archivo (mismo criterio del shaper: es
  una sola superficie).
- `src/views/admin/pedidos/scheduled-tray.tsx` — bandeja "Programados",
  agrupada por `scheduledFor`, montada arriba del historial existente.

## Archivos editados

- `src/views/admin/ajustes/settings-form.tsx`:
  - El toggle `acceptingOrders` se envolvió en un componente nuevo
    (`AcceptingOrdersToggle`, local a este archivo) que intercepta la
    transición a OFF: pide el preview (`previewScheduledNightAction`), abre el
    diálogo destructivo compartido, y solo tras confirmar llama
    `pauseScheduledNightAction` — recién ahí el campo del formulario pasa a
    `false`. Prender de vuelta sigue el camino normal (sin diálogo).
  - Hint del toggle actualizado al copy de re-encuadre: *"Es el freno de
    mano: se aplica encima del horario. Apagalo para cerrar ahora aunque el
    horario diga que estás abierto."*
  - Sección nueva "Pedidos programados": `scheduledDeliveryEnabled` (toggle,
    deshabilitado si `deliveryEnabled` es falso) y `scheduledCapacityPerNight`
    (checkbox "poner tope" + número, `null` = sin tope). Viajan por el
    `useForm`/`updateStoreSettingsAction` de siempre — no son destructivos.
  - `storeToInput()` y `FIELD_LABELS` suman las dos claves nuevas.
- `src/views/admin/pedidos/history-list.tsx`: `PAYMENT_TEXT_TONE` pasó a
  exportarse (antes era un `const` local) para que `scheduled-tray.tsx` use el
  mismo mapeo de tono de pago en vez de duplicarlo. **Cero cambios de
  comportamiento ni de layout** en este archivo — el historial sigue leyendo,
  agrupando y filtrando exactamente igual.
- `src/app/admin/(app)/ajustes/page.tsx`: monta `ScheduleEditor` debajo de
  `SettingsForm`, alimentado por dos lecturas planas directas de modelo
  (mismo criterio que `pedidos/page.tsx` con `getOrderHistory`):
  `getStoreHoursData(storeId)` (`store-hours.model.ts`, T1) y
  `getMaxPrepMinutes(storeId)` (`catalog.model.ts`, T1).
- `src/app/admin/(app)/pedidos/page.tsx`: suma `getScheduledOrders(storeId)`
  (`order.model.ts`, T2) en paralelo con `getOrderHistory`, y monta
  `ScheduledOrdersTray` arriba de un `PanelHeading title="Historial"` +
  `OrderHistoryList` sin tocar ninguna de sus props ni su lógica.

## Contratos consumidos (y supuestos donde el nombre no estaba fijado)

Corriendo en paralelo con T1/T2, varios de los archivos que consumo (
`src/lib/store-hours.ts`, `src/models/store-hours.model.ts`,
`src/controllers/admin.actions.ts`, `src/models/schemas/store.schema.ts`) NO
existían todavía en disco al momento de escribir este código. Implementé
contra el contrato escrito en `01-tasks.md` y contra lo que SÍ estaba fijado
en `src/models/types.ts` (que el hilo principal ya había actualizado):
`StoreHoursRange`, `StoreHoursOverride`, `StoreSchedule`, `StorefrontGate`
(nótese: en `types.ts` es una unión discriminada `{kind: ...}`, distinta de la
unión de strings que describía la v1 de `01-tasks.md` — usé la de `types.ts`,
que es la vigente), `Store.scheduling.{deliveryEnabled,capacityPerNight}`,
`Order.{scheduledFor,fireAt,scheduledNight}`.

Supuestos concretos que quedan a verificar en la integración (el hilo
principal instruyó que iba a ver errores de T1/T2/T3 y que no son míos —
documento acá exactamente cuáles paquetes de mi código dependen de qué nombre,
para que sea rápido de alinear):

1. **`saveStoreHoursAction(storeId: number, ranges: StoreHoursRange[]): Promise<ActionResult>`**
   — nombre y forma tal cual `01-tasks.md`.
2. **`saveStoreHoursOverrideAction(storeId: number, override: StoreHoursOverride): Promise<ActionResult>`**
   — asumí que recibe siempre un `StoreHoursOverride` completo (`date`,
   `isClosed`, `ranges`), nunca la forma unión `{date, remove:true}` que
   describía la v1 de `01-tasks.md`. Motivo: la migración que ya existe en
   disco (`20260829140000_scheduled_orders_and_hours.sql`) agregó una RPC
   SEPARADA `delete_store_hours_override(p_store_id, p_on_date)` — posterior
   al texto de `01-tasks.md` — así que asumí una action espejo:
3. **`deleteStoreHoursOverrideAction(storeId: number, date: string): Promise<ActionResult>`**
   — NO está nombrada en `01-tasks.md`. Si T1 la llamó distinto, o la plegó
   dentro de `saveStoreHoursOverrideAction` con un flag, el único lugar que
   hay que tocar es la función `handleRemove` dentro de `OverrideRow` en
   `schedule-editor.tsx`.
4. **`previewScheduledNightAction(storeId: number, night?: string): Promise<ActionResult<{count, paidCount, paidTotalCents}>>`**
   y **`pauseScheduledNightAction(storeId: number, night?: string): Promise<ActionResult<...>>`**
   — tal cual `01-tasks.md`. `ScheduledNightSummary` NO llegó a definirse en
   `src/models/types.ts` al momento de escribir esto (main thread no lo había
   agregado); mi código no importa ese tipo por nombre — define localmente
   `AffectedOrders = { count, paidCount, paidTotalCents }` en
   `cancel-scheduled-orders-dialog.tsx` y confía en compatibilidad
   estructural con lo que devuelva la action.
5. **Campos nuevos en `storeSettingsInputSchema` / `StoreSettingsInput`**:
   asumí `scheduledDeliveryEnabled: boolean` y
   `scheduledCapacityPerNight: number | null`, siguiendo la convención de
   nombres de columna que ya usa el resto del form (`deliveryFeeCents`, etc.)
   y evitando colisión con la clave `deliveryEnabled` ya ocupada por
   `store.delivery.enabled`. Si T1 los nombró distinto, se ajusta en
   `storeToInput()`, `FIELD_LABELS` y los dos `Controller` de la sección
   "Pedidos programados" de `settings-form.tsx`.
6. **`getStoreHoursData(storeId): Promise<StoreSchedule>`** en
   `store-hours.model.ts` y **`getMaxPrepMinutes(storeId): Promise<number>`**
   en `catalog.model.ts` — nombres tal cual el contrato de modelos en
   `01-tasks.md` (no el de controller, que también aparece listado ahí pero
   sin firma fija). Llamados directo desde `ajustes/page.tsx` — lectura plana
   sin nada que orquestar, mismo criterio que `pedidos/page.tsx` con
   `getOrderHistory`.
7. **`getScheduledOrders(storeId): Promise<Order[]>`** en `order.model.ts`
   (T2) — tal cual el contrato, ordenado por `scheduledFor`. Llamado directo
   desde `pedidos/page.tsx`.
8. **`lastOrderWarning()`** de `src/lib/store-hours.ts`: el contrato deja su
   forma de retorno "a criterio de T1". Para no bloquearme en una firma sin
   fijar, el explicador de lead time de Q1 **no la consume**: recalcula la
   advertencia localmente en `schedule-editor.tsx`
   (`computeLastOrderWarning()`), usando solo aritmética documentada con
   certeza (`opensAtMinute + durationMinutes`, sin módulo, para que el cierre
   más tardío de la semana se compare bien a través de la medianoche). Esto
   es una duplicación deliberada y acotada — el reviewer puede decidir si
   vale la pena refactorizar `schedule-editor.tsx` para consumir
   `lastOrderWarning()` una vez que su forma esté fija, sin que eso bloqueara
   esta entrega. El resultado visible es el mismo: el ejemplo de
   `01-tasks.md` (cierre 23:30, prep 25 min ⇒ pedido de las 23:29 sale
   23:54) da exactamente esos números con mi implementación.

## Decisiones de UX dentro del mundo ya decidido

- **El diálogo destructivo es UNO, parametrizado, en `views/admin/shared/`**
  (no en `views/shared/surfaces.tsx`, que es gramática de cara al cliente).
  Los tres usos (pausa desde Ajustes, cierre de fecha desde el calendario de
  excepciones, cancelación individual desde la bandeja) llaman al mismo
  `describeCancellationImpact()` con un `subject` distinto — nunca reescriben
  el mensaje.
- **Caso de 0 afectados**: el diálogo sigue abriéndose (para que el spinner de
  "calculando" se sienta inmediato y consistente), pero cambia de tono: título
  neutro, botón `variant="default"` en vez de `destructive`, label
  configurable (`safeLabel`). No hay una versión "sin diálogo en absoluto"
  para el caso de pausa: abrir siempre y resolver rápido a la variante liviana
  es más simple de razonar que una carrera entre "abrir el diálogo" y "ya
  sabemos que da 0, ni lo abrimos".
- **Cancelación individual (bandeja) no llama a `previewScheduledNightAction`.**
  El conteo para UN pedido ya está en pantalla (viene en la fila:
  `paymentStatus`, `totalCents`), así que `affectedFor(order)` lo arma en el
  cliente sin ida y vuelta al servidor. `loading` se pasa siempre en `false`
  para este caso.
- **Cerrar una fecha con programados adentro**: en `OverrideRow`, marcar
  "Cerrado todo el día" y tocar "Guardar excepción" dispara
  `previewScheduledNightAction(storeId, date)`. Si `count > 0`, al confirmar se
  llama primero `pauseScheduledNightAction(storeId, date)` (cancela SOLO esa
  noche, no toca `accepting_orders` — la firma con `night` definido es
  justamente el camino de "cierre de fecha", no el de pausa) y recién después
  `saveStoreHoursOverrideAction(..., {isClosed:true})`. Si `count === 0`, el
  diálogo se abre igual con la variante liviana (mismo componente, mismo
  camino de código, sin ramas especiales).
- **Ajustar rangos de una excepción, o quitarla (revertir al patrón), NO
  dispara el diálogo destructivo.** Está explícitamente fuera de alcance
  (`01-tasks.md`, "Fuera de alcance": *"cancelación automática al AFINAR
  rangos de un override (solo al cerrar la fecha — la UI advierte)"*). En
  `OverrideRow` agregué una nota inline bajo "Quitar excepción": *"Quitarla
  vuelve al horario habitual de ese día. Si había pedidos programados dentro
  de este rango, no se cancelan solos: revisalos en la bandeja de
  Programados."* — cumple la palabra "advierte" sin construir la lógica que el
  documento excluyó a propósito.
- **Overlap de horarios: validado en el cliente ANTES de llamar a la RPC**
  (`findWeekOverlap` para la semana, con el mismo desplazamiento circular
  ±10080 que usa `set_store_hours`; un chequeo lineal más simple para los
  rangos de una excepción, que no cruzan a otro día). La base sigue siendo la
  autoridad — esto solo adelanta el mensaje en castellano antes del viaje de
  red, como pide el criterio de aceptación #7 de T1.
- **Explicador de lead time**: se recalcula en vivo contra el DRAFT en
  memoria (no contra lo último guardado), así que cambiar un horario mueve el
  número antes de guardar — el dueño ve el efecto de lo que está tipeando.
- **Bandeja "Programados"**: no es una tabla densa (a diferencia del
  historial) — filas apiladas con divisor de día, acorde al shape ("chico por
  diseño: el horizonte es de 3 días"). Reusa `Price`, `PAYMENT_TEXT_TONE`
  (ahora exportado desde `history-list.tsx`), `EmptyState`. Un 409 al cancelar
  se trata como el KDS lo trata (`isConflict` de `src/lib/conflict.ts`): no es
  un error del usuario, se avisa y se refresca en vez de reintentar contra una
  fila vieja.
- **Targets de 44px**: todos los botones que agrego (borrar rango, cancelar
  fila de la bandeja, checkboxes envueltos en `<label>`) usan `size="icon"`
  (44px) o `min-h-11`, nunca `icon-sm` (28px) pese a que ese es el tamaño que
  usa el ABM de catálogo existente (`option-groups-editor.tsx`,
  `confirm-delete-button.tsx`) — no toqué esos archivos (no son míos) pero mi
  código nuevo no repite ese patrón, por la regla explícita de mi brief.

## Comportamientos visibles y flujos (spec para test-engineer)

Editor de horarios (`schedule-editor.tsx`, montado en `/admin/ajustes`):

- Semana vacía (sin rangos en ningún día) muestra el aviso neutro "Sin
  horarios cargados, tu local está siempre abierto" — no bloqueante, no rojo.
- Cada día admite 0 a 4 rangos; el botón "Agregar rango" se deshabilita al
  llegar a 4. Un día con 0 rangos muestra la etiqueta "Cerrado".
- Un rango cuya hora de cierre es menor o igual a la de apertura muestra el
  indicador inline "Cruza la medianoche" debajo de esa fila, sin bloquear
  nada.
- El explicador de lead time solo aparece si hay al menos un rango cargado en
  el draft; texto exacto con los números reales: "Se aceptan pedidos hasta
  las HH:MM. Tu producto más lento tarda N min, así que un pedido de las
  HH:MM sale a las HH:MM."
- "Guardar horario semanal" valida en el cliente (rangos incompletos,
  solapamiento circular) antes de llamar al servidor; un rango incompleto
  identifica el día en el mensaje de error. Éxito: toast + refresh.
- Calendario de excepciones: "Agregar excepción" agrega una fila en blanco
  (fecha editable hasta guardar); al guardar, la fecha queda fija y aparece
  "Quitar excepción" en su lugar. "Cerrado todo el día" oculta los rangos de
  esa fila.
- Guardar una excepción cerrada dispara el diálogo destructivo compartido con
  el conteo real de esa fecha; confirmar cancela y persiste el cierre; cancelar
  el diálogo no cambia nada.
- Quitar una excepción existente vuelve al patrón semanal sin diálogo, con una
  advertencia textual permanente sobre pedidos programados existentes.

Diálogo destructivo (`cancel-scheduled-orders-dialog.tsx`):

- Estados: cargando (spinner + título neutro), 0 afectados (tono no
  destructivo), N afectados con 0 pagados ("Ninguno está pagado todavía, así
  que no hay nada que reembolsar"), N afectados con M pagados (monto exacto +
  frase de reembolso manual con todas las letras). Error de confirmación:
  inline, el diálogo NO se cierra solo. Éxito: cierra y dispara `onConfirmed`.
- No se puede cerrar el diálogo mientras la confirmación está en curso
  (`pending`).

Toggle "Tomando pedidos" (`settings-form.tsx`):

- Apagar dispara el flujo de preview + diálogo destructivo compartido, sujeto
  "de esta noche". Prender de vuelta no dispara nada, es inmediato.
- Éxito del diálogo: el campo del formulario pasa a `false`, toast de éxito,
  `router.refresh()`. El resto del formulario general (nombre, dirección,
  etc.) sigue intacto y no se envía como parte de este flujo.

Sección "Pedidos programados" (`settings-form.tsx`):

- Toggle de envío programado deshabilitado mientras `deliveryEnabled` es
  falso, con nota explicando por qué.
- Tope por noche: checkbox "Poner un tope..." alterna entre "sin tope" (texto
  explicativo) y un input numérico (mínimo 1). Viaja con el submit general.

Bandeja "Programados" (`scheduled-tray.tsx`, montada en `/admin/pedidos`):

- Sin programados: `EmptyState` acotado a la sección; el historial de abajo
  sigue mostrando contenido normalmente.
- Agrupado por día de `scheduledFor` ("Hoy", "Mañana", o nombre del día),
  nunca por `createdAt`.
- Cada fila: código, ícono de moto si es delivery, cliente, hora pactada,
  hora de entrada a cocina (atenuada), estado de pago (texto con punto, mismo
  tono que el historial), total, botón cancelar (44px).
- Cancelar abre el diálogo compartido parametrizado a un solo pedido (conteo
  siempre 1, sin llamada al servidor para calcularlo). Confirmar llama
  `updateOrderStatusAction({status:'cancelled'})`; éxito saca la fila de la
  lista y refresca; error se muestra inline sin cerrar el diálogo; un 409 se
  trata como resuelto (toast "Otro operario ya lo actualizó primero...",
  refresco), igual que el tablero de cocina.
- El historial (`OrderHistoryList`) debajo no cambió ni una línea de su
  lógica ni de sus props.

## Accesibilidad

- Todas las etiquetas de input tienen `<Label htmlFor>` (visible o `sr-only`
  según el contexto) o `aria-label` explícito en los botones icon-only.
- Errores de validación con `role="alert"`.
- "Programados" e "Historial" son dos `PanelHeading` (`<h2>`) independientes,
  landmarks separados para navegación con lector de pantalla.
- Ningún control interactivo nuevo queda por debajo de 44px.

## Qué NO toqué

`src/views/admin/kds/**`, `src/app/admin/(app)/page.tsx`, `views/shared/**`,
`views/storefront/**`, `src/controllers/**`, `src/models/**` (solo los
importo, como indica el brief), `supabase/**`. No corrí `npm install`, no
toqué migraciones.

## Verificación

- `npx tsc --noEmit`: cero errores en los archivos de este slice. Errores
  restantes en el árbol (p. ej. `src/models/platform.model.ts` sin el campo
  `scheduling` en `PlatformStoreRow`) son de T1/T2, no de este slice.
- `npx eslint` sobre los directorios de este slice: limpio.
- No corrí `npm test` ni escribí tests — el test-engineer es dueño de
  `tests/`.

## Follow-ups para el hilo principal / reviewer

1. Alinear los 6 supuestos de nombres/formas listados arriba contra lo que T1
   efectivamente expuso en `admin.actions.ts` y `store.schema.ts`.
2. Si `ScheduledNightSummary` se termina agregando a `src/models/types.ts`,
   conviene que `AffectedOrders` (en `cancel-scheduled-orders-dialog.tsx`) se
   vuelva un alias de ese tipo en vez de una definición estructural paralela.
3. Evaluar si `computeLastOrderWarning()` (duplicado en `schedule-editor.tsx`)
   debería reemplazarse por la `lastOrderWarning()` de T1 una vez que su forma
   esté fija, para no mantener la misma aritmética en dos lugares.

---

## Post-review: arreglos aplicados (03-review.md)

El code-reviewer corrió sobre la rama completa y encontró tres cosas
referidas a este slice (`M3`, `m3`, `m5`). Estado de cada una:

### M3 — CORREGIDO: `computeLastOrderWarning` comparaba "más tardío" con el peso de día equivocado

`src/views/admin/ajustes/schedule-editor.tsx`. El bug real: la función
comparaba los cierres usando `dayOfWeek` crudo (`Date#getDay()`, 0=domingo)
como peso del día en la cuenta lineal (`dayOfWeek * 1440 + ...`). Como domingo
vale 0, un local abierto solo sábado 18:00–02:00 y domingo 10:00–22:00
mostraba "se aceptan pedidos hasta las 02:00" (el cierre de sábado) cuando el
cierre real más tardío de esa semana es domingo 22:00 — domingo, al pesar 0,
se leía como "el día más temprano" en vez del último día que el dueño mira en
la UI (que arranca la semana en lunes).

**Arreglo**: se remapea `dayOfWeek` a un índice lunes-primero
(`(dayOfWeek + 6) % 7`, que manda domingo a la posición 6) SOLO para decidir
cuál rango cierra más tarde. El `dayOfWeek` real que se guarda no cambia — el
remapeo es puramente para el orden de comparación de este cálculo. Verificado
a mano con el caso exacto del review (sábado 18:00–02:00 + domingo
10:00–22:00): ahora dan `latestClose` de domingo (9960 > 8760 de sábado) y
`closeMinuteOfDay = 22:00`, que es el resultado correcto.

Cubierto "por construcción": el remapeo hace que CUALQUIER combinación de
días compare en el mismo orden que ve el dueño (lunes→…→domingo), no un caso
particular parcheado — el bug era de raíz en la elección del peso, no en un
día específico.

No se migró a la `lastOrderWarning()` de T1 (alternativa que sugería el
review): sigue siendo deuda documentada más abajo en este mismo archivo (ver
"Follow-ups", punto 3) — el fix de M3 corrige la aritmética propia sin
depender de una firma que seguía sin fijarse al momento de este arreglo.

### m3 y m5 — NO son de este slice; no los toqué

Ambos hallazgos apuntan a archivos de **T3** (`src/views/storefront/**`):

- **m3**: `src/views/storefront/checkout-form.tsx` — el `now` del selector de
  horario no se refresca (`useMemo(() => new Date(), [])`).
- **m5**: `src/views/storefront/schedule-picker.tsx` +
  `src/views/storefront/schedule-lib.ts` — rama muerta ("No quedan turnos
  para este día" inalcanzable con la construcción actual de `buildScheduleGroups`).

Mi ownership exclusivo es `src/views/admin/ajustes/**`,
`src/views/admin/pedidos/**` y `src/views/admin/shared/**` — `views/storefront/**`
es de T3, y la regla del reparto ("ningún archivo tiene dos dueños... los `no
tocar` son vinculantes") me prohíbe editarlo aunque el fix sea chico. **Dejo
esto anotado explícitamente en vez de tocarlo en silencio**: ambos quedan como
deuda pendiente a resolver por T3 o por el hilo principal, no por mí. No hice
ningún cambio en `views/storefront/**`.

### Verificación después de los arreglos

- `npm run typecheck`: **verde**, cero errores en todo el árbol (Docker
  arriba, base reseteada con `20260829170000_scheduled_orders_and_hours.sql`,
  `database.types.ts` regenerado).
- `npx eslint` sobre los directorios de este slice: limpio.
- De paso, con `admin.actions.ts` y los modelos de T1/T2 ya en disco, confirmé
  que los 4 supuestos de nombres que había dejado documentados en la sección
  de arriba ("Contratos consumidos") coincidieron exactamente con lo que T1
  expuso: `saveStoreHoursAction`, `saveStoreHoursOverrideAction`,
  `deleteStoreHoursOverrideAction` (T1 la agregó como wrapper de conveniencia
  citando textualmente que es "la forma que la vista de T4 ya espera"),
  `previewScheduledNightAction`, `pauseScheduledNightAction`,
  `getStoreHoursData`, `getMaxPrepMinutes`, `getScheduledOrders`. También
  apareció `ScheduledNightSummary` en `src/models/types.ts` (T1 lo agregó con
  la forma que `01-tasks.md` ya especificaba) — aproveché para cerrar el
  follow-up #2 de la sección anterior: `AffectedOrders` en
  `cancel-scheduled-orders-dialog.tsx` ahora es
  `Omit<ScheduledNightSummary, 'night'>` en vez de una definición estructural
  paralela.
- No toqué el pre-chequeo de solapamiento del cliente en `OverrideRow`
  (`schedule-editor.tsx`) pese al aviso de que `set_store_hours_override`
  ahora también valida solapamiento/máximo de rangos del lado de Postgres: mi
  chequeo de cliente sigue siendo un subconjunto estrictamente más
  permisivo/temprano del mismo caso (bloquea ANTES de llamar a la RPC), así
  que no hay mensajes contradictorios — si mi pre-chequeo no lo frena, la RPC
  lo frena después y su mensaje se muestra tal cual (`setError(result.error)`).

## Follow-ups actualizados

1. ~~Alinear supuestos de nombres~~ — resuelto arriba, todos coincidieron.
2. ~~`AffectedOrders` como alias de `ScheduledNightSummary`~~ — resuelto.
3. Sigue pendiente: evaluar si `computeLastOrderWarning()` (schedule-editor.tsx)
   conviene migrarse a la `lastOrderWarning()` de T1 (`src/lib/store-hours.ts`)
   ahora que existe en disco, para no mantener la misma aritmética en dos
   lugares. No bloqueante — el cálculo propio ya está corregido (M3) y probado
   contra el caso del review.
4. **m3 y m5 del review quedan sin resolver, a propósito**: son de
   `views/storefront/**` (T3), fuera de mi ownership. Señalado acá para que no
   queden en silencio.
