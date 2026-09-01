# T3B — Backend: el mail de campaña, el cron y la vía comercial

Agente: `senior-backend-engineer`. Implementa `docs/pipelines/2026-08-31-clientes-y-cupones/01-tasks.md`,
sección **T3B**. Corrido en paralelo con T1B (`coupon.model.ts`/`campaign.model.ts`/
`marketing.actions.ts`) y T2B (`order.model.ts`/checkout).

## Archivos tocados

Nuevos:
- `src/emails/store-coupon-campaign.tsx` — la novena plantilla, el mail de campaña.
- `src/emails/store-campaign-quota-request.tsx` — la décima, el pedido de más cupo a ventas.
- `src/services/notifications/email/campaign.tsx` — el drenaje (`drainCampaignQueue`) y la vía
  comercial (`sendCampaignQuotaRequest`).
- `src/app/api/cron/campaigns/route.ts` — el handler de cron, `GET` + `CRON_SECRET` en tiempo
  constante.

Modificados (solo lo que la spec autorizaba):
- `src/services/notifications/email/email.port.ts` — `EmailVars` suma `discountCents?` y
  `couponCode?` (opcionales: la mayoría de los pedidos no tiene cupón).
- `src/emails/order-receipt.tsx` — línea de descuento en el desglose existente, **solo si
  `discountCents > 0`**.
- `src/services/notifications/email/payment-change.tsx` — `CHANGE_LABELS += coupon: 'un cupón de
  descuento'`.
- `src/emails/store-payment-change-code.tsx` y `store-payment-change-notice.tsx` — copy
  generalizado (ver más abajo). Sin cambios de estructura ni de `Vars`.
- `src/lib/env.server.ts` — `RESEND_CAMPAIGN_FROM_EMAIL` y `SALES_EMAIL`, las dos
  `z.string().optional()` sin default.

## Contratos que expone (para quien integre)

### `src/services/notifications/email/campaign.tsx`

```ts
export type CampaignDrainResult = { claimed: number; sent: number; failed: number }
export async function drainCampaignQueue(): Promise<CampaignDrainResult>

export type CampaignQuotaRequestResult =
  | { status: 'sent' | 'skipped'; error?: string }
  | { status: 'failed'; error: string }

export async function sendCampaignQuotaRequest(p: {
  storeId: number
  storeName: string
  storeSlug: string
  ownerEmail: string
  customersTotal: number
  customersWithEmail: number
  campaignRecipients: number
  daysNeeded: number
  activeCoupons: number
  redemptionsLastMonth: number
  message: string | null
}): Promise<CampaignQuotaRequestResult>
```

`marketing.actions.ts` (T1B) ya integró `sendCampaignQuotaRequest` en
`requestCampaignQuotaAction` — verificado leyendo su código, los nombres de campo coinciden
(`activeCoupons` ← `stats.activeCouponsCount`). No hizo falta ida y vuelta.

### `src/app/api/cron/campaigns/route.ts`

`GET` únicamente (no `POST`, a diferencia de `/api/cron/outbox`), mismo patrón que
`/api/cron/reconcile` y `/api/cron/auto-advance`: `timingSafeEqual` sobre `Buffer` con chequeo de
longitud antes de comparar. Responde el `CampaignDrainResult` como JSON.

### `email.port.ts` / `order-receipt.tsx`

`EmailVars.discountCents?: number` y `EmailVars.couponCode?: string`. La plantilla muestra la
línea `Descuento {couponCode}  −{money(discountCents)}` entre Subtotal y Total, **solo si
`discountCents > 0`**. Con eso, quien arme el `EmailVars` en `order.model.ts`/T2B puede pasar
`discountCents: 0` (o no pasarlo) para un pedido sin cupón sin que la plantilla haga nada raro.

## Decisión: terminé consumiendo `campaign.model.ts` para claim/settle, no llamando la RPC directo

Arranqué este slice antes de que `src/models/campaign.model.ts` (T1B) existiera en el filesystem
(instrucción explícita: "si necesitás una función de `campaign.model.ts`, asumí la firma que dice
la spec de T1B"). Diseñé `drainCampaignQueue()` llamando `admin.rpc('claim_campaign_recipients', …)`
y `admin.rpc('settle_campaign_recipient', …)` **directo**, con el mismo criterio que
`dispatchPendingEvents()` en `src/services/pos/webhook.adapter.ts` (que tampoco pasa por un
modelo para `claim_event_deliveries`/`settle_event_delivery`).

A mitad de la implementación, T1B terminó y `campaign.model.ts` apareció con exactamente
`claimCampaignRecipients(budget, maxAttempts, retrySeconds)`, `settleCampaignRecipient(input)` y
el tipo `CampaignRecipientClaim` — con un comentario en su propio archivo que dice literalmente
*"Lo que el drenaje (`/api/cron/campaigns`, T3B) necesita"*. Refactoricé `campaign.tsx` para
**consumir esas funciones** en vez de llamar las RPC a mano, porque:
1. Ya existían y typechequeaban limpio.
2. Es lo correcto por arquitectura: "M — ÚNICO lugar que habla con Postgres", y con el modelo ya
   construido, duplicar la llamada a la RPC en un service es indirección que además puede
   divergir (por ejemplo si el modelo cambia el mapeo de columnas).

**Resultado**: `drainCampaignQueue()` importa `claimCampaignRecipients`/`settleCampaignRecipient`/
`CampaignRecipientClaim` de `@/models/campaign.model` y no llama ninguna RPC de campañas por su
cuenta. Esto se mantuvo así incluso después de que apareciera (y se sacara) el workaround
descrito en la siguiente sección — el hallazgo de ahí no cambió esta decisión, solo la afinó.

## Hallazgo: el cierre de campaña tenía dos huecos, y se arregló en la migración (no en la app)

Durante la implementación encontré que `settle_campaign_recipient` cerraba mal el ciclo de una
campaña, y en un primer momento lo tapé desde `campaign.tsx` con dos helpers de aplicación
(`finalizeExhaustedCampaigns`/`forceFailCampaign`) que escribían `coupon_campaigns`/
`campaign_recipients` directo con el admin client. El coordinador señaló, correctamente, que ese
parche contradecía la doctrina del feature —los contadores se recalculan desde el libro mayor,
nadie los escribe a mano, vale para `reserved_count`, `redeemed_count` y para los tres de la
campaña— y que el hueco real era más grande de lo que yo había diagnosticado. Se arregló del lado
correcto (la migración) y **saqué los dos helpers**: `campaign.tsx` ya no escribe una sola columna
de esas dos tablas, todo el claim/settle pasa por `campaign.model.ts` (T1B).

### Los dos huecos reales, y cómo quedaron cerrados en `supabase/migrations/20260901130000_cupones.sql`

1. **Cola vacía con cero envíos se reportaba `sent`.** `settle_campaign_recipient` ponía
   `status = 'sent'` con solo mirar `queued = 0`, sin mirar si algo salió de verdad. Una campaña
   donde Resend rechazó a TODOS los destinatarios (key vencida, dominio caído) terminaba
   `sent`/`sent_count = 0` — verde, con cara de éxito, silenciosamente mintiendo. Ahora el `case`
   de status distingue explícito: `queued > 0` → sigue como estaba; `sent > 0` → `sent`;
   si no hay `sent` pero sí `failed` → `failed`; si no hay ni `sent` ni `failed` (todo `skipped`,
   nada falló y nada se mandó) → `sent`.
2. **El paso a `failed` de la última fila ocurre en el `claim`, no en un `settle` posterior.**
   `claim_campaign_recipients` marca las filas agotadas (`attempts >= p_max_attempts`) a `failed`
   en su propio `update`, y después de eso no hay ningún `settle_campaign_recipient` que se
   dispare para esas filas — nadie vuelve a tocar `coupon_campaigns`. Mi diagnóstico original solo
   veía este hueco (lo describí como "el cierre nunca se entera"); la campaña quedaba en `sending`
   para siempre, indistinguible de una que sigue drenando, con la barra de progreso congelada. El
   arreglo: `claim_campaign_recipients` ahora recalcula y cierra `coupon_campaigns` en el MISMO
   `update` que marca las filas agotadas, con el mismo criterio de status de arriba.

Verificado por el coordinador ejecutando los tres casos:

| Caso | Antes | Ahora |
|---|---|---|
| Los dos destinatarios fallan | `sent`, 0 enviados | `failed`, 0/2, cerrada |
| Uno sale y el otro falla | — | `sent`, 1/1 |
| Los dos salen | `sent` | `sent`, 2/0, cerrada |

### Qué cambió en `campaign.tsx` como consecuencia

- Se borraron `finalizeExhaustedCampaigns`, `forceFailCampaign`, `recomputeCampaignCounts` y
  `countByStatus` enteros, y con ellos el import de `createAdminClient` (ya no se usa nada del
  admin client en este archivo — todo pasa por `campaign.model.ts`).
- `CampaignDrainResult` perdió el campo `finalized` (ya no hay un paso de reconciliación separado
  que reportar: la migración cierra la campaña sola, en el mismo claim/settle que ya se estaba
  llamando).
- El camino de "sin `RESEND_API_KEY` o sin remitente" dejó de cortar la campaña de inmediato:
  ahora simplemente no llama a Resend y asienta cada destinatario como fallido vía
  `safeSettle`/`settleCampaignRecipient` (que los deja `queued` con el error anotado, igual que un
  rechazo transitorio). El cierre a `failed` ocurre cuando los 3 intentos se agoten, en el
  `claim_campaign_recipients` de un tick siguiente — ya no hay un camino "rápido" separado del
  camino normal, y eso es correcto: es exactamente la misma doctrina de "un solo lugar cierra la
  campaña" aplicada también a este caso, no solo al de rechazo de Resend.

## Skill de Resend + hallazgo de tipos

Consulté Context7 (`/websites/resend`) antes de escribir `campaign.tsx`, específicamente:
- Batch (`resend.batch.send(items, { idempotencyKey })`) — confirmado: la clave va en las
  *options* del batch completo, no por email.
- `List-Unsubscribe` / `List-Unsubscribe-Post` — confirmado: van en `headers` **por email**,
  Resend no los inyecta ni en `/emails` ni en `/emails/batch`.
- Idempotencia: mismo payload + misma clave → devuelve el id original; payload distinto + misma
  clave → `409`. Confirma exactamente lo que pedía la spec sobre el sufijo de contenido.

**Hallazgo de tipos, no de comportamiento**: el tipo `CreateBatchSuccessResponse<Options>` del SDK
(`resend@6.24`) intersecta `{ data: {id:string}[] }` con `Record<string, never>` cuando
`Options['batchValidation']` no es literalmente `'permissive'` (nuestro caso: usamos el default
`'strict'`). Esa intersección colapsa `data` a `never` en TypeScript — lo reproduje aislado en un
archivo de prueba antes de asumir que era un bug del SDK y no mío. Lo resolví con un cast puntual
documentado en el código (`sendResult.data as { id: string }[] | null`), justificado porque el
shape real en runtime es el documentado (array de `{id}` en el mismo orden enviado). No es algo
para arreglar en este repo — es una limitación de los tipos publicados del SDK.

## Copy generalizado en `store-payment-change-code.tsx` / `store-payment-change-notice.tsx`

`CHANGE_LABELS` ya parametrizaba el mecanismo por `kind`, pero el texto alrededor asumía "pagos"
en varios lugares:
- `-code.tsx`: título del `<title>` sin cambios; heading pasó de "Confirmá el cambio en tus pagos"
  a "Confirmá este cambio"; `previewText` de "un cambio en los pagos de X" a "un cambio en X". El
  resto del cuerpo ya usaba `changeLabel` y no mencionaba "pagos" explícito, así que no tocó.
- `-notice.tsx`: `<title>` de "Movimiento en los pagos de X" a "Un cambio pedido en X"; heading de
  "Alguien pidió cambiar tus pagos" a "Alguien pidió hacer un cambio"; la línea de riesgo que decía
  *"mientras no uses el código, la plata sigue entrando a tu cuenta de siempre"* (asume que el
  cambio es sobre dinero que entra a una cuenta, falso para un cupón) pasó a *"mientras no
  confirmes con el código, nada cambia"*; el footer de "cada vez que se pide un cambio en los
  pagos" a "cada vez que se pide un cambio sensible".

No forkeé la plantilla ni agregué una cuarta (`StorePaymentChangeCodeVars`/`Vars` sin cambios de
forma): la spec era explícita en que el mecanismo ya soporta `kind` y que forkear sería el error.

## Business rules / invariantes implementadas (spec para `test-engineer`)

1. **Ninguna fila en `notifications` por una campaña.** `campaign.tsx` no importa ni usa
   `logNotification`/`notifications` en ningún punto — el log de la campaña es
   `campaign_recipients`, que ya trae `chunk_index`/`attempts`/`last_error` (T1B/migración). No
   necesita prueba de integración nueva de mi parte: es ausencia de código, verificable por
   lectura. Si se quiere una prueba db, sería: correr `drainCampaignQueue()` contra una campaña de
   prueba y verificar `select count(*) from notifications where …` no cambia.
2. **La clave de idempotencia cambia con la membresía del chunk, no con un reintento del mismo
   contenido.** `contentHash = sha256(recipientIds ordenados).slice(0,16)`,
   `idempotencyKey = campaign/{campaignId}/{chunkIndex}/{contentHash}`. Es pura función de los
   `recipientId` que trae el claim — **necesita base real** para probarse de punta a punta (dos
   claims con una baja en el medio deben dar distinto hash), pero la función del hash en sí
   (`createHash('sha256')...`) es determinística y se puede probar sin DB extrayendo la lógica a
   una función pura si `test-engineer` lo prefiere así — hoy vive inline en `drainCampaignQueue`,
   no exportada. **Si hace falta testear el hash en aislamiento, avisar: lo extraigo a una función
   exportada en un slice de seguimiento** (no lo hice acá para no tocar de más el archivo un rato
   antes del cierre).
3. **Headers por destinatario.** Cada item del batch lleva
   `'List-Unsubscribe': <{apexUrl}/baja/{token}/one-click>` y
   `'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'`, con **el token de ESE destinatario**
   (`row.unsubscribeToken`, que viene de `claimCampaignRecipients`, que a su vez sale de
   `store_customers.unsubscribe_token` por el join de la RPC). No hay camino donde dos
   destinatarios del mismo chunk compartan token — necesita base real para probarlo end-to-end
   (verificar que el payload real mandado a Resend tiene N headers distintos para N destinatarios);
   sin mock de Resend no se puede verificar sin red.
4. **Sin `RESEND_CAMPAIGN_FROM_EMAIL` → sale del remitente de siempre y loguea.**
   `drainCampaignQueue` hace `fromAddress = env.RESEND_CAMPAIGN_FROM_EMAIL ?? env.RESEND_FROM_EMAIL`
   y, si el primero falta pero hay un `fromAddress` igual (por el segundo), llama
   `log.warn(...)` antes de mandar. Sin `RESEND_FROM_EMAIL` tampoco, no hay `fromAddress` en
   absoluto y se toma el camino de `forceFailCampaign` (ver el punto 5). Testeable sin DB: mockear
   `serverEnv()` para devolver solo `RESEND_FROM_EMAIL` y verificar que se llamó `resend.batch.send`
   con `from` conteniendo esa dirección, y que `log.warn` se llamó.
5. **Sin `RESEND_API_KEY` → la campaña queda `failed`, ningún pedido se rompe.** Camino
   `forceFailCampaign`: marca las filas del chunk `failed` y recalcula/cierra
   `coupon_campaigns.status = 'failed'` en la MISMA invocación de `drainCampaignQueue` (no espera
   3 intentos). **En cambio el código de 6 dígitos SÍ tira** — no toqué ese camino
   (`sendPaymentChangeCode` en `payment-change.tsx` sigue igual, con `DomainError`). Testeable sin
   DB con un fake de `createAdminClient()`/`claimCampaignRecipients` (o con base real, mockeando
   solo `serverEnv()` sin key y verificando el estado final de las dos tablas).
6. **El cron es idempotente entre ticks solapados**: descansa enteramente en el
   `for update skip locked` de `claim_campaign_recipients` (sin tocar, RPC de la migración) más la
   clave de idempotencia de Resend como segunda red. **Necesita base real**: dos llamadas
   concurrentes a `drainCampaignQueue()` (o directo a la RPC) no deben reclamar el mismo
   `recipient_id`. No es probable en un test sin Postgres real con locks de verdad.
7. **El presupuesto no pasa de 15/día, ventana UTC.** No es lógica mía: vive en
   `claim_campaign_recipients` (`v_day_start := date_trunc('day', now() at time zone 'utc')...`).
   Yo solo paso `CAMPAIGN_DAILY_BUDGET` (de `lib/coupon.ts`, sin tocar) como `p_budget`. Necesita
   base real para probar el corte a las 15.
8. **Cupón vencido a mitad de drenaje → `stopped`, resto `skipped`, ningún mail con código
   muerto.** Enteramente dentro de `claim_campaign_recipients` (chequea el estado del cupón antes
   de reclamar el chunk). Mi código no interviene: si el claim devuelve `[]` porque la campaña se
   cortó, `drainCampaignQueue` simplemente no manda nada ese tick, sin error. Necesita base real.
9. **`order-receipt` con descuento: subtotal − descuento + envío = total.** No pude verificar el
   `+ envío` porque **la plantilla actual no tiene una línea de envío** (no hay `deliveryFeeCents`
   en `EmailVars` hoy) — el desglose existente es solo Subtotal → [Descuento] → Total. Agregué
   la línea de descuento en ese desglose, `solo si discountCents > 0`, entre Subtotal y Total. Es
   responsabilidad de quien arma el `EmailVars` (T2B, `order.model.ts`) pasar
   `subtotalCents - discountCents (+ lo que corresponda de envío, si existiera) === totalCents`; la
   plantilla no recalcula nada, solo muestra lo que le llega. **Verificable sin DB**: renderizar
   `OrderReceiptEmail` con `discountCents > 0` y comprobar que aparece la línea con el signo menos
   y el código; renderizar con `discountCents` ausente/0 y comprobar que NO aparece.
10. **Ningún body de respuesta de Resend en los logs.** Todos los `log.error`/`log.warn` de
    `campaign.tsx` pasan `error.message` o un string armado a mano, nunca `error` ni `data`
    completos. Verificable por lectura de código; si se quiere una prueba automática, un grep de
    `resendError:\s*(?!.*\.message)` sobre el archivo alcanzaría, no hace falta DB.

## Lo que asumí de T1B (documentado por si hace falta reconciliar)

- Usé `claimCampaignRecipients(budget, maxAttempts, retrySeconds?)` y
  `settleCampaignRecipient({ recipientId, ok, providerRef?, error? })` de
  `@/models/campaign.model`, más el tipo `CampaignRecipientClaim` — todo con los nombres exactos
  que T1B terminó exportando (lo confirmé leyendo el archivo antes de cerrar, no antes de
  escribir: empecé asumiendo y terminé consumiendo el real).
- Pasé `CAMPAIGN_MAX_ATTEMPTS = 3` explícito al claim (el default de la función es 5); es el
  número que pide la spec de este slice ("3 intentos → failed"), no un cambio al default de T1B.
- No usé `getMarketingQuotaStats` de `campaign.model.ts` — eso lo consume `marketing.actions.ts`
  (T1B), que arma el objeto y se lo pasa a mi `sendCampaignQuotaRequest`. Confirmé que los nombres
  de campo coinciden leyendo su código ya terminado.

## Pendientes / seguimiento

1. **Timezone de `coupon_ends_at` en el mail de campaña.** `claimCampaignRecipients` no devuelve
   el timezone del local, así que `formatCouponEndsAt()` en `campaign.tsx` formatea la vigencia en
   **UTC explícito** (no el de la tienda). Es una fecha de calendario ("10 de septiembre"), así que
   el desfase de unas horas casi nunca cambia el día mostrado, pero no es exacto. Si se quiere
   corregir: agregar `stores.timezone` (o el campo que corresponda) a la `returns table` de
   `claim_campaign_recipients` — toca la migración, así que lo dejo pedido y no lo hago yo.
2. **El hash de idempotencia vive inline, no exportado.** Si `test-engineer` necesita probarlo en
   aislamiento (sin DB), aviso y lo extraigo a una función pura exportada — no lo hice de entrada
   para no tocar más superficie de la necesaria cerca del cierre del slice.
3. `npm run typecheck` y `npm run lint` están verdes para todos mis archivos (confirmado con un
   grep final de los nombres de mis archivos contra la salida de `tsc`: cero coincidencias, y
   `tsc --noEmit` sin ningún error en todo el repo al momento de cerrar). `npm run lint` da cero
   problemas. `npm test` corre 83 archivos / 1023 tests en verde (T3B no agrega tests, como
   corresponde).
