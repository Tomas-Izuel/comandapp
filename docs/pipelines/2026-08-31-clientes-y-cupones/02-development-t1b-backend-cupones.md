# T1B — Backend: cupones, campañas y el segundo factor

Implementado por `senior-backend-engineer`. Consumió `01-tasks.md` (sección T1B) y
`00-architecture.md` §5.7, §5.9.1, §5.9.4, §5.10, §5.11.3, §5.11.4, §5.13, §5.14.5,
§5.14.6, más la migración `20260901130000_cupones.sql` (ya aplicada en local).

## Archivos creados

- `src/models/schemas/coupon.schema.ts` — contratos Zod: `couponInputSchema`,
  `campaignSegmentSchema`, `campaignPreviewInputSchema`, `campaignCreateInputSchema`,
  `campaignQuotaRequestInputSchema`, `couponCodeSchema`, más los validadores de las
  respuestas `jsonb` de las RPC (`campaignSegmentPreviewRpcSchema`,
  `couponDetailRpcSchema`).
- `src/models/coupon.model.ts` — único lugar que habla con Postgres para `coupons`
  y `coupon_redemptions`.
- `src/models/campaign.model.ts` — único lugar que habla con Postgres para
  `coupon_campaigns` y `campaign_recipients`.
- `src/controllers/marketing.controller.ts` — lecturas (`import 'server-only'`).
- `src/controllers/marketing.actions.ts` — Server Actions (`'use server'` en la
  primera línea, solo funciones async exportadas).

No toqué `src/lib/rate-limit-policy.ts`: los seis baldes de B ya estaban puestos
cuando arranqué, tal como avisaba el brief. Tampoco toqué `types.ts`, `lib/coupon.ts`
ni `lib/money.ts`.

## Contratos expuestos (para T4B y para quien integre)

### `coupon.model.ts`

```ts
generateCouponCode(): string
listCoupons(storeId: number): Promise<Coupon[]>
getCouponById(storeId: number, couponId: number): Promise<Coupon | null>
getCouponDetail(storeId: number, couponId: number): Promise<CouponDetail>   // cliente de SESIÓN
createCouponDraft(storeId: number, input: CouponInput, createdBy: string): Promise<Coupon>
updateCoupon(storeId: number, couponId: number, input: CouponInput): Promise<Coupon>
setCouponStatus(storeId: number, couponId: number, status: CouponStatus): Promise<Coupon>
deleteUnusedCoupon(storeId: number, couponId: number): Promise<void>
validateCouponForCart(params: {
  storeId: number
  code: string
  subtotalCents: number
  paymentMethod: PaymentMethod
  customerPhoneE164?: string
}): Promise<CouponAppliedQuote>   // NUNCA TIRA (salvo fallo de infraestructura real)
```

`validateCouponForCart` es la función que consume T2B desde `order.model.ts`
(`resolveCoupon`) — verifiqué su código ya escrito y el nombre/forma de los
parámetros coincide exactamente con lo que T2B ya está llamando, así que no hizo
falta ningún ajuste de ese lado.

### `campaign.model.ts`

```ts
listCampaigns(storeId: number): Promise<CouponCampaign[]>
previewSegment(storeId: number, segment: CampaignSegment, couponId: number): Promise<CampaignPreview>   // cliente de SESIÓN
enqueueCampaign(storeId: number, input: { couponId, segment, subject, message: string | null, createdBy: string }): Promise<number>   // service_role
claimCampaignRecipients(budget?, maxAttempts?, retrySeconds?): Promise<CampaignRecipientClaim[]>   // service_role — para el cron de T3B
settleCampaignRecipient(input: { recipientId, ok, providerRef?, error? }): Promise<void>   // service_role — para el cron de T3B
getMarketingQuotaStats(storeId: number): Promise<MarketingQuotaStats>   // { customersTotal, customersWithEmail, activeCouponsCount, redemptionsLastMonth }
```

`CampaignRecipientClaim` (exportado desde `campaign.model.ts`) es el tipo que
`/api/cron/campaigns` (T3B) necesita para armar cada mail: trae ya resueltos el
nombre/token del cliente, el nombre/slug de la tienda y todos los campos del cupón
(código, tipo de descuento, montos, vencimiento).

### `marketing.controller.ts`

```ts
getCouponsForStore(storeId): Promise<Coupon[]>
getCouponDetailForStore(storeId, couponId): Promise<CouponDetail>
getCampaignsForStore(storeId): Promise<CouponCampaign[]>
```

Cada una repite `requireStoreMembership(storeId, { role: 'owner' })` como defensa
en profundidad (la page ya hace su propio gate; `coupon_detail`/
`campaign_segment_preview` lo vuelven a chequear una tercera vez en Postgres).

### `marketing.actions.ts`

```ts
createCouponDraftAction(storeId, input: CouponInput): Promise<ActionResult<Coupon>>
updateCouponAction(storeId, couponId, input: CouponInput): Promise<ActionResult<CouponUpdateResult>>
  // CouponUpdateResult = { requiresConfirmation: false, coupon } | { requiresConfirmation: true, pending: PendingChangeStarted }
setCouponStatusAction(storeId, couponId, status: 'draft' | 'paused'): Promise<ActionResult<Coupon>>
  // 'active' NO es un status válido acá a propósito — ver más abajo.
deleteCouponAction(storeId, couponId): Promise<ActionResult<void>>
requestCouponActivationAction(storeId, couponId): Promise<ActionResult<PendingChangeStarted>>
confirmCouponChangeAction(storeId, requestId, code): Promise<ActionResult<void>>
previewCampaignAction(storeId, input: { couponId, segment: CampaignSegment }): Promise<ActionResult<CampaignPreview>>
sendCampaignAction(storeId, input: { couponId, segment, subject, message? }): Promise<ActionResult<{ campaignId: number }>>
requestCampaignQuotaAction(storeId, input: { requestedRecipients, daysNeeded, message }): Promise<ActionResult<void>>
```

`CampaignSegment` es el tipo de `types.ts` (discriminado por `kind: 'all' | 'top_n' | 'min_spent'`).
`CouponInput`/`CouponUpdateResult` están exportados desde `coupon.schema.ts` /
`marketing.actions.ts` respectivamente, para que T4B los importe tal cual.

## Decisiones no obvias

### 1. `setCouponStatusAction` nunca acepta `'active'`

Diseño deliberado, no un descuido: pasar a `active` (desde `draft` o desde `paused`)
**siempre** pasa por `requestCouponActivationAction` + `confirmCouponChangeAction`
(pide el código de 6 dígitos). `setCouponStatusAction` solo acepta `'draft' | 'paused'`
— las dos direcciones de "apagar", que nunca piden código ("no apagar se apaga sin
código", aprobado por el dueño del producto). Si T4B necesita un único botón de
"activar/pausar" en la UI, tiene que despachar a una acción distinta según la
dirección.

### 2. Editar un cupón que NO está `active` es siempre gratis, sin importar cuánto escale

Leí con cuidado la tabla de §5.11.3 y noté que no hay una fila explícita para
"editar un cupón pausado". Razoné así: mientras un cupón no está `active`, no hay
nada que canjear (`enforce_coupon_redemption` exige `status = 'active'`), así que
cualquier edición —aunque en abstracto "escale" (`requiresConfirmation` diría que
sí)— es inerte hasta que alguien lo reactive. Y reactivar **siempre** pide código,
sin excepción, sea cual sea la forma que el cupón tenga en ese momento. Conclusión:
el segundo factor queda correctamente en el checkpoint de la reactivación, y la
edición previa (mientras está apagado) no necesita gatear nada.

Consecuencia de diseño: `updateCouponAction` solo llama a `requiresConfirmation()`
cuando `current.status === 'active'`. Si el cupón está `draft` o `paused`, aplica
el cambio directo con `updateCoupon()`, sin tocar `store_pending_changes`.

**Esto no está en el criterio de aceptación explícito de T1B y es una inferencia
mía sobre el diseño de §5.11.3. Si el dueño del producto lo hubiera querido de otra
forma (por ejemplo, pedir código también al escalar un cupón pausado), esto
necesita un ajuste chico y localizado en `updateCouponAction`.**

### 3. `validateCouponForCart` replica el ORDEN exacto de `create_order` en SQL

No usé `couponState()` para derivar el rechazo (aunque existe y lo uso para otras
cosas): en cambio repetí el orden literal de los chequeos de la RPC (status activo
→ `starts_at` → `ends_at` → `min_subtotal` → `payment_methods` → tope global
`>=` → tope por teléfono), para que el mensaje que un cliente ve en la cotización
sea el mismo que recibiría si llegara a confirmar el pedido con esa misma
combinación de fallas. Con `couponState()` el orden habría sido distinto (agrupa
`exhausted` antes que `min_subtotal`) y en un cupón que falla dos chequeos a la vez
el mensaje mostrado podría no coincidir con el de `create_order`. Documentado en el
comentario de la función.

### 4. `validateCouponForCart` sin `customerPhoneE164` salta el tope por teléfono

`GET /api/orders` (la cotización) no manda el teléfono del cliente — lo confirmé
leyendo `previewQuerySchema` en `api/orders/route.ts` antes de que T2B lo tocara.
Hice el parámetro opcional: sin teléfono, el tope por teléfono (CPN06) se saltea en
la cotización y lo aplica igual `create_order` en el commit. El peor caso es que la
cotización diga "aplicado" y el `POST` rechace con "Ya usaste ese cupón" — que es
exactamente el comportamiento que §5.9.4 ya acepta para el caso del método de pago
("nunca se concede un descuento que el servidor no volvería a conceder").

### 5. El generador de código: mismo alfabeto y cutoff que `private.random_token`, en mayúsculas

`CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'` (31 caracteres, sin `0/O/1/I/L`),
CSPRNG (`node:crypto.randomBytes`) con rejection sampling y cutoff en 248 (= 8 × 31,
el múltiplo de 31 más grande que entra en un byte) — es literalmente el mismo
algoritmo que `private.random_token` en Postgres, solo que en mayúsculas para
matchear `coupons_code_check` (`^[A-Z0-9]{4,16}$`). **Nunca `Math.random()`.**

### 6. `getMarketingQuotaStats.redemptionsLastMonth` es una ventana móvil de 30 días, no el mes calendario

El plan dice "canjes del último mes" sin especificar si es calendario o móvil. Elegí
`now() - 30 días` porque es lo que un `.gte('created_at', ...)` puede hacer sin una
RPC nueva, y porque es la definición más simple de defender ("los últimos 30 días",
no "lo que va del mes"). Si el dueño del producto prefiere el mes calendario del
local (con el corte de timezone que el resto del dashboard ya usa), es un cambio
chico en `campaign.model.ts`.

### 7. `enqueueCampaign` no produce filas `skipped` por email inválido — seguí la RPC, no el texto del brief

El brief de T1B dice: *"Valida cada dirección con z.email() al encolar; las
inválidas nacen skipped."* Leí `enqueue_campaign` en la migración con cuidado (regla
del brief: "no adivines la firma, leela") y **la RPC ya filtra las direcciones
sintácticamente inválidas con `private.looks_like_email()` dentro del CTE
`eligible`, así que esas filas nunca se insertan** — ni siquiera como `skipped`.
`skipped` en este esquema está reservado para un caso distinto y documentado en la
migración: un cliente que se da de baja **entre** el encolado y el drenaje.

No agregué una segunda validación con `z.email()` en TypeScript antes de llamar a
la RPC porque hubiera sido, en el mejor caso, redundante (la RPC ya filtra) y en el
peor, inconsistente con lo que la base realmente hace (mi validación TS podría
aceptar o rechazar un caso límite distinto que la regex de Postgres). **Reporto
esta discrepancia entre el brief y el schema real** para que quede registrada: el
schema manda (según la jerarquía que el propio brief establece), y el schema no dio
lugar a un `skipped` por sintaxis.

### 8. `sendCampaignQuotaRequest` (T3B) landeó en paralelo con nombres de campo distintos a los que documenté primero

Diseñé `requestCampaignQuotaAction` contra un contrato hipotético
(`requestedByEmail`, `requestedRecipients`, `activeCouponsCount`) antes de que
`src/services/notifications/email/campaign.tsx` existiera. T3B lo escribió mientras
yo trabajaba, con: `ownerEmail`, `campaignRecipients`, `activeCoupons`. Actualicé mi
call site para matchear el contrato real de T3B (verificado leyendo el archivo, no
adivinado). `npm run typecheck` está verde en este punto — no quedó ninguna
discrepancia.

### 9. `store-pending-change.model.ts` ya tenía `subject_id` cuando llegué a tocarlo

El brief me pedía reusar `store_pending_changes` con `kind: 'coupon'` y
`subject_id = couponId`, y advertía sobre la trampa de invalidación
(`.is('subject_id', null)` vs `.eq(null)`). Cuando fui a implementarlo, alguien
—el hilo principal, presumo, dado que ese archivo no es de ningún slice de la
Entrega B— ya lo había hecho: `PendingChangeKind` incluye `'coupon'`,
`createPendingChange` acepta `subjectId?: number` y escribe/invalida correctamente
scopeado. **No toqué ese archivo**: solo lo consumí tal como está. Lo señalo porque
technically no es un archivo que el pipeline le asigne a nadie de la Entrega B, así
que si el hilo principal no fue quien lo escribió, vale la pena que alguien lo audite
igual (yo lo leí completo y el mecanismo es correcto y coincide con lo que
§5.11.3 pide).

## Rate limiting consumido (no editado)

| Balde | Dónde se consume | `onError` |
|---|---|---|
| `coupon_create:store` | `createCouponDraftAction` | `allow` (default) |
| `coupon_change:store` / `:day` | `startCouponPendingChange` (activar, reactivar, y editar-escalando un activo) | `deny` |
| `campaign_send:store` | `sendCampaignAction` | `deny` |
| `campaign_quota:store` / `:day` | `requestCampaignQuotaAction` | `allow` (default) |

`coupon_check:ip` es de T2B, no lo toqué.

## Errores de dominio y sus textos (verbatim de §5.9.4)

Viven en `COUPON_MESSAGES` (privado, `coupon.model.ts`), usados solo por
`validateCouponForCart`. La traducción de los SQLSTATE `CPN01..CPN10` en el camino
de **creación** del pedido es de T2B, en su propio archivo — no hay texto
compartido entre los dos caminos, tal como el brief indica.

## Lo que necesita una base real (`tests/db/`)

Traspaso literal de los criterios de aceptación de T1B en `01-tasks.md` — no
escribí tests, pero dejo la lista para el `test-engineer`:

1. La carrera del último uso: N requests paralelos con `max_redemptions = 1` → una
   reserva, el resto con "Ese cupón ya se agotó".
2. `coupons_within_cap_check` no se viola ni con `service_role`.
3. El off-by-one del trigger (`<` vs `<=`) en `enforce_coupon_redemption`.
4. El ciclo completo reservar → confirmar/liberar, con los contadores igualando
   siempre el `count(*)` del libro mayor.
5. `refunded` no libera; cancelar después de pagado tampoco.
6. Liberar libera cupo de verdad (otro cliente puede usar el cupón después).
7. `redeemed_count` es monótono.
8. `expire_pending_orders` libera sin haber sido modificada.
9. Idempotencia: mismo `idempotencyKey` dos veces con el mismo cupón → un pedido,
   un canje (esto es sobre todo de T2B, pero el trigger que lo sostiene es de esta
   migración).
10. `unique(order_id)` en `coupon_redemptions`.
11. Un cupón de otra tienda no se canjea (FK compuesta).
12. Un `draft`/`paused`/vencido/agotado no canjea nunca, ni con `service_role`.
13. Borrar un cupón con cualquier fila en el libro mayor (`released` incluida) →
    `23503` → `DomainError` de `deleteUnusedCoupon`.
14. El tope por teléfono cuenta solo `reserved`/`redeemed` (índice parcial).
15. `payment_methods = '{}'` rechazado; valor fuera del enum rechazado.
16. Un cupón restringido a `online` usado con `in_store` → rechazado en
    `create_order` (T2B) y en `validateCouponForCart` (acá, verificar con datos
    reales que el mensaje sea el de §5.9.4).
17. Las cuatro tablas nuevas: `select` con la publishable key denegado para `anon`
    y `authenticated`.
18. `coupon_detail`/`campaign_segment_preview` con otro `store_id` → `42501`; con
    `service_role` → fallan (no hay `auth.uid()`) — **probar específicamente que
    `getCouponDetail`/`previewSegment` usan el cliente de sesión y no el admin**.
19. `claim_campaign_recipients` con dos llamadas concurrentes → ningún destinatario
    reclamado dos veces.
20. El presupuesto diario: con 15 ya mandados hoy, la siguiente llamada devuelve
    cero.
21. `claim_store_pending_change` con `kind = 'coupon'` funciona sin haber tocado la
    función; a los 5 intentos devuelve cero filas.
22. Activar el cupón A y después el B no invalida el código de A (`subject_id`).
23. **Nuevo, específico de mi implementación**: `updateCouponAction` sobre un cupón
    `paused` aplica el cambio de inmediato (sin pending change), y una posterior
    `requestCouponActivationAction` sobre ESE cupón sigue pidiendo código.

Sin base (puros, ya verificables por el test-engineer sin Docker):

- `generateCouponCode()`: siempre 8 caracteres, siempre del alfabeto declarado,
  nunca `0/O/1/I/L`.
- `validateCouponForCart` con un código con formato inválido (`safeParse` falla) →
  `rejected` con el mensaje de "no existe", sin tocar la base para el `count`.
- El orden de los chequeos en `validateCouponForCart` (un cupón que falla dos
  condiciones a la vez muestra la que create_order mostraría primero).
- `getMarketingQuotaStats` — mockeable, verificar que arma las cuatro queries con
  los filtros correctos (`store_id`, `status = 'active'`, `status = 'redeemed'`,
  ventana de 30 días).

## Pendiente / bloqueado para el hilo principal

1. **La decisión #2 de arriba** (editar un cupón pausado/draft nunca pide código,
   sin importar cuánto escale) es una inferencia mía sobre una laguna de §5.11.3.
   Si no es la lectura correcta, el fix es acotado.
2. **`getMarketingQuotaStats.redemptionsLastMonth`** usa ventana móvil de 30 días,
   no mes calendario del local. Ver decisión #6.
3. **`tests/models/order.model.test.ts` no tipa** (`TS2719`, "Two different types
   with this name exist, but they are unrelated", sobre `couponCode` en
   `createOrderSchema`). Verifiqué que no toqué ni `order.schema.ts` ni ese test:
   es un error preexistente en la intersección de T2B y el test-engineer, no de
   este slice. `npm run typecheck` queda con ese único error ajeno a mis cinco
   archivos; `npm run lint` está en cero, y `npm test` corre 1023/1023 tests en
   verde (el error de `tsc` no bloquea a `vitest`, que transpila distinto).

## Verificación final

- `npm run typecheck`: verde para mis 5 archivos. El único error restante en todo
  el repo es el de `tests/models/order.model.test.ts` de arriba, fuera de mi
  ownership.
- `npm run lint`: 0 errores, 0 warnings (repo completo).
- `npm test`: 83 archivos, 1023 tests pasan, 4 skip (los de `tests/db/`, sin
  Docker).
