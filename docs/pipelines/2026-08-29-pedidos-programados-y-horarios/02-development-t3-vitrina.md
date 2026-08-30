# T3 — Vitrina · dev log

Slice frontend A (`frontend-react-craftsman`). Cliente: `/[store]`, `/[store]/carrito`,
`/[store]/checkout`, `/[store]/producto/[id]`, `/pedido/[token]`.

## Archivos nuevos

- `src/views/storefront/schedule-lib.ts` — helpers puros de fecha/turno
  compartidos por las tres pantallas: `weekdayName`, `dayChipLabel`,
  `formatOpensAtShort`, `buildClosedSchedule`, `formatScheduledLabel`,
  `buildScheduleGroups` (+ tipo `ScheduleSlotGroup`). No viven en
  `src/lib/dates.ts` (de otro slice) porque son específicos de "hablarle al
  cliente de un turno", no formateadores genéricos. `buildScheduleGroups`
  agrupa los slots de `scheduleSlots()` por **noche comercial**
  (`commercialNightOf`), no por día calendario: un rango que cruza medianoche
  ("vie 18:00–02:00") se ve como un chip, no partido en dos por las 00:00.
- `src/views/storefront/schedule-picker.tsx` — el selector de horario del
  checkout: chips de día (grupo de botones toggle, `role="group"` +
  `aria-pressed`, NO `role="tablist"`/`role="tab"` — es un filtro de qué
  grupo se mira, no un widget de pestañas, y no quise prometer el contrato de
  teclado con flechas que ARIA Tabs implica sin implementarlo) y una grilla
  de pastillas de 15 en 15 minutos con radios reales (`RadioGroup`/
  `RadioGroupItem` de shadcn, target = la pastilla entera, radio visualmente
  `sr-only` — el `<label>` nativo que envuelve un `<button role="radio">`
  reenvía el click igual, `button` es "labelable" por el spec de HTML, así
  que no hace falta JS para el hit-target). Es específico de este único
  consumidor: no encaja en `CategoryChip` (categorías de carta) ni en
  `OptionRow` (opciones con precio) — no se sumó a `views/shared/surfaces.tsx`
  por eso, tal como pedía el brief.

Ninguna primitiva se agregó a `views/shared/surfaces.tsx`: el shape ya había
concluido que la vitrina no necesitaba ninguna nueva, y se confirmó al
implementar.

## Archivos modificados

- `src/views/shared/states.tsx` — `ClosedNotice` gana un prop opcional
  `schedule: { message, href }`. Presente SOLO para `closed_by_hours`
  (nunca por heurística sobre texto): pinta el aviso de dos líneas + CTA en
  pastilla ("Programar pedido"). Sin `schedule`, es pixel-idéntico al banner
  de una línea de siempre — usado tal cual para `suspended`/`no_payment`/
  `paused`.
- `src/app/[store]/page.tsx` — computa `storefrontGate()` una vez (antes
  computaba `canTakeOrders()`), deriva `isOpenNow = gate.kind === 'open'`
  para el hero/ETA, y pinta el `ClosedNotice` con la variante de horario
  solo para `closed_by_hours` (con `buildClosedSchedule` + el href de
  `/checkout` resuelto con `storeBasePath()` sobre el header `Host`, mismo
  patrón que ya usaba `checkout/page.tsx`).
- `src/app/[store]/checkout/page.tsx` — el corte pasó de
  `!canTakeOrders(store)` a `gate.kind !== 'open' && gate.kind !==
  'closed_by_hours'`: los tres estados de precedencia superior siguen
  cortando en el mismo `EmptyState` de siempre (pixel-idéntico), pero
  `closed_by_hours` deja pasar a `CheckoutForm` con `forced` y `opensAt`
  nuevos, más `timezone`, `schedule` y `scheduledDeliveryEnabled`.
- `src/app/[store]/carrito/page.tsx`, `src/app/[store]/producto/[id]/page.tsx`
  — mismo patrón: la page computa el gate y pasa un booleano `blocked`
  (`true` solo para los tres estados que de verdad bloquean) a
  `CartView`/`ProductDetailView`. `closed_by_hours` YA NO bloquea armar
  carrito ni sumar productos: la decisión ahora/programar quedó exclusiva
  del checkout.
- `src/views/storefront/cart-view.tsx`, `src/views/storefront/product-detail.tsx`
  — renombraron su prop de disponibilidad (`acceptingOrders`/cálculo interno
  con `canTakeOrders(store)`) a un `blocked: boolean` que la page ya resuelve.
  Comportamiento idéntico para los tres estados que bloqueaban antes;
  `closed_by_hours` ahora se comporta como "abierto" en estas dos pantallas.
- `src/views/storefront/store-hero.tsx` — sin cambio de comportamiento, solo
  el comentario del prop `acceptingOrders` (ahora documenta que viene de
  `storefrontGate().kind === 'open'`, no de `canTakeOrders`).
- `src/views/storefront/checkout-form.tsx` — el cambio grande:
  - Props nuevas: `timezone`, `schedule: StoreSchedule`,
    `scheduledDeliveryEnabled`, `forced: boolean`, `opensAt: string | null`.
  - Panel nuevo "Cuándo lo querés", entre "Cómo lo recibís" y "Tu pedido"
    (el lead depende de nada del delivery — ver más abajo — pero el orden
    del brief se mantuvo igual por legibilidad del flujo).
  - Segmento "Para ahora"/"Programar" (mismo patrón `Label`+`RadioGroupItem`
    bordeado que ya usan los otros bloques). No se dibuja si `forced`:
    programar es la única rama, con un aviso de por qué arriba.
  - `SchedulePicker` alimentado por `buildScheduleGroups()` — se espera a
    que la cotización (`useCheckoutQuote`) esté `ready` antes de pintar la
    grilla (necesita `fullNights` para no ofrecer una noche llena), mostrando
    mientras tanto "Buscando horarios disponibles…".
  - `scheduledDeliveryEnabled && delivery.available` decide si programar +
    delivery es una combinación válida (`available` de `buildDeliveryQuote`
    ya excluye "sin repartidores activos", así que cubre el "≥1 repartidor
    activo" de Q2 sin pedir un dato nuevo a la cotización). Si el cliente
    tiene delivery elegido y la combinación no es válida, se avisa inline y
    se bloquea el submit — sin perder la selección de horario si vuelve a
    pickup.
  - El primer slot posible se precarga solo cuando `forced` (menos toques
    para "quiero pedir para cuando abran"), vía un efecto que corre una sola
    vez que la cotización trae los grupos.
  - `scheduledFor` (ISO, el instante que eligió — nunca hora de pared) se
    suma al `POST /api/orders` existente solo cuando corresponde.
  - Error del servidor con `field: 'scheduledFor'` (noche llena, slot
    inválido, lead corto) se pinta con el mismo `fieldErrors`/`formError` de
    siempre; el foco va al encabezado de la sección (no hay un `<input>`
    propio al que llevarlo) — `tabIndex={-1}` + anillo de foco visible
    (`focus-visible:ring-3`), no un `outline-none` mudo.
  - El botón primario suma la hora al texto cuando hay pago en el local:
    "Confirmar pedido para las 21:30 · Pagás al retirar".
- `src/views/storefront/order-tracking.tsx` — `EtaHero`:
  - Nuevo branch para `scheduledFor` presente + `status` en `pending`/
    `confirmed`: muestra la hora pactada en absoluto (nunca cuenta
    regresiva) con "Confirmá el pago para reservar tu horario" (pending) o
    "Todavía no empezamos a prepararlo — arrancamos cerca de la hora que
    elegiste" (confirmed, el tramo largo que el enunciado pedía cuidar). La
    señal es la PRESENCIA de `scheduledFor`, no la ausencia de `etaMinutes`
    (que viene `null` desde la creación para todo programado, pero `etaAt`
    SÍ está seteado desde el arranque — sin este branch el efecto de cuenta
    regresiva ya existente disparaba igual y mostraba "4320 min").
  - `preparing` en adelante: sin cambios de código — converge solo, porque
    el efecto existente ya recalcula `minutesUntil(etaAt)` con
    `etaAt = scheduledFor`.
  - Corregido de paso (hallazgo del propio brief, no scope-creep): el copy
    de `cancelled` con pago aprobado decía "te reembolsamos
    automáticamente", que es falso — el reembolso de una cancelación
    (programada o no) es manual. Ahora dice "el local te contacta para el
    reembolso".
- `src/views/storefront/use-priced-cart.ts` — `PreviewOk` gana
  `fullNights?: string[]` (opcional en mi tipo local; T2 lo manda siempre
  como array, `?? []` en el consumidor cubre los dos casos).

## Contratos consumidos (de T1/T2, verificados contra el código real al cerrar)

- `src/lib/store-hours.ts` (T1): `storefrontGate`, `scheduleSlots`,
  `commercialNightOf`, `SCHEDULE_LEAD_MINUTES` — firmas exactamente como las
  fija `01-tasks.md`, verificadas leyendo el archivo real, no asumidas.
- `src/models/store-hours.model.ts` (T1): `getStoreHoursData(storeId)` —
  llamada DIRECTO desde las cuatro pages (lectura plana, permitido por
  CLAUDE.md: "una page puede llamar a un modelo directamente para una
  lectura plana").
- `src/models/types.ts` (hilo principal): `StorefrontGate` usa
  `closed_by_hours` (no `closed_can_schedule`, que es como lo nombraban
  `02-shape.md` y los briefs de superficie — `types.ts`, ya comprometido por
  T0, es la fuente de verdad y gana). `StoreSchedule` (no `StoreHoursData`,
  ídem). `Store.scheduling.{deliveryEnabled,capacityPerNight}`.
- `GET /api/orders` (T2, `checkout.controller.ts` + `route.ts`): la
  cotización devuelve `fullNights: string[]` — confirmado leyendo el código
  real de T2 antes de cerrar, coincide con lo que asumí al escribir
  `checkout-form.tsx`.
- `createOrderSchema` (T2): `scheduledFor: z.iso.datetime().optional()` —
  coincide con lo que mando desde el checkout.

## Desvíos deliberados de los briefs de superficie (documentados, no silenciosos)

1. **Lead time del selector: 60 minutos PLANOS, no
   `basePrepMinutes + delivery` del quote.** El brief de
   `checkout-form.tsx` (`.impeccable/surfaces/src-views-storefront-checkout-form-tsx.md`)
   dice que el lead "usa `basePrepMinutes` del quote... más los minutos de
   envío si el método es delivery". Eso contradice directamente Q11
   (`00-architecture.md` §2.2 y §10, `01-tasks.md` T2 criterio #2): el dueño
   decidió un piso PLANO de 60 minutos, sin fórmula, "a quien encuentre esto
   en seis meses: no lo arregles". Fui con la decisión bloqueada y
   documentada en tres lugares (arquitectura, tasks, y el propio
   `SCHEDULE_LEAD_MINUTES` que T1 escribió con el mismo comentario de "no
   convertir en fórmula") en vez del brief de shape, que quedó desactualizado
   en este punto puntual. Consecuencia práctica: la grilla de horarios NO
   necesita esperar a que la cotización calcule `basePrepMinutes` — solo
   necesita `fullNights`, así que se recalcula por `schedule`/`timezone`/
   `now`, no por cambios de método de entrega.
2. **Horizonte: 3 días, no 7.** El brief de `states.tsx` habla de un
   horizonte de 7 días para el caso "sin apertura calculable". La decisión
   vigente (Q5/Q10) es 3 días (`SCHEDULE_HORIZON_DAYS = 3` en
   `store-hours.ts`). El copy del degradado quedó sin nombrar un número de
   días, así que no hay que tocarlo si el horizonte cambia de nuevo.
3. **`buildScheduleGroups` agrupa por NOCHE COMERCIAL, no por día
   calendario.** Ninguno de los briefs lo especifica explícitamente para la
   UI (solo para el dominio); lo elegí porque es la unidad que la
   arquitectura ya invirtió en definir para el tope/la pausa/la bandeja, y
   agrupar por día calendario hubiera partido "viernes 18:00–02:00" en dos
   chips separados por las 00:00, rompiendo el modelo mental de "una noche".

## Comportamientos visibles para el test-engineer (spec)

**Vitrina cerrada por horario (`storefrontGate() === 'closed_by_hours'`):**
- `/[store]`: hero dice "Cerrado por ahora" (sin ETA), banner de dos líneas
  con "cierra por hoy — abre a las HH:MM" (si reabre hoy) o "está cerrada
  ahora — abre el {día} a las HH:MM" (si reabre otro día) o degradado sin
  CTA (sin apertura calculable), con botón "Programar pedido" que navega a
  `/checkout` (excepto en el caso degradado). La carta sigue completa y
  navegable.
- `/[store]/producto/[id]` y `/[store]/carrito`: SIN restricción — se puede
  agregar al carrito y avanzar, igual que con la tienda abierta.
- `/[store]/checkout`: NO aparece el segmento "Para ahora"/"Programar" —
  aviso fijo "El local está cerrado ahora — abre {resumen}. Elegí un
  horario para tu pedido." La grilla de horarios se precarga con el primer
  turno posible ya seleccionado (corregible). El botón de submit queda
  deshabilitado sin un slot elegido.
- `suspended`/`no_payment`/`paused`: sin cambios — mismo `ClosedNotice`/
  `EmptyState` bloqueante de siempre en las cuatro pantallas.

**Selector de horario (tienda abierta):**
- Default "Para ahora". Elegir "Programar" muestra chips de noche (Hoy/
  Mañana/nombre del día) y, para la noche activa, pastillas de horario de
  15 minutos (mínimo 44×44px cada una).
- Una noche sin ningún turno ofrecible (fuera de rango o antes del lead)
  muestra "No quedan turnos para este día"; una noche que llegó al tope de
  la tienda (`fullNights` de la cotización) muestra "No quedan turnos esta
  noche" — en los dos casos el CHIP sigue existiendo, no desaparece mudo.
- Delivery elegido + `scheduledDeliveryEnabled` en `false` (o sin
  repartidores activos): "Programar" queda inhabilitado con aviso inline;
  cambiar a retiro lo vuelve a habilitar sin perder el horario ya elegido.
- Confirmar con un horario elegido manda `scheduledFor` (ISO, UTC) en el
  `POST /api/orders`; sin horario elegido en modo "Programar" el submit
  queda deshabilitado.
- Rechazo del servidor (`field: "scheduledFor"` — noche llena, slot ya no
  válido, lead insuficiente): mensaje inline bajo la sección + foco movido
  al encabezado "Cuándo lo querés" (`tabIndex={-1}`, anillo de foco
  visible).

**Seguimiento de un pedido programado (`/pedido/[token]`):**
- `scheduledFor` presente + `status` `pending`: hora pactada absoluta +
  "Confirmá el pago para reservar tu horario" (nunca una cuenta regresiva).
- `scheduledFor` presente + `status` `confirmed`: hora pactada absoluta +
  "Todavía no empezamos a prepararlo — arrancamos cerca de la hora que
  elegiste".
- `scheduledFor` presente + `status` `preparing`/`ready`/`on_the_way`/
  `delivered`: comportamiento IDÉNTICO a un pedido inmediato (cuenta
  regresiva sobre `etaAt`), cero regresión de código en esa rama.
- `status === 'cancelled'` con `paymentStatus === 'approved'` (programado o
  no): "Ya habías pagado — el local te contacta para el reembolso" (ya no
  promete un reembolso automático).
- Pedido inmediato (`scheduledFor === null`): cero cambios de
  comportamiento, pixel a pixel.

**Accesibilidad:**
- `ClosedNotice` con horario: `role="status"`, CTA es un link real con
  nombre accesible propio ("Programar pedido").
- Chips de día: `role="group"` + `aria-pressed` (no `tablist`/`tab` — no se
  implementó navegación por flechas, así que no se prometió ese contrato).
- Pastillas de horario: `RadioGroup`/`RadioGroupItem` reales de Radix
  (navegación por teclado nativa del grupo), target = la pastilla entera
  (44px), avisos de noche vacía/llena con `role="status"`.
- Foco visible en el encabezado "Cuándo lo querés" cuando el servidor
  rechaza el horario (nunca `outline-none` sin reemplazo).

## Qué NO hice / dejé fuera

- No toqué `src/views/admin/**`, `src/models/**`, `src/controllers/**`
  (salvo importar), `src/lib/**`, ni `supabase/**` — todo lo que necesité de
  ahí ya lo habían entregado T0/T1/T2 al momento de cerrar este slice.
- No escribí tests (dueño: test-engineer).
- El caso "delivery programado con tienda cerrada por horario Y
  `scheduledDeliveryEnabled` en `false`" queda con un mensaje inline
  ("Este local todavía no programa pedidos con delivery...") pero sin una
  ruta de recuperación más elegante que "cambiá a retiro" — es un
  degenerado real (local sin delivery programado Y cerrado ahora), no algo
  que valga más UI.

## Verificación

`npm run typecheck`, `npm run lint` (repo completo) y `npm run build`
(repo completo, con el trabajo de los cuatro slices ya integrado) — los
tres verdes. El único error de tsc pre-existente es en
`src/models/platform.model.ts` (fuera de mi lane, `PlatformStoreRow` sin
`scheduling`) y no lo toqué.

## Arreglos post-review (`03-review.md`, m3 y m5)

### m3 — el "ahora" del selector no se refrescaba

`checkout-form.tsx`: `now` pasó de `React.useMemo(() => new Date(), [])`
(una sola vez) a un estado que se refresca solo con `setInterval` cada 30s
(mismo intervalo que ya usa el poll de `/pedido/[token]` en estado estable,
no uno inventado). Como `scheduleGroups` ya dependía de `now` en su
`useMemo`, la grilla se recalcula sola: los turnos que quedaron por debajo
del lead de 60 minutos desaparecen de la lista sin esperar el rebote del
servidor.

Sumé un efecto nuevo que invalida la selección si deja de estar en la
grilla recalculada (`scheduledIso` ya no aparece en ningún `slots`): la
descarta en vez de dejar que el cliente confirme un horario que el servidor
va a rechazar. En modo `forced` (tienda cerrada por horario), el efecto de
auto-selección existente reacciona solo y elige el nuevo primer turno
disponible — sin fricción extra. En modo libre, la selección queda vacía y
el submit se deshabilita hasta que el cliente elija de nuevo (no hay un
mensaje "tu horario venció" dedicado: es el mismo estado neutro de "todavía
no elegiste", que ya se comunica bien con la grilla visible y ningún chip
marcado).

### m5 — rama muerta en el selector de horario

Confirmado el análisis del review: con la construcción de `buildScheduleGroups`,
un grupo solo entra a la lista si tuvo al menos un slot crudo, así que
`slots.length === 0` y "no lleno" nunca coexisten — el campo `isFull` era
redundante con `slots.length === 0` y la segunda rama ("No quedan turnos
para este día") era inalcanzable. Elegí sacarla, no hacerla alcanzable: no
hay un estado real de "noche con horarios en el patrón semanal pero
ninguno ofrecible" que sea distinto de "noche llena", así que inventar una
condición para separarlas hubiera sido peor que unificar.

- `schedule-lib.ts`: `ScheduleSlotGroup` perdió el campo `isFull` (nadie lo
  leía después de este arreglo, y un campo sin lectores es la misma clase de
  trampa que la rama muerta — invita a asumir que existe una distinción que
  no existe). El comentario del tipo deja escrito el invariante para quien
  quiera reabrir esto.
- `schedule-picker.tsx`: un solo `if (active.slots.length === 0)` con un
  solo mensaje ("No quedan turnos esta noche"), documentado con el
  invariante de arriba.
- `checkout-form.tsx`: el auto-select de `forced` pasó de
  `scheduleGroups.find((g) => !g.isFull && g.slots.length > 0)` a
  `scheduleGroups.find((g) => g.slots.length > 0)` — la misma simplificación,
  mismo motivo.

### Contexto de T2 verificado, sin cambios necesarios

El cambio de semántica de `countScheduledByNight` (ahora cuenta todo pedido
no cancelado de la noche, entregados incluidos, para coincidir con lo que la
RPC valida) no tocó nada de T3: mi código siempre trató `fullNights` como
una lista opaca de noches-a-esconder, sin asumir en ningún lado qué estados
cuenta el servidor para llenarla. Revisado `schedule-lib.ts`,
`checkout-form.tsx` y `use-priced-cart.ts` — ninguno menciona `pending`/
`confirmed` en relación a `fullNights`. Nada que corregir de este lado.

### Verificación

`npm run typecheck` (repo completo, contra el schema real ya regenerado) y
`npm run lint` (repo completo) — los dos verdes. `npm run build` también
verde.
