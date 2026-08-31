---
version: 1
slug: "src-views-storefront-order-tracking-tsx"
primary_target: "src/views/storefront/order-tracking.tsx"
related_targets: ["src/app/pedido/[token]/page.tsx","src/views/shared/order-status.tsx","src/views/storefront/transfer-panel.tsx"]
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

---

# El panel de transferencia y el aviso de pago con tres métodos

**Alcance.** `src/views/storefront/order-tracking.tsx` (el bloque de
`PaymentNotice` y el nuevo `TransferPanel`) y `src/views/shared/order-status.tsx`
(`PaymentNotice`). Sigue siendo **Operate**: el cliente ya compró, esto es
"qué está pasando con mi pago", el mismo trabajo que ya hacía esta pantalla
para pago online.

**Selected direction — dónde va el panel.** `TransferPanel` (nuevo, brief
propio en `transfer-panel.tsx`) se monta como un `Panel` más de esta página,
inmediatamente después del bloque de `PaymentNotice` y antes del desglose de
ítems — es la continuación natural de "así está tu pago" cuando ese pago
requiere una acción del cliente. Se renderiza con una sola condición:
`order.paymentMethod === 'transfer' && order.status === 'pending'`. Ese único
chequeo alcanza para las dos formas de que el panel deba desaparecer: pago ya
confirmado (`status` pasa a `confirmed` a la vez que `paymentStatus` pasa a
`approved`, en la misma acción del staff) y pedido cancelado — no hace falta
mirar `paymentStatus` por separado.

**`PaymentNotice` gana un tercer caso.** Antes: `in_store` vs. el label
genérico de `payment_status` para cualquier otra cosa (eso cubría "online"
razonablemente, pero para "transfer" mostraba "Pago pendiente" a secas, que no
dice qué hacer). Ahora tres ramas explícitas, resueltas por una función
(`paymentNoticeText`) y no por un ternario anidado en el JSX: `in_store` →
"Pagás al retirar"; `transfer` → "Transferí para confirmar tu pedido" o
"Estamos verificando tu transferencia" según si ya subió comprobante
(`transferReceiptUploadedAt`); cualquier otro → el label de `payment_status`
de siempre. El nuevo prop `transferReceiptUploadedAt` es opcional con default
`null`: el KDS (`order-card.tsx`, ajeno a este slice) sigue llamando al
componente sin pasarlo, y el comportamiento para online/in_store no cambia un
píxel.

**Por qué el pill y el panel no se pisan.** `PaymentNotice` se queda como el
resumen de una línea (lo que ya era); `TransferPanel` es la superficie de
ACCIÓN (CBU, monto, subida). Mostrar los dos no es redundante: uno dice "en qué
estás", el otro dice "qué tenés que hacer" — la misma separación que ya existe
en el producto entre cocina y dinero como "dos relojes" que nunca se infieren
uno del otro.

**Estados que tienen que existir (además de los ya documentados de
programados).** Transferencia recién creada, sin comprobante — panel completo.
Transferencia con comprobante ya subido — panel en su tramo terminal, pill
diciendo "verificando". Transferencia confirmada — ni pill ni panel (ambos
retornan `null`/no se renderizan). Transferencia cancelada — ídem. Pedido
online o en el local — cero cambio de comportamiento.

**Motion, targets.** Sin cambios respecto de lo ya documentado — el panel
nuevo entra ya montado con el resto de la página, sin revelado al hacer
scroll.
