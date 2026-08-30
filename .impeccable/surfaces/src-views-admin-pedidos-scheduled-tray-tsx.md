---
version: 1
slug: "src-views-admin-pedidos-scheduled-tray-tsx"
primary_target: "src/views/admin/pedidos/scheduled-tray.tsx"
related_targets: ["src/app/admin/(app)/pedidos/page.tsx","src/views/admin/pedidos/history-list.tsx","src/views/admin/pedidos/date-filter.tsx"]
---

# Bandeja de programados en Pedidos

**Alcance y modo.** Componente nuevo `src/views/admin/pedidos/scheduled-tray.tsx`,
montado desde `src/app/admin/(app)/pedidos/page.tsx` junto al
`OrderHistoryList` existente (que **no cambia**: sigue siendo el historial
100% de solo lectura, agrupado por `created_at`, con su propio filtro de
fechas y tabs de estado — ver `history-list.tsx`, `date-filter.tsx`). Modo
**Operate**.

**Audiencia y trabajo.** El mismo encargado del mostrador y el mismo dueño de
siempre, con una pregunta nueva que el historial no puede contestar: "¿qué
tengo programado para esta noche y las próximas?". El historial agrupa por
`created_at` — un pedido programado para dentro de 3 días **se creó hoy**, así
que aparecería hoy en el historial con una hora pactada muy distinta a la de
creación. Mezclarlo en esa tabla es mostrar el dato equivocado con la etiqueta
correcta.

**Selected direction — dónde va.** No son pestañas de un mismo bloque: son dos
secciones apiladas en la misma page, cada una con su propio `SectionHeading`
(sin kicker) — "Programados" arriba, "Historial" abajo (el título de página ya
es "Pedidos", así que estos dos encabezados son las subsecciones). Tabs
anidadas sobre tabs (el historial ya tiene sus propios chips de estado)
hubieran sido una jerarquía confusa; secciones apiladas dejan ver de un
vistazo lo que viene **y** lo que pasó, sin un click de por medio — y
"Programados" es chico por diseño (el horizonte es de 3 días, nunca cientos de
filas), así que no compite en altura con la tabla densa de abajo.

**Selected direction — la fila.** Mismo lenguaje visual que el historial
(`StatusPill` para pago, `Price`, hora en `tabular`), pero:
- Ordenado y agrupado por **`scheduledFor`**, no por `createdAt` — "Hoy",
  "Mañana", o el nombre del día (mismo criterio de `formatDayHeading`, pero
  proyectado hacia adelante en vez de hacia atrás; con horizonte de 3 días
  nunca hay más de 3-4 grupos).
- Cada fila muestra: código, cliente, **hora pactada** (`scheduledFor`,
  formateada con `formatDateTime`/`formatTime` según el día), **hora de
  entrada a cocina** (`fireAt` — dato operativo, secundario, tipografía más
  chica/atenuada: es información para el encargado, no para el cliente),
  estado de pago (mismo `PAYMENT_TEXT_TONE` que ya existe), y una acción de
  **cancelar**.
- Cancelar abre el mismo diálogo destructivo del brief de "pausar pedidos"
  (`cancel-scheduled-orders-dialog.tsx`), parametrizado a **un solo pedido**:
  *"Esto cancela el pedido de {cliente} para el {día} a las {hora}. Está
  pagado ($X). El reembolso lo gestionás vos desde Mercado Pago."* — mismas
  tres piezas de información, singular. La transición reusa
  `updateOrderStatusAction` (`kitchen.actions.ts`, sin tocar ese archivo) con
  `status: 'cancelled'`, mismo manejo de éxito/error/409 que ya usa el
  tablero de cocina para otras transiciones (toast de éxito, error inline, y
  un 409 legible: "Otro pedido ya lo canceló, se actualizó solo").

**Estados que tienen que existir.** Sin programados (EmptyState acotado a esta
sección — *"No hay pedidos programados"* — no la pantalla entera: el historial
de abajo sigue con contenido). Programados agrupados en 1 a 3-4 días. Cancelar
en curso (spinner en el botón de esa fila, no un overlay de página). Cancelar
con error (inline, el diálogo no se cierra). 409 al cancelar (otro operario ya
lo movió). El historial de abajo: **sin cambios de ningún tipo**.

**Accesibilidad.** Dos landmarks de sección (`SectionHeading` como `h2`) para
que un lector de pantalla pueda saltar entre "Programados" e "Historial" sin
tener que atravesar toda la tabla densa primero.

**Primitivas.** Ninguna nueva propia de esta bandeja — reusa `StatusPill`,
`Price`, `EmptyState` y el diálogo compartido del brief de pausar pedidos
(`src/views/admin/shared/cancel-scheduled-orders-dialog.tsx`).
