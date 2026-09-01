# T7B — Tests: cupones y campañas (Entrega B)

Escrito por el `test-engineer`. Único dueño de `tests/**`. No se tocó
`src/**` ni `supabase/migrations/**`. Los cuatro hallazgos que `code-reviewer`
señaló se convirtieron en tests rojos a propósito en la corrida original de
esta suite; el hilo principal y `senior-backend-engineer` ya los corrigieron
en `src/`/la migración, y esta corrida confirma que los cuatro tests pasan
ahora sin haberlos tocado — ver "Hallazgos" más abajo.

## Arranque: el bug que protegía el test viejo

`tests/controllers/confirm-pending-change.actions.test.ts` mockeaba
`kind: 'courier_collects_payment'` — un valor que **no existe** en
`PendingChangeKind` (`src/models/store-pending-change.model.ts`). Los kinds
reales son `payment_credentials`, `courier_payment_policy`, `bank_account` y,
desde esta entrega, `coupon`. El test pasaba porque `confirmPendingChangeAction`
tenía esa rama como default implícito: cualquier `kind` desconocido caía ahí y
escribía `stores.courier_collects_payment`.

**El código de producción ya estaba corregido cuando arranqué** (`admin.actions.ts:580-582`:
un `kind` sin manejar tira `Error`), así que los 2 tests que fallaban al inicio
fallaban contra el guard nuevo, no por seguir rotos. Corregí el mock al kind
real (`courier_payment_policy`) y agregué el test que faltaba: un `kind`
desconocido — usando `'coupon'` como caso concreto, que es real pero no tiene
rama en esta acción (los cupones confirman su propio segundo factor en
`marketing.actions.ts`) — tira y **no llama `admin.from('stores')` ni una
vez**. Ese es el test que habría atajado el bug antes de que la migración de
cupones lo hiciera explotable. `confirm-pending-change.actions.test.ts`: 5/5 verde.

Busqué el mismo patrón (kind/status inventado que solo pasa por un
fall-through) en el resto de la suite de cupones y campañas — `PendingChangeKind`,
`CouponStatus`, `CampaignStatus`, `CouponDiscountType`, los SQLSTATE
`CPN01..CPN10` — y no encontré otro caso: los tests nuevos usan los valores
reales, verificados contra la migración y contra `types.ts`/los schemas Zod.

## Cobertura nueva

### `tests/db/` (contra Postgres real, Docker arriba)

| Archivo | Tests | Qué cubre |
|---|---|---|
| `coupon-redemption-lifecycle.test.ts` | 26 | El off-by-one del trigger (`<` vs `<=`), la carrera del último uso con **concurrencia real** (5 conexiones simultáneas, gana exactamente una), `coupons_within_cap_check` resistiendo un intento de tocar el contador a mano, el ciclo reservar→confirmar (`delivered`) y reservar→liberar (`cancelled` sin `paid_at`), **`released_reason` discriminado por `auth.uid()`**: sin sesión (el barrido de `expire_pending_orders`/conciliación) da `'expired'`, con sesión de staff (`asAuthenticated`, `orders.grant update(status)`) da `'cancelled_unpaid'` — los dos casos, hermanos explícitos, ver la nota de la corrección más abajo — que un pago aprobado antes de cancelar NO libera, que `redeemed` es terminal, `unique(order_id)`, la FK compuesta cross-tienda, `draft`/`paused`/vencido/agotado (CPN02/CPN02/CPN04/CPN05), el tope por teléfono sobre el índice parcial (con cupo global holgado para no confundirlo con CPN05), `payment_methods` vacío/fuera de enum, el `23503` al borrar un cupón con cualquier fila en el libro mayor, y SELECT denegado a `anon`/`authenticated` en las 4 tablas nuevas. |
| `coupon-create-order-discount.test.ts` | 11 | `create_order` con cupón de punta a punta: aplicación correcta (percentage, floor), CPN09 (mismatch de monto y de total), CPN10 (descuento sin cupón), el clamp de un fijo mayor al carrito + el caso sin clampear (CPN09), el CHECK `orders_discount_within_subtotal_check` vía INSERT directo (bypasseando la función) con total positivo por el envío, idempotencia consumiendo **cero** usos extra, CPN08 (método de pago), inmutabilidad de `discount_cents`/`coupon_code_snapshot`, regresión sin cupón. |
| `coupon-percent-parity.test.ts` | 11 | Paridad `percentOfCentsDown()` (TS) ↔ `(subtotal*percent)/100` (Postgres, división entera real), 10 pares incluido el caso citado en la migración (833333, 15% → 124999, no 125000). |
| `campaign-segment-preview.test.ts` | 10 | Dedupe por casilla normalizada, direcciones rotas fuera de `willSend` pero dentro de `withEmail`, dados de baja fuera de `willSend` y dentro de `optedOut` (sin inflarse con bajas sin mail), los cuatro conteos en un escenario mixto, `top_n`/`min_spent`, `coupon_detail` con otro store (`42501`), con `service_role` sin sesión, cupón inexistente (`P0002`), `stats` contando solo `redeemed`, `recentRedemptions` con los tres estados. |
| `campaign-lifecycle.test.ts` | 15 | `enqueue_campaign` congelando la lista atómica y con dedupe, `chunk_index` respetando el presupuesto, `claim_campaign_recipients` chunk-completo-o-nada, presupuesto diario ya consumido, concurrencia real (dos claims simultáneos sin destinatario repetido), corte por cupón pausado/vencido/agotado, baja aplicada entre encolado y drenaje, cierre a `failed` cuando nadie salió, camino feliz a `sent`, un fallo simple que no cierra la campaña, y que `stopped` no vuelve a `sent` por un settle tardío. |
| `coupon-pending-change-and-detail.test.ts` | 17 | `coupon_detail` con el cliente de sesión (dueño ve, otro store da `42501`, `service_role` sin sesión falla), métricas solo `redeemed` vs. lista con los tres estados, `claim_store_pending_change` con `kind='coupon'` (código correcto, 5 intentos agotan), el enum real de `store_pending_changes_kind_check` parseado de `pg_constraint`, y el caso central: activar el cupón A y después el B **no invalida** el código de A (`subject_id`), mientras que un segundo pending del mismo A sí lo invalida. |
| `campaign-cleanup-and-no-recipients.test.ts` | 3 | Cobertura de los arreglos de `claim_campaign_recipients` posteriores a la primera corrida: la limpieza (destinatarios que agotaron reintentos → `failed`, campaña sin cola → cerrada) corre **aunque el presupuesto de hoy esté en cero**; una campaña donde nadie era elegible al drenar (todos de baja entre encolar y enviar) cierra en `stopped` / `stopped_reason = 'no_recipients'`, nunca en `sent`; y el hermano negativo — una campaña que solo espera la ventana de reintento (`p_retry_seconds`) sigue `sending`, no se cierra de prepo solo porque `v_chunk` salió `null` en ese tick. |

307 tests de `tests/db/` en total (33 archivos), todos verdes, corridos 3
veces consecutivas para descartar flakiness — la corrida original tuvo una
tanda de falsos rojos por una base local sucia (ver la nota de correcciones
más abajo), y por separado una corrida combinada tuvo un error de sintaxis
transitorio en un `docker exec` bajo carga, no reproducido en corridas
posteriores ni corriendo los archivos involucrados solos o en pares; ninguno
de los dos es un bug de los tests ni de la migración.

### Puro / mockeado (sin Docker)

| Archivo | Tests | Qué cubre |
|---|---|---|
| `tests/lib/coupon.test.ts` | 48 | `couponState` (los 5 derivados, orden de precedencia draft/paused sobre vencido), `discountForSubtotal` (floor, tope, clamp), `worstCaseCents` (null cuando no hay tope, para que la comparación de `requiresConfirmation` escale siempre), **`requiresConfirmation` con 22 casos** (los 18 numerados del brief más 4 de `paymentMethods`), incluidos los dos que más se prestan a error: pausar+escalar en la misma acción no pide código, y poner un tope en `null` sí. `campaignDaysNeeded`/`campaignLastSendDate`. |
| `tests/lib/money.test.ts` (+37 líneas) | — | `percentOfCentsDown`: floor nunca ceil, el caso 833333/15%, bordes de `percent` (1, 100), cents=0. |
| `tests/models/coupon.model.test.ts` | 21 | `generateCouponCode` (8 chars, alfabeto sin `0/O/1/I/L`, formato válido para `couponCodeSchema`, no determinístico), `validateCouponForCart` completo: formato inválido sin tocar la base, not_found, anti-enumeración (draft/paused = mismo texto que inexistente, `reasonCode` interno distinto), not_started, expired, min_subtotal, payment_method, exhausted, phone_limit (y que se saltea sin teléfono), camino feliz, y el **orden de los chequeos** replicando `create_order` (min_subtotal antes que payment_method; exhausted después de los dos). `getCouponDetail` con sus tres traducciones de error y sus parámetros. |
| `tests/models/coupon.schema.test.ts` | 31 | `couponCodeSchema` (bordes 4/16), `couponInputSchema` espejando `coupons_shape_check`/`coupons_window_check`/`.strict()`, `campaignSegmentSchema` discriminada y estricta por rama, `campaignCreateInputSchema` (mensaje vacío → null), `campaignQuotaRequestInputSchema`. |
| `tests/models/campaign.model.test.ts` | 13 | `previewSegment` arma los parámetros de la RPC según el segmento, traduce `42501`/forma inesperada/cupón ausente; `fitsBeforeExpiry` (capa 1 de §5.10.3.1) en sus 4 casos; `getMarketingQuotaStats` con los 4 filtros exactos (`store_id`, `status=active`, `status=redeemed` + ventana de 30 días, `email is not null`) y propagación de error. **La fila de la ventana de canjes ahora filtra por `redeemed_at`** (Hallazgo 3, corregido — ver abajo), test verde. |
| `tests/services/campaign-email.test.ts` | 14 | `drainCampaignQueue`: sin destinatarios, sin `RESEND_API_KEY` (asienta fallido, no cierra la campaña — eso es del claim), sin remitente, camino feliz con `List-Unsubscribe`, la clave de idempotencia dependiendo del **contenido** del chunk (mismo set en otro orden = misma clave; otro destinatario = otra clave), Resend rechazando el batch entero, un fallo de red, y que un fallo al asentar UN destinatario no aborta el resto. `sendCampaignQuotaRequest` degradando en cada camino sin `RESEND_API_KEY`/`SALES_EMAIL`. |
| `tests/services/cron-campaigns.test.ts` | 4 | Auth del cron (`CRON_SECRET`, tiempo constante) y que un fallo de `drainCampaignQueue` no expone el mensaje interno. |
| `tests/services/orders-coupon-check-rate-limit.test.ts` | 5 | **`coupon_check:ip` se cobra SOLO con `couponCodeMissing: true`**: sin código no consume, con uno que existe pero no aplica (pausado/vencido/método) tampoco, con uno inexistente sí, agotado da 429 sin exponer el campo interno, y el campo interno nunca sale en el JSON de una cotización exitosa. |
| `tests/controllers/marketing.actions.test.ts` | 18 | `createCouponDraftAction` (nace `draft`, balde), `deleteCouponAction` (borra, y propaga el 409 de "ya se usó"), `setCouponStatusAction` (`'active'` rechazado por el schema, nunca llega a `setCouponStatus`), `updateCouponAction` (draft/paused aplica directo, activo bajando exposición aplica directo, activo subiendo pide código sin aplicar), `requestCouponActivationAction` (ya activo rechaza, draft/paused siempre pide código), `confirmCouponChangeAction` (kind≠coupon rechaza, despacha `activate`/`update` por `payload.action`), `sendCampaignAction` (capa 1 de §5.10.3.1: si no entra antes del vencimiento, nunca llama `enqueueCampaign`; el balde `campaign_send:store` ahora se gasta DESPUÉS de ese chequeo, Hallazgo 5-bis, corregido — ver abajo). |
| `tests/db/grants-orders.test.ts` (+47 líneas) | — | `discount_cents`/`coupon_code_snapshot` sin grant de `authenticated`, verificado con `permission denied` real. |
| `tests/db/coupon-shape-check-max-discount-sign.test.ts` | 2 | Documenta el Hallazgo 4 (ver abajo, corregido): `coupons_shape_check` rechaza un `max_discount_cents` negativo o cero en un cupón `percentage`. |

### Lo que decidí NO cubrir, y por qué

**El envelope del carrito `v:1` → `v:2` (`src/lib/cart.tsx`)**: `readCart`/
`writeCart` no están exportadas y viven detrás de `CartProvider`, un Client
Component con hooks de React. `tests/lib/cart.test.ts` ya documenta (comentario
sobre `lineKey`) que esta suite corre en Node puro (`vitest.config.ts`: sin
jsdom, sin Testing Library) precisamente para no necesitar un DOM — y ni
`react-test-renderer` ni `@testing-library/react` están instalados. Confirmé
que no puedo instalar nada (regla del pipeline: "ningún agente corre
`npm install`") y que no hay forma de ejercitar `addLine`/`setCouponCode` sin
montar el provider. Queda sin cobertura de test; la promoción v1→v2 y el
`discardIdempotencyKey()` al tocar el cupón están solo verificados por
lectura de código. Si se agrega el aparato de testing de componentes al repo,
es la primera pieza que hay que cubrir.

## Hallazgos — cuatro convertidos en test, y ya CORREGIDOS

Mientras escribía esta suite, `code-reviewer` publicó
`docs/pipelines/2026-08-31-clientes-y-cupones/03-review.md` con veredicto
**NO PASA**. Convertí cuatro de sus hallazgos en tests ejecutables — la forma
correcta de "act on it" cuando el hallazgo es del `code-reviewer`: no lo doy
por cierto de palabra, lo verifico yo mismo escribiendo el test y viéndolo
fallar en la línea exacta que señala. En esa corrida quedaron **rojos a
propósito**.

**Los cuatro ya están corregidos** por `senior-backend-engineer` (Hallazgos 1,
3, 5-bis) y por el hilo principal (Hallazgo 4, schema). Re-corrí los cuatro
tests **sin modificarlos** y los cuatro pasan ahora — es la confirmación
independiente de que el arreglo real cierra exactamente lo que el test
afirmaba, no una reformulación del test para que dé verde. Quedan documentados
igual, como registro de qué se rompía y por qué.

### Hallazgo 1 — BLOQUEANTE — `tests/models/order.model.test.ts` — CORREGIDO, confirmado verde

**1 test**, describe `"createOrder — HALLAZGO..."` (al final del archivo).

**Dónde:** `src/models/order.model.ts:790-806` (el bloque `if (parsed.couponCode) { ... if (resolution.quote?.status === 'rejected') throw new DomainError(...) }`, dentro de `createOrder`).

**El bug:** `createOrder` resuelve el cupón (`resolveCoupon` → `validateCouponForCart`)
**antes** de darle a la RPC `create_order` la oportunidad de reconocer un
reintento idempotente. La RPC resuelve `(store_id, idempotency_key)` como su
**primera** operación (migración `20260901130000_cupones.sql`, antes de tocar
un solo cupón), pero `createOrder` en TypeScript nunca llega a llamarla en
este escenario:

1. Un cupón con `max_redemptions_per_phone = 1` (el caso más común: "un
   descuento por cliente") reserva una fila para ese teléfono en el primer
   intento exitoso.
2. La respuesta se pierde — el caso normal que la idempotencia existe para
   cubrir.
3. El cliente reintenta con la **misma** `idempotencyKey`.
4. `validateCouponForCart` cuenta `coupon_redemptions` para ese teléfono, **encuentra
   la reserva que su propio pedido ya creado dejó ahí**, y rechaza con
   `'Ya usaste ese cupón.'`.
5. `createOrder` tira `DomainError` **sin haber llamado la RPC ni una vez**.
   El cliente ve un error de cupón para un pedido que ya existe y ya está
   pago.

Esto coincide exactamente con el Hallazgo 1 (bloqueante) del `code-reviewer`
en `docs/pipelines/2026-08-31-clientes-y-cupones/03-review.md`, a quien
verifiqué de forma independiente escribiendo el test y viéndolo fallar en la
línea exacta que señala (`order.model.ts:805`).

**El test** (`tests/models/order.model.test.ts`, mock del admin client
extendido con `coupons`/`coupon_redemptions`) simula exactamente ese
escenario y afirma el comportamiento CORRECTO: que `createOrder` debería
devolver el pedido (vía la RPC, que resuelve la idempotencia sola) en vez de
tirar. En la corrida original fallaba con:

```
DomainError: Ya usaste ese cupón.
 ❯ createOrder src/models/order.model.ts:805:13
```

No lo arreglé entonces (no escribo código de producción). El arreglo real —
`resolveCoupon` ya no corta con un `throw` antes de la RPC; el comentario
nuevo en `order.model.ts:788-804` documenta exactamente este hallazgo y por
qué el corte se movió — está aplicado y el test pasa. **Dueño:
`senior-backend-engineer`. Estado: CORREGIDO.**

### Hallazgo 3 — MENOR — `tests/models/campaign.model.test.ts` — CORREGIDO, confirmado verde

**1 test**, `"HALLAZGO: redemptionsLastMonth debería filtrar por
redeemed_at, no por created_at"`.

**Dónde:** `src/models/campaign.model.ts` (`getMarketingQuotaStats`), la
query `.from('coupon_redemptions').eq('status','redeemed').gte('created_at',
oneMonthAgo)`.

**El bug:** el mail a la vía comercial (§5.10.6) promete "canjes del último
mes", pero `created_at` en `coupon_redemptions` es el momento en que se
**reservó** la fila (al crear el pedido), no cuando pasó a `redeemed` (al
entregarse). Un pedido reservado hace 40 días y entregado hace 3 días queda
afuera del conteo; uno reservado hace 25 días y entregado el mismo día entra
igual. Impacto acotado (un número informativo para ventas, sin plata ni
camino de cliente de por medio), pero mide algo distinto de lo que dice medir.

El test captura el argumento real de `.gte(...)` contra el mock del admin
client y afirma que debería ser `'redeemed_at'`. En la corrida original
recibía `'created_at'`; ahora `campaign.model.ts:309-313` filtra por
`redeemed_at` (comentario nuevo explicando la corrección) y el test pasa.
**Dueño: `senior-backend-engineer`. Estado: CORREGIDO.**

### Hallazgo 4 — MENOR — `tests/db/coupon-shape-check-max-discount-sign.test.ts` — CORREGIDO, confirmado verde

**2 tests** (uno para negativo, uno para cero).

**Dónde:** `supabase/migrations/20260901130000_cupones.sql`, constraint
`coupons_shape_check` (rama `discount_type = 'percentage'`).

**El bug:** el CHECK exige `percent between 1 and 100` y `amount_off_cents is
null`, pero no restringe el signo de `max_discount_cents` cuando no es
`null`. `couponInputSchema` (Zod) ya exige `.positive()`, así que hoy no es
alcanzable desde la app — pero `service_role` bypasea Zod, y es exactamente
el tipo de invariante que este repo pone en Postgres por eso mismo. Con un
`max_discount_cents` negativo, `create_order` calcula
`least(v_discount, v_coupon.max_discount_cents)`, el resultado negativo
sobrevive el `least(v_discount, v_subtotal)` de abajo, y explota contra
`coupon_redemptions.discount_cents >= 0` con un `23514` crudo sin traducir —
justo lo que el resto de la migración evita con los marcadores `CPN0x`.

En la corrida original, insertar un cupón con `max_discount_cents = -500` o
`= 0` entraba sin error. `coupons_shape_check` ahora agrega
`(max_discount_cents is null or max_discount_cents > 0)` en la rama
`percentage` (verificado leyendo la definición real del constraint desde
`pg_constraint`, no de memoria) y los dos tests pasan. **Dueño: hilo
principal (schema/migraciones). Estado: CORREGIDO.**

### Hallazgo 5-bis — MENOR — `tests/controllers/marketing.actions.test.ts` — CORREGIDO, confirmado verde

**1 test**, `"HALLAZGO: un rechazo por fitsBeforeExpiry NO debería
gastar el balde campaign_send:store"`.

**Dónde:** `src/controllers/marketing.actions.ts` (`sendCampaignAction`), el
`consumeOrThrow('campaign_send:store', ...)` corre ANTES de `previewSegment`/
el chequeo de `fitsBeforeExpiry`.

**El bug:** `campaign_send:store` es 3 por 24h con `onError: 'deny'`. Tres
intentos de mandar una campaña rechazados por vencimiento del cupón (un error
de validación, no un envío real) agotan el balde igual y bloquean cualquier
campaña REAL de ese local por 24 horas sin haber mandado un solo mail.

En la corrida original, con `previewSegment` devolviendo `fitsBeforeExpiry:
false`, `consumeRateLimit` se llamaba igual con el bucket
`campaign_send:store`. Ahora el `consumeOrThrow` corre DESPUÉS del chequeo de
`fitsBeforeExpiry` (`marketing.actions.ts`) y el test pasa. **Dueño:
`senior-backend-engineer`. Estado: CORREGIDO.**

### Hallazgo 5 — MENOR — `claim_campaign_recipients` — CORREGIDO, cubierto por `campaign-cleanup-and-no-recipients.test.ts`

La limpieza (destinatarios que agotaron reintentos → `failed`, campaña sin
cola → cerrada) vivía DESPUÉS del corte por presupuesto agotado
(`v_remaining <= 0`), así que un día con presupuesto ya gastado no cerraba
una campaña que en la práctica ya había terminado — como el chunk ES el
presupuesto (15), el primer envío exitoso del día lo agotaba de inmediato.

En la corrida original no llegué a escribir el test (quedó anotado como
pendiente). El hilo principal movió los dos `update` de limpieza ANTES del
`if v_remaining <= 0 then return`, y sumó `stopped_reason = 'no_recipients'`
para el caso en que la campaña cierra sin haber mandado ni fallado nada (nadie
elegible). Agregué `tests/db/campaign-cleanup-and-no-recipients.test.ts` con
tres casos: presupuesto de hoy en cero pero la limpieza corre igual; una
campaña sin ningún elegible al drenar cierra en `stopped`/`no_recipients`
(nunca `sent`); y el hermano negativo — una campaña que solo espera la
ventana de reintento sigue `sending`, no se cierra de prepo. Los tres verdes.
**Dueño: hilo principal. Estado: CORREGIDO Y CUBIERTO.**

### `released_reason` — corrección de expectativa, no un bug (Hallazgo 2 del review, "cancelled_unpaid siempre")

El review también señalaba que `released_reason` tenía un valor declarado en
el CHECK (`'expired'`) que ningún camino de código producía nunca: un carrito
abandonado que barrió el cron y una cancelación a mano del mostrador se leían
idénticos en la traza de canjes. El hilo principal cerró esa laguna
discriminando por `auth.uid()` en `sync_coupon_reservation`: sin sesión (el
cron `expire_pending_orders`/la conciliación) → `'expired'`; con sesión de
staff (`orders.grant update(status)` para `authenticated`) → `'cancelled_unpaid'`.

Esto volvió obsoleta la expectativa original de
`tests/db/coupon-redemption-lifecycle.test.ts` — el test corría como
`postgres` (sin JWT), así que cae del lado del cron y ahora recibe
`'expired'`, no `'cancelled_unpaid'`. **No era un bug: el schema cambió a
propósito y el test viejo quedó desactualizado.** Corregido:

- El caso existente (`postgres`, sin sesión) se renombró para decir de qué
  camino habla ("barrido del cron, sin sesión") y su expectativa pasó a
  `'expired'`.
- Se agregó el hermano que faltaba: la misma cancelación pero con
  `asAuthenticated` (sesión de staff real, vía `set_config('request.jwt.claims', ...)`)
  antes del `update`, esperando `'cancelled_unpaid'`. Sin este segundo caso la
  distinción entre los dos caminos vuelve a no estar cubierta, y el próximo
  que toque el trigger la puede colapsar sin que nada falle.

Los dos verificados en `tests/db/coupon-redemption-lifecycle.test.ts` (ahora
26 tests, todos verdes).

### La tanda de 6 rojos que NO eran bugs: base local sucia entre corridas

Entre mi primera corrida y esta hubo un `db:reset`. El hilo principal venía
aplicando los arreglos de schema a mano sobre la base local, y una de esas
ediciones dropeó el trigger `coupon_redemptions_sync_counters` sin
recrearlo — sin ese trigger los contadores (`reserved_count`/`redeemed_count`)
nunca subían, así que el off-by-one y varios otros casos de
`coupon-redemption-lifecycle.test.ts` fallaban por una base desincronizada de
la migración, no por un bug real. La migración desde cero (post `db:reset`)
tiene los cuatro triggers presentes — confirmado corriendo la suite completa
de `tests/db/` dos veces seguidas sin un solo rojo espurio. De los 7 rojos que
hubo en algún momento entre corridas, 6 eran esa base sucia y 1 era el cambio
real de `released_reason` de arriba.

### Identificados por el `code-reviewer` y NO convertidos en test (siguen abiertos)

- **Hallazgo 1-bis (MAYOR)** — carrera de snapshot en
  `private.sync_coupon_counters()` bajo READ COMMITTED (mismo patrón, tres
  veces, en `sync_coupon_counters`/`claim_campaign_recipients`/
  `settle_campaign_recipient`). No escribí un test: reproducir de forma
  determinística una carrera de snapshot de MVCC (una transacción que espera
  un lock y re-evalúa su `WHERE` sin recalcular una subquery ya resuelta)
  necesita inyectar una pausa exacta DENTRO de una transacción de Postgres
  mientras otra corre en paralelo — el arnés de este repo (`docker exec psql`
  por conexión, sin punto de control intermedio) no da esa granularidad sin
  un `pg_sleep` a ciegas que sería flaky por diseño. Recomiendo un
  `perform ... for update` al principio del trigger (arreglo que el propio
  `code-reviewer` sugiere) verificado por lectura de código, no por test.
- **Hallazgo 1-ter (MAYOR)** — el comentario de `campaign.tsx:206` y el
  `comment on function private.looks_like_email` afirman una revalidación
  con `z.email()` en el drenaje que no existe en el código; la única
  validación es la regex laxa de Postgres al encolar. No es una discrepancia
  de comportamiento que un mock pueda exponer con más precisión que
  `tests/services/campaign-email.test.ts` (que ya prueba que un batch
  rechazado por Resend asienta TODOS los destinatarios como fallidos, el
  síntoma real de este hallazgo) — el gap concreto es documental. Reportado
  para que quien lo resuelva sepa que puede ser (a) agregar la revalidación,
  o (b) corregir los dos comentarios.

Ninguno de los dos bloquea `SUITE GREEN`: son hallazgos MAYORES sin un camino
de test barato con el arnés actual (1-bis) o sin síntoma de comportamiento
distinto del que ya prueba otro test (1-ter), no hallazgos que un test mío
esté fallando en rojo.

## Verificación final

```
npm run typecheck   → limpio
npm run lint        → limpio
npm test            → 99 archivos, 1289 tests verdes, 0 rojos, 4 skip
```

`tests/db/` corrido 2 veces seguidas después de todos los cambios de esta
ronda (33 archivos / 307 tests) sin un solo rojo, para descartar la
flakiness de base sucia que produjo la tanda de falsos positivos entre
corridas. Los 4 skip son preexistentes (nada de Entrega B).

## Veredicto

**SUITE GREEN.** 1289/1289 tests verdes (+4 skip preexistentes), 99 archivos,
`typecheck` y `lint` limpios.

Los cuatro hallazgos bloqueantes/menores del `code-reviewer` que había
convertido en test rojo están **corregidos y confirmados**, sin haber tocado
un solo test para lograrlo:

1. **BLOQUEANTE, corregido** — el reintento idempotente de un pedido con
   cupón de cupo ajustado ya no corta antes de la RPC —
   `src/models/order.model.ts` (`senior-backend-engineer`).
2. **MENOR, corregido** — `redemptionsLastMonth` ahora filtra por
   `redeemed_at` — `src/models/campaign.model.ts` (`senior-backend-engineer`).
3. **MENOR, corregido** — `coupons_shape_check` ahora valida el signo de
   `max_discount_cents` — `supabase/migrations/20260901130000_cupones.sql`
   (hilo principal).
4. **MENOR, corregido** — `campaign_send:store` se gasta después de validar
   que la campaña pueda terminar — `src/controllers/marketing.actions.ts`
   (`senior-backend-engineer`).

Más lo que se sumó en esta ronda: `released_reason` discriminado por
`auth.uid()` (cron vs. staff) con sus dos casos hermanos, y la limpieza de
`claim_campaign_recipients` corriendo con presupuesto agotado más el cierre a
`no_recipients` con su hermano negativo. Quedan dos hallazgos MAYORES del
review sin test (1-bis, la carrera de MVCC; 1-ter, el comentario que promete
una revalidación que no existe) — documentados arriba, no bloqueantes.
