# Pedidos programados y horarios — shape de superficies

Escrito por el shaper de superficies (no implementa código). Tarea: shapear las
7 superficies que el feature de horarios + pedidos programados toca, con
`impeccable shape`. Fuente de las decisiones: la ronda de decisiones pasada al
shaper, **posterior** a `00-architecture.md`/`01-tasks.md` y tomada como
autoridad donde difieren (ver discrepancia señalada en T4 más abajo).

`node .claude/skills/impeccable/scripts/context.mjs --target <path>` se corrió
una vez por superficie antes de escribir cada brief; no se corrió
`concept-seed.mjs` ni se reabrió la decisión de identidad (heredada de
`PRODUCT.md` y de los 4 briefs ya existentes en `.impeccable/surfaces/`). No
existe `DESIGN.md` todavía (el mundo visual vive documentado en los 4 briefs
existentes + `CLAUDE.md`), así que **no se cargó `new-work.md`**: la
composición de estas superficies no está materialmente abierta — son
extensiones de un mundo ya decidido, no una superficie nueva ni un reemplazo.

Los 6 briefs quedaron en `.impeccable/surfaces/`:

| # | Superficie del enunciado | Archivo del brief | primary_target |
|---|---|---|---|
| 1 | Vitrina cerrada por horario | `src-views-shared-states-tsx.md` | `src/views/shared/states.tsx` |
| 2 | Selector ahora/programar en checkout | `src-views-storefront-checkout-form-tsx.md` | `src/views/storefront/checkout-form.tsx` |
| 3 | Seguimiento de un programado | `src-views-storefront-order-tracking-tsx.md` | `src/views/storefront/order-tracking.tsx` |
| 4+5 | Editor semanal + calendario de excepciones | `src-views-admin-ajustes-schedule-editor-tsx.md` | `src/views/admin/ajustes/schedule-editor.tsx` (nuevo) |
| 7 | Diálogo destructivo "pausar pedidos" | `src-views-admin-ajustes-settings-form-tsx.md` | `src/views/admin/ajustes/settings-form.tsx` (existente) |
| 6 | Bandeja "Programados" en Pedidos | `src-views-admin-pedidos-scheduled-tray-tsx.md` | `src/views/admin/pedidos/scheduled-tray.tsx` (nuevo) |

Los ítems 4 y 5 del enunciado (editor de horarios + calendario de excepciones)
son **una sola superficie**: viven en la misma pantalla de Ajustes, mismo modo,
misma audiencia — separarlos en dos briefs hubiera sido shapear el mismo
formulario dos veces. El diálogo de pausar pedidos (ítem 7) sí queda aparte
porque es un componente distinto (un diálogo compartido, no una sección de
formulario) que además se reusa desde el calendario de excepciones.

---

## 1 — Vitrina cerrada por horario

**Modo:** Persuade (el visitante todavía decide si comprar acá).
**Jerarquía:** el `ClosedNotice` sigue siendo un banner de ancho completo bajo
el hero — no una interrupción, la carta sigue atrás y navegable. Gana una
segunda línea (cuándo abre) y un CTA en pastilla ("Programar pedido"), solo
para el estado nuevo `closed_can_schedule`. Los otros tres estados de la
precedencia (`suspended`/`no_payment`/`paused`) quedan **pixel-idénticos** a
hoy — sin CTA, sin próxima apertura.
**Estados:** cerrado con reapertura hoy · cerrado con reapertura otro día (≤7) ·
cerrado sin apertura calculable dentro del horizonte (degradado, sin CTA) · los
tres estados de precedencia superior, sin cambios.
**Primitivas:** ninguna nueva — variante de `ClosedNotice` (`states.tsx`) +
`Button`/pastilla existente.
**Copy:** *"{Tienda} cierra por hoy — abre a las {hora}. Podés ver la carta y
programar tu pedido."* / *"{Tienda} está cerrada ahora — abre el {día} a las
{hora}."* CTA: *"Programar pedido"*.
**Dependencia cruzada:** `checkout/page.tsx` hoy corta en seco con un
`EmptyState` para cualquier `!canTakeOrders()`; tiene que empezar a consultar
`storefrontGate()` para dejar pasar `closed_can_schedule` a `CheckoutForm` en
modo "solo programar" (detalle en el brief 2).

## 2 — Selector "para ahora" / programar en el checkout

**Modo:** Operate.
**Jerarquía:** nuevo `Panel` "Cuándo lo querés", ubicado **después** de "Cómo lo
recibís" (el lead time depende de los minutos de envío, que recién se conocen
una vez elegido el método) y **antes** de "Tu pedido". Segmento "Para ahora" /
"Programar" con el mismo patrón de `Label`+`RadioGroupItem` bordeado que ya usan
los otros bloques del formulario. Debajo, cuando se programa: chips de día
(hasta 3, snap horizontal) + grilla de pastillas de horario de 15 minutos
(radios reales, ≥44px, la fila entera es el target).
**Estados:** abierta (para ahora default) · `closed_can_schedule` (programar es
la única rama, sin segmento que elegir) · quote cargando (no pintar grilla
todavía) · noche llena o todo antes del lead (texto inline en el chip de ese
día, sin grilla vacía) · cambio de método de entrega a mitad de selección
(recalcular lead, conservar selección si sigue siendo válida) · error de slot
inválido al confirmar (mismo `formError`/`fieldErrors` de siempre, foco nuevo a
la sección de horario).
**Primitivas:** los chips de día/horario son específicos de este selector —
**no** encajan en `CategoryChip` (categorías de carta) ni en `OptionRow`
(opciones con precio). Recomendado: vive local a `checkout-form.tsx` o un
archivo hermano `schedule-picker.tsx` en `views/storefront/`. **No** se propone
sumarlo a `views/shared/surfaces.tsx` — un solo consumidor hoy.
**Copy:** encabezado *"Cuándo lo querés"*; segmento *"Para ahora"/"Programar"*;
noche llena *"No quedan turnos esta noche"*; botón primario agrega la hora al
texto que ya varía por método de pago (*"Confirmar pedido para las 21:30 ·
Pagás al retirar"*).

## 3 — Seguimiento de un pedido programado

**Modo:** Operate.
**Jerarquía:** sin cambios de layout — el cambio es de lógica dentro de
`EtaHero`. La señal correcta es la **presencia de `scheduledFor`**, no la
ausencia de `etaMinutes` (que ya viene `null` desde la creación para todo
programado, así que el efecto de cuenta regresiva existente se dispararía con
"4320 min" sin este branch).
**Estados:** programado + `pending` sin pagar (aclaración: *"Confirmá el pago
para reservar tu horario"*) · programado + `confirmed` en espera larga → hora
pactada en absoluto + *"Todavía no empezamos a prepararlo — arrancamos cerca de
la hora que elegiste"* (el tramo que el enunciado pide cuidar) · programado +
`preparing` en adelante → converge con el pedido inmediato, cero cambios de
código en esa rama · programado + `cancelled` con pago aprobado.
**Hallazgo colateral (no scope-creep, se ejercita directo con este feature):**
la rama `cancelled` dice hoy *"te reembolsamos automáticamente"*, y con la
cancelación de un programado el reembolso es **manual** — mismo componente para
toda cancelación, así que corregirlo acá evita prometerle al cliente una
devolución que no llega sola. Copy sugerido: *"Ya habías pagado — el local te
contacta para el reembolso."*
**Primitivas:** ninguna nueva.

## 4+5 — Editor semanal de horarios + calendario de excepciones (Ajustes)

**Modo:** Operate.
**Jerarquía:** siete filas lunes→domingo (el dato interno es 0=domingo,
convención `Date#getDay()`; la UI reordena, no el modelo), 0-4 rangos por día,
"Cerrado" como estado explícito. Rango que cruza medianoche se carga tal cual
(18:00→02:00) con un indicador inline —*"cruza la medianoche"*—, la traducción
al modelo la hace el `lib` (T1), nunca el formulario. Debajo, un explicador de
lead time en una sola línea, recalculado en vivo contra el cierre más tardío de
la semana y el `prep_minutes` real más alto del catálogo. Debajo de eso, la
lista de excepciones por fecha: fila = fecha + "cerrado todo el día" o rango(s)
propio(s), reusando el mismo componente de fila de rango que la semana — **no**
un calendario visual propio (`<input type="date">` nativo ya lo resuelve).
**Estados:** semana vacía → aviso neutro *"Sin horarios cargados, tu local está
siempre abierto"* (no bloqueante) · semana cargada 1-4 rangos/día · guardado en
curso/fallido (toast + error por día, mismo patrón que ya usa `SettingsForm`) ·
error del RPC (solapamiento, tope de rangos) legible junto al día que falla ·
lista de excepciones vacía · excepción con programados adentro → dispara el
diálogo destructivo compartido (item 7).
**⚠️ Discrepancia de contrato a resolver por el hilo principal:** tanto
`00-architecture.md` §2.4 como `01-tasks.md` ("Fuera de alcance") dejan las
excepciones por fecha explícitamente **fuera** del MVP de este pipeline; las
decisiones que me pasaron para este shape las dan por **decididas** y
posteriores a esos documentos. Shapeo la superficie tal como se me pidió, pero
**no hay tabla, RPC ni contrato de modelo para esto en T0/T1 todavía** — hace
falta que el hilo principal agregue ese contrato (una tabla hermana a
`store_hours`, o confirmar que sigue fuera de alcance y este brief queda en
espera) antes de que T4 pueda implementarlo.
**Copy `accepting_orders` (re-encuadre, §2.3):** el toggle sigue llamándose
"Tomando pedidos" (no se invierte el booleano), pero el hint pasa a: *"Es el
freno de mano: se aplica encima del horario. Apagalo para cerrar ahora aunque
el horario diga que estás abierto."*
**Primitivas:** recomendado extraer "fila de rango con borrar + agregar" a
`src/views/admin/shared/` si no existe ya un helper repetible ahí (revisar
`option-groups-editor.tsx` primero) — **no** en `views/shared/surfaces.tsx`.

## 6 — Bandeja "Programados" en `/admin/pedidos`

**Modo:** Operate.
**Jerarquía:** dos secciones **apiladas**, cada una con su propio
`SectionHeading` (sin kicker) — "Programados" arriba, "Historial" abajo — en
vez de pestañas sobre pestañas (el historial ya tiene sus propios chips de
estado; anidar tabs hubiera sido jerarquía confusa). El historial existente
(`OrderHistoryList`, `DateFilter`) **no cambia una línea**.
**Fila de "Programados":** agrupada por `scheduledFor` (Hoy/Mañana/día,
proyectado hacia adelante, nunca más de 3-4 grupos por el horizonte de 3 días),
muestra código, cliente, hora pactada, hora de entrada a cocina (`fireAt`,
tipografía secundaria — dato operativo, no del cliente), estado de pago (mismo
`PAYMENT_TEXT_TONE` de siempre) y acción de cancelar.
**Estados:** sin programados (`EmptyState` acotado a la sección, el historial
de abajo sigue con contenido) · 1 a 3-4 días agrupados · cancelar en curso
(spinner en el botón de la fila) · cancelar con error (inline) · 409 (otro
operario ya lo canceló, mismo mensaje que ya usa el tablero de cocina).
**Primitivas:** ninguna nueva propia — reusa `StatusPill`, `Price`,
`EmptyState` y el diálogo compartido del item 7.

## 7 — Diálogo destructivo "pausar pedidos"

**Modo:** Operate. Es el control de mayor radio de todo este trabajo.
**Jerarquía:** el toggle `acceptingOrders` deja de viajar mudo dentro del
`react-hook-form` general de Ajustes — apagarlo dispara, **en el momento**, un
diálogo (mismos primitivos de `@/components/ui/dialog` que ya usa
`ConfirmDeleteButton`) con el conteo recién calculado de programados de la
noche en curso sin disparar.
**Copy exacto (dado, no negociable):** *"Esto cancela 6 pedidos programados de
esta noche. 4 están pagados ($47.800). El reembolso lo gestionás vos desde
Mercado Pago."* — las tres piezas (cuántos se cancelan, cuántos pagados y por
cuánto, reembolso manual) van siempre y en ese orden.
**Estados:** conteo en 0 (sin fricción — apaga directo o diálogo liviano no
destructivo) · conteo > 0 con/sin pagados adentro · cargando el conteo (breve) ·
error al cancelar (inline, el diálogo no se cierra solo) · éxito (toast, toggle
apagado). Encender de vuelta nunca es destructivo.
**Reuso:** el mismo componente, parametrizado por la lista de pedidos
afectados, se dispara también al cerrar una fecha con programados desde el
calendario de excepciones (item 4+5) y al cancelar un programado individual
desde la bandeja (item 6, singular).
**Primitivas:** **un componente nuevo recomendado**,
`src/views/admin/shared/cancel-scheduled-orders-dialog.tsx` — admin-scoped, no
customer-facing. Es el único primitivo nuevo que este shape identifica como
necesario (los demás casos se resuelven componiendo lo que ya existe).

---

## Resumen de primitivas nuevas (para que el hilo principal fije el contrato)

1. **`src/views/admin/shared/cancel-scheduled-orders-dialog.tsx`** (nuevo,
   recomendado) — diálogo destructivo parametrizado por lista de pedidos
   afectados (conteo total, conteo pagado, monto pagado), reusado desde tres
   lugares: el toggle de pausar (item 7), el cierre de una fecha con
   programados (item 4+5) y la cancelación individual desde la bandeja (item
   6). Vive en `views/admin/shared/`, no en `views/shared/surfaces.tsx`.
2. **Posible helper "fila de rango repetible"** en `views/admin/shared/` si no
   existe ya (revisar `option-groups-editor.tsx`) — usado por la semana y las
   excepciones dentro de la misma pantalla de Ajustes. Recomendación, no
   mandato.

Ningún ítem de este shape pide sumar nada a `src/views/shared/surfaces.tsx`
(la gramática de cara al cliente): todo lo nuevo de la vitrina compone
`Panel`/`ActionBar`/`Price`/`OrderSteps`/`PaymentNotice`/`EmptyState` /
`ClosedNotice` existentes, y lo específico de horarios/slots queda local a sus
propios archivos por ahora.

## Discrepancia a resolver antes de repartir T4

**El calendario de excepciones por fecha (items 4+5, la mitad "excepciones")
no tiene contrato de backend en `01-tasks.md`.** Tanto `00-architecture.md`
§2.4 como el "Fuera de alcance" de `01-tasks.md` lo dejan fuera del MVP a
propósito; las decisiones que me pasaron para este shape lo dan por decidido y
las marcan como posteriores. Antes de que T4 pueda implementar esta mitad del
brief 4+5, el hilo principal necesita: (a) confirmar que la decisión realmente
cambió y agregar la tabla/RPC correspondiente a T0 y las firmas a T1, o (b)
confirmar que sigue fuera de alcance y que ese brief se implementa parcial
(solo el editor semanal, sin excepciones) en esta ronda. El brief queda escrito
para los dos casos — la sección de excepciones está claramente delimitada
dentro del documento para poder recortarla sin rehacer el resto.
