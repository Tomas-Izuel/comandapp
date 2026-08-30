---
version: 1
slug: "src-views-storefront-order-tracking-tsx"
primary_target: "src/views/storefront/order-tracking.tsx"
related_targets: ["src/app/pedido/[token]/page.tsx","src/views/shared/order-status.tsx"]
---

# Seguimiento de un pedido programado

**Alcance y modo.** `src/views/storefront/order-tracking.tsx` (el componente
`EtaHero` en particular) y `src/app/pedido/[token]/page.tsx`. Modo **Operate**:
el cliente ya compró, ahora solo necesita saber qué está pasando con su pedido.

**Audiencia y trabajo.** Alguien que programó para dentro de 3 horas y abre el
link tres veces mientras espera: a los 5 minutos (recién pagó), a la hora
(nada cambió — y así tiene que ser), y 10 minutos antes de la hora pactada
(ahora sí quiere saber cuánto falta de verdad). Las tres visitas tienen que
leerse como "todo en orden", no como "¿se colgó?".

**El problema real que resuelve este brief.** `EtaHero` hoy decide qué mostrar
mirando si `order.etaMinutes`/`order.etaAt` son `null`. Para un programado,
`etaAt = scheduledFor` desde la creación (no es `null`), así que el efecto que
recalcula "cuánto falta" (`minutesUntil(etaAt)`) **ya se dispara** aunque
falten 3 días — sin un branch nuevo, un pedido programado para el sábado
mostraría *"4320 min"* en la tarjeta más grande de la pantalla. Ese es el bug a
prevenir, no una elección estética.

**Selected direction.** La señal de "es un programado" es la presencia de
`order.scheduledFor` (nuevo en `OrderPublicView`, contrato ya fijado en T0/T2),
no la ausencia de `etaMinutes`. Regla de qué mostrar, atada al **estado real**
del pedido — no a un umbral de minutos inventado, porque el estado ya marca
exactamente el momento en que esto converge con un pedido inmediato:

- `status` en `pending` o `confirmed` **y** `scheduledFor` presente: mostrar la
  **hora pactada en absoluto** (`formatDateTime` si es otro día, `formatTime` si
  es hoy), nunca una cuenta regresiva en minutos — por lejos que esté, por cerca
  que esté. Debajo, una línea de contexto que reencuadra la espera como normal:
  *"Todavía no empezamos a prepararlo — arrancamos cerca de la hora que
  elegiste."* Este es el tramo largo que el enunciado pide cuidar: confirmado
  pero quieto durante horas.
- `status` en `preparing` o después: la cocina ya tocó el pedido (pasó el
  `fire_at`), así que a partir de acá el comportamiento es **idéntico** al de un
  pedido inmediato — la cuenta regresiva existente (`remainingMinutes`,
  `minutesUntil(etaAt)`) sigue funcionando sin cambios, porque `etaAt` sigue
  siendo la hora pactada y en este tramo sí tiene sentido leerlo como "faltan N
  minutos".
- `status === 'pending'` sin pagar: se mantiene el aviso de pago que ya cuelga
  de `PaymentNotice` más abajo; el hero puede sumar una aclaración corta si
  `scheduledFor` está presente — *"Confirmá el pago para reservar tu
  horario."* — para que quede claro que el slot no está asegurado hasta pagar.

**Hallazgo a corregir de paso (no es scope-creep, se ejercita directo con este
feature).** La rama `status === 'cancelled'` dice hoy, si el pedido estaba
pagado: *"Ya habías pagado — te reembolsamos automáticamente."* Con la
cancelación de un programado desde `/admin/pedidos` (brief de la bandeja), el
reembolso es **manual** (el dueño lo gestiona a mano desde Mercado Pago) — este
texto pasaría a ser falso para exactamente el caso que este pipeline agrega. Es
el mismo componente para toda cancelación (inmediata o programada), así que
corregirlo acá evita que el cliente espere una devolución automática que no va
a llegar. Copy sugerido, sin prometer un mecanismo: *"Ya habías pagado — el
local te contacta para el reembolso."*

**Estados que tienen que existir.** Programado, `pending` sin pagar. Programado,
`confirmed` en espera larga (el caso central). Programado, `preparing` en
adelante (converge con inmediato, sin cambios de código en esa rama).
Programado, `cancelled` con pago aprobado (copy corregido). Pedido inmediato:
cero regresión — mismo comportamiento pixel a pixel que hoy.

**Copy (rioplatense):** *"Programado para hoy a las 21:30"* / *"Programado para
el sábado 30/08 a las 21:30"* (mismo criterio hoy/otro día que ya usa
`formatDayHeading` en el historial de admin, espejado al cliente). Línea de
contexto: *"Todavía no empezamos a prepararlo — arrancamos cerca de la hora que
elegiste."*

**Primitivas.** Ninguna nueva. Es lógica interna de `EtaHero`, que vive en este
mismo archivo (no en `views/shared/order-status.tsx`, que no se toca).
