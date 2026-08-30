# Slice — horarios (reposo del horario semanal como línea de tiempo)

**Agente:** frontend-react-craftsman · **Rama:** `feat/ajustes-por-secciones`

Brief consumido: `.impeccable/surfaces/src-views-admin-ajustes-schedule-editor-tsx.md`
(copia en `00-architecture-horarios.md`). No se reabrió: se implementó tal cual
está escrito, incluidas las tres objeciones no negociables.

## Qué se hizo

Reemplacé las siete tarjetas apiladas del horario semanal (~140px c/u, ≈1050px
para la semana) por siete pistas horizontales de ~52-60px con el horario
dibujado como barra sobre un eje derivado de los datos. Se agregó `Copiar a…`
para la edición y se compactó también el reposo de "Excepciones por fecha" a
una línea por fecha, como pedía el brief.

**Ni modelo, ni acciones, ni migración tocadas.** `StoreHoursData`, el RPC de
guardado y las Server Actions (`saveStoreHoursAction`,
`saveStoreHoursOverrideAction`, `deleteStoreHoursOverrideAction`,
`previewScheduledNightAction`, `closeStoreHoursDateAction`) se consumen
exactamente igual que antes.

### Archivos

- **Nuevo** `src/views/admin/ajustes/schedule-track.tsx` — la pista en sí:
  `computeWeekAxis`, `formatAxisHour` y el componente `DayBar` (fila en reposo:
  etiqueta + barra `aria-hidden` + horas en texto). Se extrajo a su propio
  archivo, como habilitaba el brief ("extraer la pista a su propio archivo si
  crece") — el cálculo del eje + el layout `@container` responsive ya era
  demasiada lógica nueva para mezclarla con la orquestación de estado que sigue
  viviendo en `schedule-editor.tsx`.
- **Editado** `src/views/admin/ajustes/schedule-editor.tsx` — `WeekEditor` pasa
  a mostrar `DayBar` para los seis días cerrados y el formulario de rangos de
  siempre (`RangeRow` + "Agregar rango", sin cambios) solo para el día abierto
  (`openDay`, estado único, `useState<number | null>`). Se agregó
  `CopyToControl` (nuevo, privado del archivo) y se compactó `OverrideRow` de
  "Excepciones por fecha" con la misma lógica de reposo/apertura
  (`isOpen`/`onToggle`, dueño ahora de `OverridesEditor` vía `openKey`). Se
  exportó el tipo `DraftRange` (lo necesita `schedule-track.tsx` para tipar
  `DayBar`'s props indirectamente vía `schedule-editor.tsx`, que es quien
  parsea y le pasa a `DayBar` ya minutos, no el draft crudo).

## El eje derivado y sus bordes

`computeWeekAxis` (en `schedule-track.tsx`) recibe la lista PLANA de rangos
válidos de toda la semana (sin `dayOfWeek`: es un solo eje "hora del día"
compartido por las siete pistas, no un timeline absoluto de 7×24h). Por rango
calcula `startHour = opensAtMinute/60` y, clave, `endHour = startHour +
durationMinutes/60` **sin módulo**: como `draftRangeToDuration` ya devuelve
`durationMinutes` > el resto del día cuando el rango cruza la medianoche (ej.
viernes 19:00–02:00 → `durationMinutes=420`), `endHour` sale naturalmente en
26 (02:00 del día siguiente) sin ningún caso especial. Eso es lo que hace que
el eje se estire solo hasta después de medianoche cuando corresponde.

- `start = floor(min de todos los startHour)`, `end = max(ceil(max de todos
  los endHour), start + 8)` — el span mínimo de 8h se resuelve estirando el
  final, nunca el principio (decisión no especificada en el brief: elegí
  extender el cierre porque es lo que garantiza que un local de un solo turno
  corto no ocupe toda la pista, sin tener que decidir un padding simétrico).
- **Semana vacía** → `computeWeekAxis([])` devuelve `null`. `DayBar` con
  `axis=null` no dibuja ningún segmento (el `ranges.map` está guardado detrás
  de `axis ?`) y no dibuja el marcador de medianoche; el aviso "siempre
  abierta" (`isEmpty`, sin cambios) se sigue mostrando arriba. Las siete filas
  se siguen mostrando (como antes) para poder tocarlas y cargar el primer
  rango — solo que sin pista dibujada, mientras `axis` sea `null`.
- **Un solo día cargado** → el span mínimo de 8h evita el eje degenerado
  (un rango de 1h no ocupa el 100% de la pista).
- El eje **se recalcula en cada tecla** (mismo `useMemo` con dependencia
  `[week]` que ya recalculaba el explicador de "Se aceptan pedidos hasta..."):
  mientras el dueño edita el viernes, las otras seis pistas (que comparten el
  mismo eje) se reajustan en vivo.
- Un rango a medio completar (`draftRangeToDuration` devuelve `null` por campo
  vacío) se filtra silenciosamente del eje y de los segmentos — no rompe nada,
  solo no aporta bar. El texto del reposo (`formatDaySummary`) usa los strings
  crudos del draft (`opensAt`/`closesAt`, siempre `HH:MM` o `''` porque el
  `<input type="time">` no permite otra cosa) con un fallback `--:--`, así que
  nunca queda en blanco.

### El marcador de medianoche

Se dibuja (línea de 1px, `aria-hidden`, color `bg-border`) solo si
`axis.start < 24 < axis.end` — es decir, si el eje efectivamente atraviesa la
medianoche, sea por un cruce real o por el padding del span mínimo. En este
segundo caso el marcador no "miente": 24 sigue siendo el límite real entre un
día y el siguiente en cualquier eje, sea o no que algo lo cruce.

## Mobile: `@container`, no breakpoint de viewport

`DayBar` usa el mismo patrón que ya existe en `product-card.tsx` y
`branding-form.tsx` (`@container` + `@min-[26rem]:`), no `sm:`/sirviendo por
viewport. El motivo es el mismo que en esos archivos: el ancho real
disponible es el de la FILA dentro del panel de ajustes (`--admin-max-form`
menos gutters, ≈640px), no el del viewport — un `sm:` de Tailwind (640px)
dispararía distinto según si hay sidebar o no. Por debajo de 416px de ancho de
fila (`@min-[26rem]`) la fila se apila: fila 1 = etiqueta + horas
(`justify-between`), fila 2 = pista a ancho completo (`basis-full`). Arriba de
eso pasa a una sola línea con `order-*` para reordenar sin duplicar el DOM:
etiqueta (~90px fijo) — pista (flexible) — horas (auto, a la derecha).

Verificado en el layout real de `--admin-max-form` (768px máx, ~640px de
contenido efectivo): a ese ancho la fila entra sobrada en una línea.

## Accesibilidad

- La pista es un `<div aria-hidden>`; el dato accesible es el `aria-label`
  explícito del `<button>` que envuelve toda la fila: `"{label}, {summary}"`
  (ej. `"Viernes, 19:00 a 02:00"`), literal al ejemplo del brief. `aria-label`
  pisa el contenido visible para el nombre accesible (spec ARIA), así que no
  hay doble lectura entre el `aria-label` y los `<span>` visibles.
- Toda la fila (no solo un ícono) es el `<button>`: 44px mínimo (`min-h-11`),
  cubre todo el ancho.
- **Foco al abrir un día**: `useEffect` sobre `openDay` busca el primer
  `input`/`button` dentro del panel recién montado (`ref` en el contenedor) y
  le da foco. Sin esto, tocar una fila con teclado dejaba el foco huérfano en
  un botón que la edición reemplazó en el DOM.
- `CopyToControl` usa `role="group"` + `aria-label` sobre la lista de días
  destino, y `aria-expanded` en el botón que la despliega.
- Los chips de "Copiar a…" son botones de tamaño **default** (44px), no `sm`
  como el resto de los botones secundarios del archivo — a propósito: son el
  target real que el dueño toca para elegir a qué día copiar, y el piso de
  44px de la tarea es no negociable. El botón que los despliega ("Copiar a…")
  sí sigue la convención existente del archivo (`size="sm"`, igual que
  "Agregar rango", "Cancelar", "Quitar excepción" — todos preexistentes, no
  tocados).

## Edición

- **Un solo día abierto a la vez**: `openDay: number | null` en `WeekEditor`.
  Tocar una `DayBar` llama `setOpenDay(day)`, que reemplaza cualquier otro día
  abierto (misma variable). El panel abierto tiene un botón "Listo" (no un
  chevron: texto explícito, más claro que un ícono solo) que vuelve a
  `openDay = null`.
- **`Copiar a…`**: reemplaza (no mezcla) los rangos del día destino con una
  copia de los del día abierto (nuevos `id` vía `randomId()`, ver
  `copyRangesTo`). Queda abierto después de cada click a propósito — replicar
  un horario a los siete días no debería obligar a reabrir el menú siete
  veces. Toast de confirmación por click (`Copiado a {Día}`).
- **Excepciones por fecha**: mismo patrón, dueño en `OverridesEditor`
  (`openKey: string | null`). Una excepción **nueva** (`draft.isNew`) siempre
  se ve entera — no hay nada que resumir todavía y el `<input type="date">`
  sigue nativo, sin cambios. Una existente arranca colapsada
  (`"{fecha}, {estado}"`, ej. `"12 de septiembre, Cerrado todo el día"`) y se
  abre al tocarla. Al guardar con éxito (`persistOpen` o el cierre destructivo
  vía `CancelScheduledOrdersDialog`) el `onSaved` del padre limpia `openKey`,
  así que vuelve sola al reposo — no hizo falta tocar la lógica de guardado en
  sí, solo el callback que ya existía.
- El diálogo destructivo de cerrar una fecha con programados adentro
  (`CancelScheduledOrdersDialog`, `confirmClose`) **no se tocó**: sigue siendo
  la misma acción única del servidor (m4 de `03-review.md` original).

## Color y tokens

Barra rellena: `bg-primary` (token del panel, no del tema del local — `/admin`
no inyecta marca). Canal/track: `bg-muted`, `rounded-pill` — mismo vocabulario
que ya usa `top-products.tsx` en el dashboard (`bg-muted` + `bg-chart-1` +
`rounded-pill`) para un patrón de barra similar; usé `primary` en vez de
`chart-1` porque acá la barra es un indicador binario de estado ("abierto en
esa franja"), no una magnitud relativa, y `chart-1` (`oklch(0.87 0 0)`) es
demasiado pálido contra el `--muted` de fondo (`oklch(0.97 0 0)`) para leerse
de un vistazo — el objetivo explícito del brief.

## Qué NO se tocó

- `saveStoreHoursAction`, `saveStoreHoursOverrideAction`,
  `deleteStoreHoursOverrideAction`, `previewScheduledNightAction`,
  `closeStoreHoursDateAction`: firmas y comportamiento idénticos.
- `CancelScheduledOrdersDialog`.
- La validación de solapamiento (`findWeekOverlap`, la de la excepción
  puntual) y el explicador de "Se aceptan pedidos hasta las..."
  (`computeLastOrderWarning`): mismos cálculos, sin cambios.
- `profile-form.tsx`, `ordering-form.tsx`, `fields.tsx`, `settings-tabs.tsx`,
  `location-map-field.tsx`, nada de `src/app/`, `src/models/`,
  `src/controllers/`.

## Lo que un futuro agente necesita saber para tocar esto

- Si `MAX_RANGES_PER_DAY` (4) cambia, `CopyToControl` no necesita tocarse: al
  copiar un día ya válido (≤4 rangos) a otro, el destino nunca puede superar
  el máximo.
- Si se agrega un octavo día o se cambia `DAY_ORDER`, `computeWeekAxis` sigue
  funcionando sin cambios: no conoce días, solo minutos del día.
- El `aria-label` de `DayBar` y de la fila compacta de excepciones está escrito
  para calzar con el ejemplo exacto del brief ("Viernes, 19:00 a 02:00"); si
  se cambia el separador visible (`"a"` → `"–"` por ejemplo) hay que decidir
  si el `aria-label` lo sigue o se mantiene con "a" por legibilidad hablada.

## Acceptance criteria para `test-engineer` (claves de `01-tasks.md` / brief)

- **Eje derivado**: con rangos en distintos días, el `left%`/`width%` de cada
  segmento coincide con `(rango - eje.start) / (eje.end - eje.start)`. Casos
  límite: semana vacía → sin pista, aviso "siempre abierta" visible; un solo
  rango corto (ej. 1h) → el eje mide al menos 8h (el segmento no ocupa el
  100%); un rango que cruza la medianoche (ej. viernes 19:00–02:00) → el eje
  se extiende más allá de las 24 y el marcador de medianoche es visible
  (`div` con `left` entre 0% y 100%).
- **La hora exacta sigue en texto**: cada `DayBar` expone el texto
  "HH:MM a HH:MM" (o "Cerrado") visible, no solo la barra.
- **Mobile apila**: con el contenedor de `DayBar` por debajo de ~416px de
  ancho, la pista (`aria-hidden`) queda en su propia fila a ancho completo,
  no comprimida junto a la etiqueta/horas. (Probable estrategia de test:
  medir `getBoundingClientRect` de la pista vs. de la etiqueta, o forzar el
  ancho del contenedor en JSDOM/Playwright.)
- **La pista no es interactiva**: el único elemento clickeable de la fila
  cerrada es el `<button>` completo (onClick abre el día); el `div` de la
  barra es `aria-hidden` y no tiene handlers propios.
- **Un solo día abierto a la vez**: abrir el día B mientras A está abierto dice
  que A vuelve a mostrarse como `DayBar` (no como formulario).
- **Foco al abrir**: al hacer click/Enter sobre una `DayBar`, el foco queda en
  el primer campo editable del panel que se abrió (no en el botón que
  desapareció).
- **`Copiar a…`**: copiar de un día con N rangos a otro día reemplaza (no
  concatena) los rangos del destino; el destino queda con exactamente los
  mismos horarios que el origen (ids distintos, valores iguales); toast de
  confirmación nombra el día destino.
- **Excepciones compactadas**: una excepción guardada arranca colapsada
  (`"{fecha}, {estado}"` visible); tocarla la expande al formulario completo
  con `<input type="date">` deshabilitado (no es `isNew`); guardar (o cerrar
  con el diálogo destructivo) la vuelve a colapsar sola. Una excepción recién
  agregada (`Agregar excepción`) se ve siempre expandida hasta guardarse.
- **El diálogo destructivo de cerrar una fecha con pedidos programados** sigue
  disparándose exactamente igual que antes (sin cambios de comportamiento,
  solo de dónde vive el trigger en el árbol).

## Verificación

`npx next typegen && npm run typecheck` → limpio. `npm run lint` → limpio.
`npm run build` → build de producción completo, sin errores, sin warnings
nuevos. El hook de `impeccable` corrió después de cada edición de
`schedule-editor.tsx` y `schedule-track.tsx`: "No deterministic design-quality
issues found" en ambos.
