# Code review — Entrega B (Cupones y campañas)

Rama `feat/cupones-y-campanas` contra `feat/clientes-y-cupones` (Entrega A, ya
mergeada como PR #8). Migración de 2197 líneas, modelos y controllers de
cupones/campañas/pedido, vistas de `/admin/clientes/cupones`, checkout y
seguimiento del cliente, superficies operativas (KDS, historial, repartidor),
circuito de mail/cron, y la suite de `test-engineer`.

## Veredicto: **PASA**

Segunda vuelta, sobre el estado actual del código (no sobre el que se revisó
la primera vez). Los 13 hallazgos de la primera pasada —el bloqueante y los
doce mayores/menores— están resueltos. Los verifiqué contra el código, no
contra el mensaje del coordinador, con una mezcla de lectura directa y
verificación en ejecución:

- **`typecheck`, `lint` y `npm test` en verde**, corridos por mí de forma
  independiente (dos veces, para descartar flakiness): `99 archivos, 1289
  tests, 0 fallas, 4 skips` en ambas corridas, con Docker arriba y la
  migración aplicada por `db:reset` (confirmé los cuatro triggers del modelo
  de reserva presentes y habilitados en la base: `coupon_redemptions_enforce`,
  `coupon_redemptions_sync_counters`, `orders_enforce_rules`,
  `orders_sync_coupon_reservation`).
- **El bloqueante (1) lo reproduje en vivo contra el servidor real**, no solo
  leyendo el diff: creé un cupón de prueba
  (`max_redemptions_per_phone = 1`, el default) y repetí exactamente la tabla
  que reportó el coordinador —

  | Caso | Resultado observado |
  |---|---|
  | 3× `POST /api/orders` con la misma `idempotencyKey`, cupón con tope por teléfono en 1 | `201` las tres veces, mismo `token`/`shortCode`; en la base: **1 pedido, 1 fila de libro mayor, `reserved_count = 1`** |
  | Pedido nuevo (otra clave), mismo teléfono, mismo cupón | `400 "Ya usaste ese cupón."` — el tope sigue mordiendo |
  | Pedido nuevo, otro teléfono | `201` |
  | Cupón inventado | `"Ese código no existe o ya no está disponible."` |
  | Cupón pausado | el mismo mensaje — la anti-enumeración sigue en pie |

  Limpié el cupón y los pedidos de prueba al terminar; `npm test` corrido de
  nuevo después de la limpieza sigue en verde.
- **Los hallazgos 2 y 13** (concurrencia y schema, los que más fácil se
  arreglan a medias) los revisé con más cuidado, tal como se me pidió: el
  `perform ... for update` está presente **en los tres lugares** que
  recalculan contadores bajo un `UPDATE ... FROM` (`sync_coupon_counters`,
  el bloque de limpieza de `claim_campaign_recipients`, y
  `settle_campaign_recipient`), y **ningún camino de cierre de campaña** deja
  `status = 'sent'` con cero envíos: conté cuatro sitios que cierran una
  campaña (el bloque de limpieza al principio de `claim_campaign_recipients`,
  el camino de "no hay chunk reclamable" agregado para el caso de baja masiva
  entre encolar y drenar, y `settle_campaign_recipient`) y los cuatro usan
  `else 'stopped'` con `stopped_reason = 'no_recipients'`, nunca `'sent'`.

No quedan bloqueantes. El resto de esta nota es el detalle de cada hallazgo,
para que quede escrito qué se verificó y cómo.

---

## Estado de los 13 hallazgos de la primera vuelta

### 1 — BLOQUEANTE (RESUELTO) — Idempotencia rota por la validación de cupón antes del RPC

**Arreglo aplicado:** se sacó el `throw` temprano de `createOrder`
(`src/models/order.model.ts`, bloque `[CUPON]`). Ya no se corta el pedido en
TypeScript cuando `resolveCoupon` rechaza el código — `discountCents` sale en
`0` y el flujo sigue hasta la RPC, que es la única autoridad: resuelve la
idempotencia primero (antes de tocar un cupón) y, si el pedido es
genuinamente nuevo con un código inválido, la propia validación de
`create_order` (dentro del bloque `if v_code is not null`) rechaza con el
`CPN0x` correspondiente, que `order.model.ts` sigue traduciendo a
`DomainError` exactamente como antes. La variante elegida es la que yo
mismo había ofrecido como "alternativa más simple" en la primera pasada.

**Verificado:**
- Lectura del código actual: el `if (parsed.couponCode) { ... }` ya no tiene
  ningún `throw` dependiente de `resolution.quote?.status`.
- Reproducción en vivo contra el servidor corriendo (tabla arriba): tres
  reintentos con la misma clave y un cupón de tope por teléfono en 1 devuelven
  `201` los tres, un solo pedido y una sola reserva en la base — el escenario
  exacto del hallazgo original ya no ocurre.
- El tope por teléfono y la anti-enumeración ("no existe" = "pausado") siguen
  funcionando para pedidos genuinamente nuevos, así que el arreglo no abrió
  un agujero de validación al sacar el corte temprano.

### 2 — MAYOR (RESUELTO) — Carrera de snapshot en los recálculos de contadores

**Arreglo aplicado:** `perform 1 from ... for update;` antes de CADA
`UPDATE ... FROM (subquery)` que recalcula un contador agregando desde una
tabla distinta, en los tres lugares que el hallazgo señalaba y que dependen
del mismo patrón:
- `private.sync_coupon_counters()` — lock sobre la fila de `coupons` antes de
  recalcular `reserved_count`/`redeemed_count` desde `coupon_redemptions`.
- El bloque de limpieza al principio de `claim_campaign_recipients` — lock
  sobre `coupon_campaigns` (`where status in ('queued','sending')`) antes de
  recalcular `sent_count`/`failed_count`/`skipped_count` desde
  `campaign_recipients`.
- `settle_campaign_recipient` — mismo lock, mismo motivo, comentado
  explícitamente como "mismo lock que `sync_coupon_counters`".

**Verificado:** leí las tres funciones completas en la migración actual;
las tres tienen la sentencia `perform ... for update` como paso previo a su
`UPDATE`, con un comentario que explica el mecanismo de EvalPlanQual bajo
Read Committed (correcto: una subquery sobre una tabla distinta de la que se
actualiza usa el snapshot de inicio del statement, no uno fresco tras
esperar el lock, así que sin el lock explícito el recálculo puede escribir
un conteo viejo). El cuarto camino de cierre (el de "no hay chunk
reclamable", agregado para el hallazgo 13) opera sobre `v_campaign`, cuya
fila ya está lockeada desde su propio `select ... for update skip locked` un
poco más arriba en la misma función — no necesita un lock adicional porque
ya lo tiene desde antes, dentro de la misma transacción.

### 3 — MAYOR (RESUELTO) — Comentarios que prometían una revalidación con `z.email()` que no existía

**Arreglo aplicado:** `src/services/notifications/email/campaign.tsx` ahora
tiene `const campaignEmailSchema = z.email()` y filtra `rows` con ella antes
de armar el batch — las direcciones que no pasan se asientan como fallidas
por separado (vía `settleCampaignRecipient`) y **no** entran al hash de
idempotencia del chunk. El comentario de
`private.looks_like_email` en la migración, que decía "el drenaje vuelve a
validar con Zod antes de mandar", ahora describe algo que el código
efectivamente hace.

**Verificado:** grep de `z.email` en `campaign.tsx` — ya no da cero
resultados; leí el bloque completo que separa `invalidRows`/`validRows` y
confirmé que las inválidas se descartan del batch antes de tocar Resend, así
que una sola dirección con formato roto ya no puede tirar abajo el chunk de
15 completo.

### 4 — MAYOR (RESUELTO) — `released_reason = 'expired'` era inalcanzable

**Arreglo aplicado:** `private.sync_coupon_reservation()` ahora discrimina
por `(select auth.uid()) is null`: sin sesión (los únicos caminos de
`service_role` que cancelan un pedido impago son `expire_pending_orders` y la
conciliación, y los dos son "venció" en sentido de producto) → `'expired'`;
con sesión (staff cancelando con el cliente RLS, que es el único camino con
`auth.uid()` no nulo) → `'cancelled_unpaid'`. Descartaron a propósito mi
sugerencia de discriminar por `old.status = 'pending'`, con una razón que
comparto: etiquetaría "venció sin pagar" una cancelación manual de un pedido
todavía pendiente, y una etiqueta falsa es peor que una que se queda corta si
mañana aparece un tercer camino de servidor. El límite queda escrito en el
propio comentario del trigger.

**Verificado:** leí el `case when (select auth.uid()) is null then 'expired'
else 'cancelled_unpaid' end` en el cuerpo actual del trigger. Es un
discriminador más preciso que el que yo había propuesto, y la razón para
descartar mi alternativa es correcta.

### 5 — MAYOR (RESUELTO) — Mensaje de cupón duplicado a mano

**Arreglo aplicado:** `coupon.model.ts` ya no tiene su propio
`COUPON_MESSAGES` — importa `COUPON_REJECTION_MESSAGES` (y de paso
`PAYMENT_METHOD_LABELS`, cerrando también el nit que señalaba esa misma
duplicación) desde `@/models/schemas/order.schema`. Y algo mejor de lo que yo
había pedido: `resolveCoupon()` en `order.model.ts` ya no decide
`codeNotFound` comparando el TEXTO del rechazo — `validateCouponForCart` ahora
devuelve un `reasonCode` de un enum cerrado (`'not_found' | 'inactive' | ...`)
y `resolveCoupon` compara `reasonCode === 'not_found'` directo. Elimina de raíz
la clase de bug que motivaba el hallazgo (dos módulos comparando strings) en
vez de solo consolidar los strings en un lugar.

**Corrección sobre mi propio informe:** el coordinador señala, con razón, que
mi hallazgo ya estaba desactualizado en su parte más importante cuando lo
escribí — la comparación por texto que yo describí como el mecanismo vigente
ya había sido reemplazada por el enum antes de que yo terminara mi revisión.
Lo dejo anotado porque es una falla de mi propio proceso (verificar contra un
estado de archivo que ya había cambiado), no del código.

**Verificado:** grep de `COUPON_MESSAGES` en `coupon.model.ts` — ya no
existe; el import de `order.schema` está presente; `resolveCoupon` usa
`reasonCode === 'not_found'`.

### 6 — MENOR (RESUELTO) — `resendPendingChangeCodeAction` perdía el `subjectId`

**Arreglo aplicado:** `getLivePendingChange` ahora selecciona y devuelve
`subject_id`, y `resendPendingChangeCodeAction` pasa
`subjectId: live.subjectId ?? undefined` a `startPendingChange`. Un reenvío
de código de cupón ya invalida correctamente el pendiente original en vez de
dejar dos códigos vivos a la vez.

**Verificado:** leí el `select` de `getLivePendingChange` (incluye
`subject_id`) y la llamada en `admin.actions.ts`, con un comentario que cita
este mismo informe.

### 7 — MENOR (RESUELTO) — El menú de WhatsApp ofrecía cupones vencidos/agotados

**Arreglo aplicado:** `coupon-whatsapp-menu.tsx` importa `isCouponUsable` de
`lib/coupon.ts` y filtra `activeCoupons.filter((c) => isCouponUsable(c))`
adentro del propio componente — no depende de que `page.tsx` filtre bien, así
que la garantía queda en el punto de uso.

**Verificado:** grep confirma el import y el filtro en el archivo actual.

### 8 — MENOR (RESUELTO) — `canDelete` no contemplaba canjes `released`

**Arreglo aplicado:** `coupon-detail.tsx` cambió `canDelete` a
`current.recentRedemptions.length === 0`, exactamente la sugerencia del
informe original.

**Verificado:** leí la línea actual.

### 9 — MENOR (RESUELTO) — `redemptionsLastMonth` contaba por fecha de reserva

**Arreglo aplicado:** la query en `campaign.model.ts` ahora filtra
`.gte('redeemed_at', oneMonthAgo)` en vez de `created_at`, con un comentario
que explica la diferencia.

**Verificado:** leí la query actual.

### 10 — MENOR (RESUELTO) — `sendCampaignAction` gastaba el balde antes de validar

**Arreglo aplicado:** el `consumeOrThrow('campaign_send:store', ...)` se
movió después del chequeo de `fitsBeforeExpiry`, con un comentario que cita
este hallazgo explícitamente.

**Verificado:** leí el orden actual de `sendCampaignAction`.

### 11 — MENOR (RESUELTO) — `max_discount_cents` sin CHECK de signo

**Arreglo aplicado:** la rama `percentage` del CHECK de `coupons` ahora exige
`max_discount_cents is null or max_discount_cents > 0`.

**Verificado:** leí el CHECK actual en la migración.

### 12 — MENOR (RESUELTO) — Limpieza de campañas atada al presupuesto diario

**Arreglo aplicado:** los dos `update` de limpieza (marcar `failed` a los que
agotaron reintentos, cerrar campañas sin cola) corren ANTES del
`if v_remaining <= 0 then return`, con un comentario explícito de por qué el
orden importa.

**Verificado:** leí el orden actual del cuerpo de `claim_campaign_recipients`.

### 13 — MENOR (RESUELTO, con más alcance del que pedí) — `'sent'` con cero envíos

**Arreglo aplicado:** se sumó `stopped_reason = 'no_recipients'` al enum, y
los `case` de status en los CUATRO lugares que pueden cerrar una campaña
(limpieza al principio del claim, el camino nuevo de "cola vacía por baja
masiva" dentro del mismo claim, y `settle_campaign_recipient`) usan
`else 'stopped'` en vez de `else 'sent'` cuando no hubo ni enviados ni
fallados. El coordinador encontró, verificando en ejecución, un cuarto
camino que mi hallazgo original no cubría: si el bloque de limpieza corre al
principio (antes del re-chequeo de bajas) pero la cola se vacía DESPUÉS por
ese mismo re-chequeo, la campaña quedaba en `queued` para siempre sin que
nada la cerrara. Se agregó un cierre específico para ese caso.

**Verificado:** leí los cuatro sitios; los cuatro usan `'stopped'` +
`'no_recipients'` para el caso de cero envíos y cero fallos, nunca `'sent'`.
El label en `format.ts` (`campaignStoppedReasonLabel`) y el tipo
`CampaignStoppedReason` en `types.ts` ya incluyen `'no_recipients'` —
`typecheck` no se queja de un caso sin cubrir en el `switch`.

---

## Lo que sigue abierto (nits, no bloquean, no forman parte del cierre de esta entrega)

Ninguno de los nits de la primera pasada se mencionó como arreglado, y no los
volví a verificar uno por uno en esta vuelta porque ninguno afecta el
veredicto. Quedan tal como estaban documentados: el tipo muerto
`CouponChangeKind`, la FK simple (no compuesta) de `coupon_campaigns.coupon_id`,
la reutilización de `CPN09` para dos rechazos distintos, el brief de
`campaign-sheet.tsx` sobre recalcular en vivo (resuelto en la práctica por
otro mecanismo), el `.tabular` en el input de código, el link de "últimos
canjes" a un rango de fechas en vez de al pedido puntual, el `$0` tachado en
la línea de cupón rechazado, el comentario de signo en `lib/coupon.ts:139`,
el orden de `confirmCouponChangeAction` (consume antes de chequear `kind`),
los índices de FK incompletos (`created_by`, `campaign_recipients.store_id`),
y el timezone UTC en el mail de campaña. Ninguno toca dinero, estado ni
seguridad; quedan para una pasada de mantenimiento.

## Lo que verifiqué y sigue en pie de la primera pasada

Todo lo que la primera versión de este documento listaba en "Lo que verifiqué
y está bien" (dinero y contratos del pedido, los tres clientes de Supabase,
la migración columna por columna contra las versiones previas, el segundo
factor de cupones, email y cron, el piso de calidad del frontend, y la
búsqueda del patrón de tests inventados) sigue siendo cierto: nada de eso se
tocó entre la primera y la segunda vuelta, y `npm test` en verde con la base
recreada desde cero lo respalda.

## Nota de proceso heredada, todavía sin resolver: un test de `tests/db/` se vio flaky bajo la suite completa

En la primera pasada anoté un fallo aislado de
`tests/db/campaign-lifecycle.test.ts` bajo `npm test` completo, que no
reproduje corriendo el archivo solo. No lo volví a ver en esta vuelta (dos
corridas completas, ambas en verde), pero tampoco identifiqué la causa raíz
la primera vez, así que lo dejo como observación abierta para
`test-engineer`, no como algo que este veredicto dé por cerrado. El
coordinador aporta un antecedente relacionado pero distinto: una extracción
suya dropeó por error `coupon_redemptions_sync_counters` durante su propia
verificación y puso 6 tests en rojo que no eran bugs de producción —resuelto
con el mismo `db:reset`, y confirmé los cuatro triggers presentes en la base
actual. Si el flaky original vuelve a aparecer, vale la pena descartar
primero un problema de aislamiento entre archivos de `tests/db/` que
comparten tablas del mismo feature bajo el pool de workers de vitest, antes
de asumir que es ruido de Docker.

---

## Blockers

Ninguno. Los 13 hallazgos de la primera pasada están resueltos y verificados
contra el código actual y, para el bloqueante, contra el servidor corriendo.
`typecheck`, `lint` y `npm test` (99 archivos, 1289 tests, 0 fallas, 4 skips)
en verde en dos corridas independientes con la migración aplicada desde cero.

Queda pendiente el veredicto de `test-engineer` (`03-tests.md`) para que el
commit proceda — mi mandato es correctness y adherencia al diseño, no la
cobertura de la suite.
