# T2B — Backend: el descuento en el camino del pedido

Implementado por `senior-backend-engineer`. Consumió `01-tasks.md` (sección T2B) y
`00-architecture.md` §5.8, §5.9 (§5.9.1 a §5.9.4), §5.13 y §5.14.3, más la
migración `20260901130000_cupones.sql` (ya aplicada en local, bloque de
`create_order` con los diez SQLSTATE de cupón).

## Archivos tocados (dueño exclusivo, ninguno compartido)

- `src/models/schemas/order.schema.ts`
- `src/models/order.model.ts`
- `src/controllers/checkout.controller.ts`
- `src/app/api/orders/route.ts`
- `src/services/payments/mercadopago.adapter.ts`

No toqué `coupon.model.ts`, `campaign.model.ts`, `coupon.schema.ts`,
`marketing.*`, `types.ts`, `lib/coupon.ts`, `lib/money.ts`,
`lib/rate-limit-policy.ts`, `src/views/**`, ni ninguna migración.

## Decisión importante: terminé usando `validateCouponForCart` de T1B, no una
## reimplementación propia

Arranqué escribiendo la validación completa (CPN01..CPN08) adentro de
`order.model.ts`, contra las tablas `coupons`/`coupon_redemptions` con el admin
client, porque cuando empecé `coupon.model.ts` todavía no existía (T1B corría en
paralelo) y el brief me decía que asumiera la firma de la spec y lo reportara.

A mitad de camino, `coupon.model.ts` apareció en el árbol de trabajo (T1B
terminó) y su `validateCouponForCart` resultó ser **exactamente** la función que
yo había estado reimplementando: mismo orden de chequeos (existencia → estado →
ventana → mínimo → método de pago → tope global → tope por teléfono), mismo
criterio de "no existe" y "pausado" comparten mensaje, misma firma de parámetros.
Descarté mi reimplementación y reescribí `order.model.ts` para **importarla y
envolverla**, tal como pedía el brief original ("la importás, no la editás").
El propio dev log de T1B confirma la reconciliación desde su lado: verificaron mi
código ya escrito y el nombre/forma de los parámetros coincidía, así que no hizo
falta tocar nada de su lado.

Lo que quedó en `order.model.ts` (sección `0-bis. Cupón`, antes de `priceCart`)
es un envoltorio delgado sobre `validateCouponForCart`, `resolveCoupon()`, que:

1. Extrae `discountCents` de la aplicación exitosa (0 si se rechazó o no se
   mandó código).
2. Decide la señal interna `codeNotFound` para el balde `coupon_check:ip` —ver
   más abajo, es la única pieza que `validateCouponForCart` no podía darme
   porque su contrato es `CouponAppliedQuote` (lo que VE el cliente), y "no
   existe" y "pausado" comparten mensaje a propósito.

```ts
// order.model.ts — exportada, la usa checkout.controller.ts también
export async function resolveCoupon(params: {
  storeId: number
  code: string | undefined
  subtotalCents: number
  paymentMethod: PaymentMethod
  customerPhoneE164?: string          // ausente en la cotización, presente en el commit
}): Promise<{
  discountCents: number
  quote: CouponAppliedQuote | null    // lo que ve el cliente. null si no se mandó código
  codeNotFound: boolean               // interno, nunca al cliente
}>
```

## Los cinco puntos del brief, uno por uno

### 1. `toOrder()` / `toOrderPublicView()` mapean `discountCents`/`couponCodeSnapshot`

Ya estaban mapeados por el stub del hilo principal — verificado con grep, no hizo
falta tocar nada acá:

```
src/models/order.model.ts:144-145   toOrder()
src/models/order.model.ts:232-233   toOrderPublicView()
```

### 2. Los mínimos, §5.9.3.1 (mínimo SIN descuento, envío gratis CON descuento)

`buildDeliveryQuote()` (`src/lib/delivery.ts`, no lo toqué — no es de nadie en el
mapa de propiedad de este pipeline pero no hacía falta cambiarlo) conflaciona las
dos cosas en un solo `subtotalCents`. La resolví llamándolo **dos veces** y
combinando el resultado, tanto en `checkout.controller.ts:priceCartForStore`
(cotización) como en `order.model.ts:createOrder` (commit):

- Una llamada con el subtotal **SIN** descontar → de ahí sale
  `available`/`unavailableReason`/`missingForMinimumCents` (el mínimo de envío).
- Otra llamada con el subtotal **YA** descontado → de ahí sale
  `feeCents`/`missingForFreeCents`/`totalWithDeliveryCents` (envío gratis y el
  costo real).

Verificado a mano con el ejemplo del criterio 5: subtotal $10.000, cupón $3.000,
mínimo de envío $9.000, envío gratis desde $8.000 → `available: true` (el
mínimo se mide sobre $10.000) y `feeCents > 0` (el envío gratis se mide sobre
$7.000, que no llega a $8.000).

En `createOrder` el mismo criterio, sin `buildDeliveryQuote` de por medio: el
`if (priced.subtotalCents < store.delivery.minOrderCents)` sigue midiendo sobre
el subtotal sin descuento (no lo toqué), y `deliveryFeeFor(store.delivery,
discountedSubtotalCents)` ahora recibe el subtotal ya descontado.

`totalCents = discountedSubtotalCents + deliveryFeeCents` — satisface
`total = subtotal − discount + delivery_fee`, que es lo que valida el CHECK
nuevo de la migración (`orders_total_is_subtotal_minus_discount_plus_delivery_check`).

### 3. `createCheckoutForOrder` — un solo item con descuento

`checkout.controller.ts`. Con `order.discountCents > 0`: un único item
`{ name: "Pedido {shortCode} — {storeName}", quantity: 1, unitPriceCents:
order.totalCents }`. Sin descuento: el detalle de siempre, sin ningún cambio de
comportamiento (mismo código, solo movido a la rama `else`). Verificado contra
la doc de `mercadopago` 3.4 (Context7, `/mercadopago/sdk-nodejs`): la forma de
`items` (`id`, `title`, `quantity`, `unit_price`) es la misma que ya usaba el
adapter, así que un solo item es un `Preference.create` perfectamente válido, no
un caso límite del SDK.

### 4. `mercadopago.adapter.ts` — cota `!==` en vez de `<`

`totalCents < itemsTotalCents` → `totalCents !== itemsTotalCents`. Es
estrictamente más fuerte: antes toleraba que el total fuera mayor que los items
(nadie lo usaba), y con descuento eso sería el bug exacto de "MP le cobra de más
al cliente".

### 5. `coupon_check:ip` solo cuando el código no existe

Este fue el punto más delicado porque `validateCouponForCart` **a propósito** no
distingue "no existe" de "pausado/borrador" en el `CouponAppliedQuote` que
devuelve (mismo mensaje, anti-enumeración). Para el balde necesitaba esa
distinción sin romper el contrato de T1B.

Solución: `resolveCoupon()` solo hace una consulta EXTRA (`select id from
coupons where store_id=... and code=...`, sin tocar ninguna otra tabla) cuando
el rechazo trae exactamente el mensaje compartido (`COUPON_REJECTION_MESSAGES.
notFound`, idéntico byte a byte al `COUPON_MESSAGES.notFound` de
`coupon.model.ts` — los dos derivan del mismo texto de §5.9.4). Si esa consulta
no encuentra fila, `codeNotFound = true`. Para cualquier otro motivo de rechazo
(vencido, agotado, mínimo, método de pago, tope por teléfono) la fila
existe por construcción — no hace falta la consulta extra.

`PriceQuote.couponCodeMissing` (tipo local de `checkout.controller.ts`, no de
`types.ts`) lleva esa señal desde `priceCartForStore` hasta el route handler.
`GET /api/orders` la lee, decide si consume `coupon_check:ip`, y la descarta
antes de armar el JSON de respuesta — nunca viaja al cliente.

**Fragilidad que dejo anotada para el hilo principal**: la desambiguación
depende de que el string `'Ese código no existe o ya no está disponible.'` sea
IDÉNTICO en `order.schema.ts` (mío) y `coupon.model.ts` (T1B). Hoy lo es
(verificado con grep). Si alguno de los dos textos se edita sin tocar el otro,
`codeNotFound` deja de funcionar en silencio — no rompe nada visible, solo
hace que el balde deje de dispararse para el caso "no existe" (fail-open, así
que el efecto es "vuelve a como estaba antes de este balde", no una regresión
de seguridad grave, pero vale la pena que quede escrito). Si se refactoriza
esto en el futuro, lo más limpio sería que `validateCouponForCart` devuelva un
discriminador explícito en vez de que dos módulos comparen texto.

## `createOrderSchema.couponCode`

```ts
couponCode: z.string().trim().toUpperCase().max(16).optional()
```

**Sin `.transform((v) => v === '' ? undefined : v)`, y no es un olvido.**
Agregarlo (el mismo patrón que ya usan `customerEmail`/`optionalText` en el
mismo archivo) hace que TypeScript reporte `TS2719: Two different types with
this name exist, but they are unrelated` sobre `CreateOrderInput` en CUALQUIER
archivo que lo importe (`order.model.ts`, `checkout.controller.ts`,
`api/orders/route.ts`, `tests/models/order.model.test.ts`) — verificado
empíricamente agregando y sacando esa única línea con el resto del diff fijo:
aparece y desaparece con ese cambio solo. Es una complejidad de inferencia de
Zod v4 sobre un `.strict().superRefine(...)` ya grande, no un bug de lógica.

No hace falta el transform: un `couponCode: ''` que llegue acá es falsy en
todos los `if (parsed.couponCode)`/`if (!code)` de `order.model.ts` y
`checkout.controller.ts`, y del lado de Postgres `create_order` ya hace
`nullif(upper(trim(p_order ->> 'coupon_code')), '')` — un string vacío y `null`
terminan siendo exactamente lo mismo en los dos lados. Documentado in-line en
el schema para que nadie lo "arregle" agregando el transform de vuelta.

## Criterios de aceptación — estado

1. **Body con `discountCents` → 400 que nombra la clave.** `.strict()` intacto
   en `createOrderSchema`; `discountCents` nunca fue un campo reconocido.
   Cubre `zodToApiError`, que ya existía — no hay caso nuevo que agregar ahí.
2. **Cupón inválido en la cotización → responde igual, `discountCents: 0`,
   `coupon.status: 'rejected'`.** `resolveCoupon`/`validateCouponForCart` nunca
   tiran para un rechazo de negocio; solo tiran ante un fallo real de Postgres.
3. **`total = subtotal − discount + delivery_fee`.** Ver punto 2 de arriba.
4. **Cupón fijo > subtotal → `discount = subtotal`, nunca negativo ni menor que
   el envío.** El clamp vive en `discountForSubtotal()` (`lib/coupon.ts`, main
   thread) y se replica en SQL (`least(v_discount, v_subtotal)`); yo no lo
   reimplemento, solo lo consumo vía `validateCouponForCart`.
5. **Los mínimos — ver arriba.** Verificado a mano con el ejemplo exacto del
   criterio.
6. **Preferencia de MP: un item con descuento, detalle sin él.** Ver punto 3
   de arriba.
7. **`toOrder`/`toOrderPublicView` grepeables.** Confirmado, ver punto 1.
8. **`coupon_check:ip` solo con código inexistente.** Ver punto 5 de arriba
   (el de la lista de "los cinco puntos").
9. **Ningún mensaje de constraint de Postgres llega al browser.** Los ocho
   CPN01-08 que puedan llegar recién de la RPC (carrera entre `resolveCoupon` y
   el `for update` de `create_order`) se traducen con `couponRpcRejectionReason()`
   a los mismos textos de §5.9.4 (genéricos para mínimo/método de pago, porque
   en ese punto ya no tengo la fila del cupón a mano — es un camino
   extremadamente raro, nunca el normal). CPN09/CPN10 (bug propio: el
   descuento no coincidió entre TS y Postgres) se loguean como error interno y
   el cliente recibe el genérico de `toApiError`, nunca el texto crudo de la
   constraint.

## Invariantes que dependen de una base real (`tests/db/`)

- **La carrera del `for update` sobre `coupons`** (§5.9.2): dos `createOrder`
  simultáneos con el mismo cupón y `max_redemptions = 1` → uno gana, el otro
  recibe `coupon_exhausted` limpio (CPN05 traducido), nunca un `23514` crudo.
  Esto ya lo cubre el criterio de aceptación 1 de T1B en `tests/db/`, pero
  vale repetirlo acá porque el camino que lo dispara (`createOrder` →
  `create_order`) es mío.
- **El orden exacto "return de idempotencia ANTES del bloque de cupón".**
  Mismo `idempotencyKey` con el mismo cupón, dos veces → un solo pedido, un
  solo canje reservado. Ya cubierto por el criterio 3 de T1B, mismo comentario
  que el punto anterior: el camino de entrada es `createOrder`.
- **El CHECK `orders_total_is_subtotal_minus_discount_plus_delivery_check` y
  `orders_discount_within_subtotal_check`** rechazando un intento manual de
  violar la aritmética (p. ej. un test que llame `create_order` con
  `discount_cents` mayor que `subtotal_cents`) → `23514`. No pude ejercer esto
  desde TypeScript porque `resolveCoupon`/`discountForSubtotal` siempre
  clampean antes de llegar a la RPC; hace falta un test que le pegue a la RPC
  directo con un `p_order` armado a mano.
- **CPN09 real** (el `v_claimed <> v_discount` bajo lock): para forzarlo desde
  un test hay que llamar a `create_order` directamente con un
  `discount_cents` que no coincida con lo que la fila del cupón produciría —
  no hay forma de ejercerlo pasando por `createOrder()` de TypeScript, que
  siempre manda el número correcto salvo bug. Vale la pena un test que
  verifique que ESE camino específico (RPC directo con número mentiroso)
  nunca deja pasar un pedido con el número equivocado.
- **La igualdad estricta del adapter de Mercado Pago** (`totalCents !==
  itemsTotalCents`) no se puede probar contra Postgres — es un test de
  `mercadopago.adapter.test.ts` (vitest normal, no `tests/db/`), y ya hay 18
  tests ahí que siguen pasando; no agregué ninguno (no me toca escribir tests).

## Lo que asumí de T1B y quedó confirmado

Asumí (antes de que el archivo existiera) que `coupon.model.ts` iba a exportar
una función `validateCouponForCart(params: { storeId, code, subtotalCents,
paymentMethod, customerPhoneE164? }): Promise<CouponAppliedQuote>` que nunca
tira. Cuando el archivo apareció, la firma coincidía exactamente (T1B lo
confirma en su propio dev log). No tuve que ajustar nada de mi lado más allá
de borrar mi reimplementación duplicada.

## Pendientes / seguimiento para el hilo principal

1. **La fragilidad del string compartido** entre `order.schema.ts` y
   `coupon.model.ts` para desambiguar "no existe" de "pausado" (ver arriba).
   No es urgente (fail-open), pero es un acoplamiento implícito que un
   refactor futuro puede romper en silencio.
2. **No toqué `src/lib/delivery.ts`** — no está en el mapa de propiedad de
   este pipeline y no hacía falta: resolví el "doble subtotal" (mínimo sin
   descuento / gratis con descuento) llamando `buildDeliveryQuote()` dos veces
   desde mis propios archivos y combinando el resultado. Si en algún momento
   se decide que esta lógica merece vivir adentro de `delivery.ts` (una firma
   con `discountedSubtotalCents` aparte), es un cambio de ese archivo que no
   me correspondía hacer.
3. `npm run typecheck`, `npm run lint` y `npm test` (1023 passed, 4 skipped —
   los de `tests/db/` sin Docker) verdes al terminar.

---

## Post-review (Entrega B) — arreglos de `03-review.md`

Segunda pasada, después del veredicto **NO PASA** de `code-reviewer`. Arreglé
los hallazgos de backend en el orden que pidió el hilo principal. No toqué
`tests/**` ni `supabase/migrations/**` — los cinco tests rojos que dejó
`test-engineer` (la especificación de lo que había que arreglar) pasan ahora
por el cambio de código, no porque se hayan tocado.

### Hallazgo 1 — BLOQUEANTE — resuelto

**Archivo:** `src/models/order.model.ts`, bloque `[CUPON]` dentro de
`createOrder` (antes de armar `p_order`).

**Qué cambié:** saqué el `throw new DomainError(resolution.quote.reason)`
que cortaba el pedido en cuanto `resolveCoupon` devolvía un cupón rechazado.
`discountCents` sigue saliendo de `resolution.discountCents` (que ya es `0`
cuando el código no existe o quedó rechazado — contrato existente de
`CouponResolution`, no lo cambié), pero ya no decide un `throw`.

**Por qué esto y no un chequeo de idempotencia nuevo en TypeScript:** el
arreglo "obvio" (agregar una consulta a `orders` por `(store_id,
idempotency_key)` al principio de la función) tiene un problema real: para
un reintento LEGÍTIMO —donde el primer intento sí insertó la fila— esa
consulta encontraría el pedido y listo. Pero en la práctica cualquier
implementación de ese chequeo agrega una responsabilidad nueva en TypeScript
que la RPC ya resuelve mejor, bajo lock, en la misma transacción que valida
todo lo demás. La alternativa que quedó implementada es la que el propio
hallazgo ofrecía como "más simple" en su arreglo sugerido: dejar de
pre-validar el cupón para decidir un corte, y que la RPC `create_order` sea
la única autoridad. Su `select ... where idempotency_key = v_key; if found
then return` corre ANTES de tocar un solo cupón (verificado en la migración,
línea ~903), así que un reintento con la misma clave devuelve el pedido ya
creado sin pasar ni cerca del bloque `[CUPON]`. Y si es un pedido
GENUINAMENTE nuevo con un código inválido, la RPC lo rechaza bajo `for
update` con el CPN0x correspondiente — ese camino de traducción a
`DomainError` YA EXISTÍA en `order.model.ts` (comentario "[CUPON] Defensa en
profundidad") y no hizo falta tocarlo: antes se usaba solo para la carrera
rarísima entre la pre-validación y el commit, ahora es también el camino
normal para el primer intento de un cupón inválido.

**Invariante que esto protege:** "un pedido, una vez" (idempotencia). El
reintento nunca puede fallar por una condición de negocio (cupón, y por
extensión cualquier otra validación previa a la RPC) que el PROPIO primer
intento exitoso dejó distinta. Cubre también los dos casos análogos que
señalaba el hallazgo (mínimo de pedido, disponibilidad de envío, noche
completa) porque el mecanismo es el mismo: la RPC resuelve la idempotencia
antes de que cualquiera de esas reglas se re-evalúe.

**Qué necesita una base real para probarse:** el escenario completo (crear un
pedido con un cupón `max_redemptions_per_phone: 1`, reintentar con la MISMA
`idempotencyKey`, y confirmar que devuelve el mismo `order.id` en vez de
tirar) requiere Postgres real porque depende de que la RPC `create_order` y
el trigger de reservas de cupón corran de verdad. El test unitario mockeado
(`tests/models/order.model.test.ts`) cubre que `createOrder` en TypeScript ya
no corta antes de llamar la RPC; no puede probar el `select` de idempotencia
del lado de la RPC porque ese código vive en la migración.

### Hallazgo 3 — MAYOR — implementado (opción "revalidar con z.email()")

**Archivo:** `src/services/notifications/email/campaign.tsx`.

El comentario que prometía la revalidación mentía: no había ningún `z.email()`
en el drenaje. Elegí implementar la validación real (la opción que pedía el
review) en vez de solo corregir el comentario, porque el batch de Resend es
atómico y una sola dirección rota tira abajo el chunk de 15 completo.

**Qué agregué:**
- `campaignEmailSchema = z.email()` a nivel de módulo.
- En `drainCampaignQueue`, antes de armar `emails`, separo `rows` en
  `validRows`/`invalidRows` con `campaignEmailSchema.safeParse(row.email)`.
- Las `invalidRows` se asientan como `failed` de inmediato vía `safeSettle`
  (mismo helper que ya existía, que nunca tira), con el motivo "La dirección
  de email tiene un formato inválido." — así la fila deja de bloquear su
  chunk y el ciclo de reintentos/cierre de campaña (`claim_campaign_recipients`/
  `settle_campaign_recipient`, en la migración) las trata igual que cualquier
  otro fallo permanente.
- El batch a Resend (`resend.batch.send`), el hash de idempotencia
  (`contentHash`, ahora sobre los IDs de `validRows`, no de `rows`) y los tres
  `Promise.all` de asentado (éxito, `sendError`, `catch` de red) pasaron todos
  de `rows` a `validRows`.
- Si `validRows.length === 0` (todo el chunk tenía direcciones rotas),
  devuelvo `{ claimed: rows.length, sent: 0, failed: invalidRows.length }` sin
  llamar a Resend.
- Corregí el comentario viejo sobre `resend.batch.send` que decía "cada
  dirección se valida con z.email() al encolar (T1B), no acá" — ahora dice la
  verdad: se valida ACÁ, antes del batch.

**Lo que NO toqué, a pedido explícito:** el `comment on function
private.looks_like_email` de la migración sigue mintiendo ("El drenaje vuelve
a validar con Zod antes de mandar") — es un comentario de SQL y el hilo
principal dijo que lo ajusta él. Con el cambio de arriba, ese comentario dejó
de ser mentira: ahora sí es verdad que el drenaje revalida con Zod, así que
en rigor no hace falta tocarlo salvo por prolijidad (queda a criterio del
hilo principal).

**Qué necesita una base real para probarse:** nada nuevo — la lógica es pura
(filtrar por `z.email()`) y el resto ya estaba cubierto por
`tests/services/campaign-email.test.ts` con mocks (14 tests, siguen pasando).
Si `test-engineer` quiere una prueba puntual del filtro, alcanza con un mock
de fila con `email: 'no-es-un-mail'` en el claim y verificar que
`resend.batch.send` se llama sin esa fila y que se asienta como `failed` sin
tocar Resend.

### Hallazgo 5 — MAYOR (reducido) — resuelto

**Archivo:** `src/models/coupon.model.ts`.

Confirmé, como pidió el hilo principal, que la parte del balde
`coupon_check:ip` ya estaba cerrada (`resolveCoupon` en `order.model.ts` usa
`reasonCode === 'not_found'`, un enum, no el texto) — no toqué nada ahí.

Lo que sí quedaba: `COUPON_MESSAGES` (privado, en `coupon.model.ts`) duplicaba
a mano los cinco mensajes de `COUPON_REJECTION_MESSAGES`
(`order.schema.ts`, ya exportado), y `PAYMENT_METHOD_LABELS` estaba copiado
también (nit relacionado, mismo patrón, señalado en la sección de nits).
Borré las dos constantes locales, importé `COUPON_REJECTION_MESSAGES` y
`PAYMENT_METHOD_LABELS` desde `@/models/schemas/order.schema` (ya venía
importando `PaymentMethod` de ahí, así que no sumó una dependencia nueva) y
reemplacé las siete referencias (`COUPON_MESSAGES.notFound` →
`COUPON_REJECTION_MESSAGES.notFound`, etc.). `PAYMENT_METHOD_LABELS[m]` en el
mensaje de "no aplica a este método de pago" ahora usa la misma constante que
importa el frontend.

**Qué necesita una base real para probarse:** nada — es una consolidación de
constantes, cubierta por los 21 tests existentes de
`tests/models/coupon.model.test.ts`, que siguen pasando con los mismos
textos.

### Hallazgo 6 — MENOR — resuelto

**Archivos:** `src/models/store-pending-change.model.ts`,
`src/controllers/admin.actions.ts`.

`getLivePendingChange` no traía `subject_id`, así que `resendPendingChangeCodeAction`
no tenía forma de pasarlo a `startPendingChange` → `createPendingChange`, que
por default invalida con `.is('subject_id', null)`. Para un cupón (cuyo
pendiente original SIEMPRE tiene `subject_id = couponId`), reenviar el código
creaba un pendiente nuevo con `subject_id: null` y la invalidación no
encontraba al original — quedaban dos códigos vivos para el mismo cupón.

**Qué cambié:**
- `PendingChange` (tipo exportado) ganó `subjectId: number | null`.
- `getLivePendingChange` ahora selecciona `subject_id` y lo devuelve.
- `consumePendingChange` también — mismo tipo de retorno, así que tuvo que
  sumar la columna al `select` del `update...returning` para seguir
  compilando. No cambia su comportamiento: nadie usaba ese campo ahí antes ni
  lo usa ahora, es solo completar el contrato del tipo.
- `startPendingChange` (helper privado de `admin.actions.ts`) ganó un
  parámetro `subjectId?: number` que reenvía a `createPendingChange` (que ya
  lo soportaba desde T1B/T4B — el bug estaba en que este helper compartido
  nunca lo exponía).
- `resendPendingChangeCodeAction` ahora pasa `subjectId: live.subjectId ??
  undefined` (el `??` porque el tipo de la fila es `number | null` y
  `createPendingChange` espera `number | undefined`).

Los otros tres call-sites de `startPendingChange` (crédito de pago,
transferencia, courier payment policy) no pasan `subjectId` — correcto, son
los tres kinds originales sin `subject_id`, y el parámetro es opcional.

**Qué necesita una base real para probarse:** el escenario completo (pedir
código para el cupón A, apretar "mandar otro código", y verificar que el
pendiente ORIGINAL de A quedó invalidado — no vive un tercero) necesita
Postgres real porque depende de la invalidación `.is()/.eq()` contra la tabla
`store_pending_changes`. Es exactamente el tipo de caso que
`tests/db/coupon-pending-change-and-detail.test.ts` ya ejercita para el flujo
de creación; valdría la pena que sume un caso para el camino de REENVÍO
específicamente (crear pendiente con `subjectId`, reenviar, confirmar que hay
UNA sola fila viva con `subject_id` de ese cupón).

### Hallazgo 9 — MENOR — resuelto

**Archivo:** `src/models/campaign.model.ts`, `getMarketingQuotaStats`.

Cambié el `.gte('created_at', oneMonthAgo)` de la query de
`redemptionsLastMonth` por `.gte('redeemed_at', oneMonthAgo)`. `created_at` es
el momento de la RESERVA (al crear el pedido); `redeemed_at` es el canje real
(al entregarse), que es lo que el mail a la vía comercial promete medir. No
toqué nada más de la función — los otros tres conteos (`customersTotal`,
`customersWithEmail`, `activeCouponsCount`) no tienen ese problema.

**Qué necesita una base real para probarse:** el test unitario
(`tests/models/campaign.model.test.ts`) ya prueba que la query usa la columna
correcta con un mock de `admin.from`. Lo que ESE test no puede probar es que
`redeemed_at` efectivamente se llena solo al pasar a `delivered` (eso es
`private.sync_coupon_reservation()`, cubierto por
`tests/db/coupon-redemption-lifecycle.test.ts`).

### Hallazgo 10 — MENOR — resuelto

**Archivo:** `src/controllers/marketing.actions.ts`, `sendCampaignAction`.

Moví el `consumeOrThrow('campaign_send:store', ...)` de ANTES de
`previewSegment`/`fitsBeforeExpiry` a DESPUÉS — justo antes de
`enqueueCampaign`, una vez que la campaña ya pasó todas las validaciones.
Antes, tres intentos de ajustar parámetros (acortar el segmento, por ejemplo)
contra un cupón por vencer gastaban el balde de 3/24h sin haber encolado un
solo mail real. `getStoreById` y el chequeo de `fitsBeforeExpiry` ahora
corren primero; el gasto del balde es lo último antes de encolar.

**Qué necesita una base real para probarse:** nada — es orden de
operaciones, ya cubierto por `tests/controllers/marketing.actions.test.ts`
con mocks de `consumeRateLimit`/`previewSegment`.

## Estado de la suite después de esta pasada

`npm run typecheck` y `npm run lint`: verdes.

Los cinco tests que `test-engineer` dejó en rojo a propósito (Hallazgos 1, 9,
10, más los dos de `tests/db/coupon-shape-check-max-discount-sign.test.ts`
para el Hallazgo 11) pasan ahora, verificados uno por uno:
`tests/models/order.model.test.ts`, `tests/controllers/marketing.actions.test.ts`,
`tests/models/campaign.model.test.ts` por mis cambios de código; el de
`coupon-shape-check-max-discount-sign.test.ts` pasa porque el hilo principal
ya aplicó el CHECK de `max_discount_cents` en la migración en paralelo (no lo
toqué yo).

**Aviso para el hilo principal — no es mío para resolver:** un `npm test`
completo corrido en este momento muestra 2 archivos rojos que NO están en mi
lista de hallazgos asignados y que tampoco existían como fallas al arrancar
esta tarea: `tests/db/coupon-redemption-lifecycle.test.ts` (6 casos, incluida
"la carrera del último uso, con concurrencia REAL") y
`tests/db/coupon-create-order-discount.test.ts` (1 caso, idempotencia +
cupón). Confirmé con `git stash` que fallan igual con y sin mis cambios de
TypeScript — no los causé yo. Por el contenido de los casos (conteos que no
cierran, y un caso de "liberar sin pagar" que espera `cancelled_unpaid` y
recibe `expired`) y por lo que vi en `git diff -- supabase/migrations/
20260901130000_cupones.sql` (el hilo principal ya está escribiendo el lock
explícito de `sync_coupon_counters` para el Hallazgo 2 y la rama
`auth.uid() is null` para el Hallazgo 4 mientras yo trabajaba), asumo que es
la migración en progreso, no algo que me corresponda tocar — lo dejo
anotado por si el estado no termina de cerrar solo. No toqué
`supabase/migrations/**` en ningún momento.
