# T2 — Backend: pedido por transferencia, comprobante y purga

Agente: `senior-backend-engineer`. Implementa T2.1 a T2.8 de `01-tasks.md`. Referencias de diseño: `00-architecture.md` §2.2, §5.5-§5.10.

## Archivos tocados (todos de mi propiedad exclusiva)

- `src/models/schemas/order.schema.ts` — `paymentMethodSchema` gana `'transfer'`; `MAX_RECEIPT_BYTES` y `receiptUploadSchema` nuevos.
- `src/models/order.model.ts` — gate de `transferPaymentEnabled` en `createOrder`, `initialStatus` invertido, `updateOrderStatus` invertido, `bankAccount` poblado en `getOrderByToken`, y seis funciones nuevas (sección "7.5 Transferencia bancaria").
- `src/lib/storage.ts` — `ORDER_RECEIPTS_BUCKET`, `orderReceiptPath()`.
- `src/controllers/checkout.controller.ts` — tercera rama en `submitOrder`; `sendReceiptEmail`/`sendConfirmedWhatsapp` pasan a exportarse (las reusa `kitchen.controller.ts`); `toEmailPaymentMethod()` nuevo (ver "Gap de contrato" abajo) — **el hilo principal lo borró en la integración**, ver la nota al final de ese punto.
- `src/controllers/kitchen.controller.ts` — `confirmTransferPayment()`, `getTransferReceipt()`.
- `src/controllers/kitchen.actions.ts` — `confirmTransferPaymentAction`, `transferReceiptUrlAction`, `fetchPendingTransfersAction`.
- `src/app/api/orders/[token]/comprobante/route.ts` **(nuevo)** — `POST` multipart.
- `src/app/api/orders/route.ts` — el `GET` de cotización suma `transferPaymentEnabled`.
- `src/app/api/cron/cleanup/route.ts` — suma la purga de comprobantes.

No toqué nada de `src/models/store*.ts`, `store.mapper.ts`, `store-availability.ts`, `cbu.ts`, `services/**`, `admin.*`, `checkout.actions.ts`, `views/**`, el resto de `app/**`, `types.ts`, `rate-limit-policy.ts`, `supabase/migrations/**` ni `tests/**` — todos ya traían lo que T0/T1 les tocaba cuando empecé (T1 y las demás tandas corrieron en paralelo y ya terminaron).

## Contrato del endpoint — `POST /api/orders/[token]/comprobante`

Esto es lo que T4/T5 tienen que consumir.

**Request**: `multipart/form-data`, un solo campo de archivo llamado **`file`**. No hay otros campos — el pedido lo resuelve el `token` de la URL, nunca el body.

**Respuesta 200** (`Cache-Control: private, no-store`):
```json
{ "order": OrderPublicView }
```
Es el mismo objeto que devuelve `GET /api/orders/[token]`, ya con `transferReceiptUploadedAt` seteado — así el browser no tiene que reconciliar dos formas del pedido, solo re-renderiza con la vista que ya sabe pintar.

**Errores** (todos `{ "error": string }`, algunos con `"field"` si aplica — nunca el detalle interno):

| Status | Cuándo | Mensaje |
|---|---|---|
| 404 | Token con forma inválida (no pasa `orderTokenSchema`) | "No encontramos ese pedido" |
| 429 | `receipt:ip` (20/1h) o `receipt:order` (1/8h) agotado | Texto de dominio + header `Retry-After` |
| 400 | `request.formData()` no parsea | "El comprobante llegó con un formato inválido" |
| 400 | Falta el campo `file`, o no es un `File` | "Falta el archivo del comprobante" |
| 400 | `file.size > 4 MB` (`MAX_RECEIPT_BYTES`) | "El comprobante pesa más de 4 MB..." |
| 400 | Magic bytes no son `FF D8 FF` (JPEG) ni `%PDF-` (PDF) — **el `Content-Type` del browser se ignora siempre** | "El archivo tiene que ser una foto (JPEG) o un PDF..." |
| 400 | El pedido no es `payment_method='transfer'` | "Este pedido no es de pago por transferencia" |
| 400 | El pedido ya está en estado terminal (`delivered`/`cancelled`) | "Este pedido ya no admite un comprobante" |
| 400 | `payment_status !== 'pending'` (ya se confirmó o rechazó) | "Este pedido ya no está esperando el pago" |
| 409 | `transfer_receipt_uploaded_at` ya no es null — **el comprobante es de un solo tiro** | "Este pedido ya tiene un comprobante subido. Si necesitás corregirlo, escribinos por WhatsApp." |
| 500 | Cualquier fallo real (Storage caído, Postgres caído) | Mensaje genérico (`toApiError`) |

El caso 409 cubre dos escenarios indistinguibles desde afuera: (a) el cliente ya subió antes, o (b) dos requests concurrentes — la que pierde el CAS ve exactamente este mismo 409. No hace falta que el frontend los distinga.

## Firmas que expone `kitchen.actions.ts` (para T5)

```ts
confirmTransferPaymentAction(p: { storeId: number; orderId: number; reference?: string }): Promise<ActionResult>
transferReceiptUrlAction(p: { storeId: number; orderId: number }): Promise<ActionResult<{ url: string; mime: string } | null>>
fetchPendingTransfersAction(storeId: number): Promise<ActionResult<Order[]>>
```

- Las tres piden `requireStoreMembership(storeId)` **sin** `{ role: 'owner' }` — cualquier staff puede confirmar un pago o mirar la bandeja, igual que `markPaidInStoreAction`. El dueño del producto lo pidió así: "quien está en el mostrador" no es necesariamente el dueño.
- `confirmTransferPaymentAction` **no exige que exista comprobante** — el botón "Confirmar pago" tiene que estar habilitado siempre, con o sin imagen (00-architecture.md §5.9, decisión no reabierta).
- `transferReceiptUrlAction` devuelve `null` en `.data` cuando no hay comprobante (nunca subió, o ya se purgó). El visor de T5 tiene que aguantar ese caso sin romper.
- `fetchPendingTransfersAction` devuelve `Order[]` (no `OrderPublicView[]`): trae `transferReceiptUploadedAt`, `transferReceiptSha256` etc. completos porque esto lo ve el staff, no el cliente. Ordenados con los que YA tienen comprobante primero (`nulls last` sobre `transferReceiptUploadedAt`).
- No hay acción de "borrar/reemplazar comprobante": es un solo tiro por diseño.

## Decisiones y trade-offs

1. **`markPaidByTransfer` hace CAS-sobre-`orders` primero y recién después inserta en `payments`**, al revés que `markOrderPaid` (que inserta el pago primero). Es el orden que pide T2.2 explícitamente y tiene sentido acá: el CAS (`payment_method='transfer' AND payment_status='pending'`) ya arbitra casi toda la concurrencia porque es un UPDATE de fila única bajo lock de Postgres; el índice único de `payments` es una segunda red defensiva, no la primera. Documenté esto en el código porque a primera vista parece "al revés" de `markOrderPaid`.

2. **`toEmailPaymentMethod()` — gap de contrato en un archivo que no es mío.** `EmailVars.paymentMethod` (`src/services/notifications/email/email.port.ts`, fuera de mi propiedad) sigue tipado `'online' | 'in_store'`. Verifiqué que **ninguna plantilla lo lee de verdad** — `order-receipt.tsx` y `order-ready.tsx` deciden todo el copy por `paymentPending` (booleano), y `paymentMethod` solo aparece en los `PreviewProps` de desarrollo. En vez de tocar `services/**` (fuera de mi alcance), agregué `toEmailPaymentMethod()` en `checkout.controller.ts` (exportado, lo reusa `kitchen.controller.ts`) que colapsa `'transfer'` a `'online'` antes de pasarlo. **Reporto esto como el cambio real pendiente**: ensanchar `EmailVars.paymentMethod` a `PaymentMethod` (o al menos sumar `'transfer'`) en `email.port.ts`. Es cosmético hoy porque el campo está muerto, pero si alguna vez una plantilla empieza a leerlo, un pedido por transferencia aparecería como "pagado online" en el mail — inocuo pero engañoso.

   > **RESUELTO EN LA INTEGRACIÓN (hilo principal, 2026-08-31).** Se tomó el
   > camino que este informe señalaba como el cambio real: se ensanchó
   > `EmailVars.paymentMethod` a `'online' | 'in_store' | 'transfer'` en
   > `email.port.ts`, y `toEmailPaymentMethod()` **se borró** junto con sus dos
   > usos (`checkout.controller.ts` y `kitchen.controller.ts`), que ahora pasan
   > `order.paymentMethod` tal cual. El razonamiento: colapsar `transfer` a
   > `'online'` guardaba un dato falso, y el campo estar muerto hoy no protege
   > de la primera plantilla que mañana lo lea y le crea. El reporte de este
   > slice fue correcto — la decisión era del integrador, no del slice.
   > Si estás leyendo este log buscando `toEmailPaymentMethod()` en el código,
   > no existe.

3. **`getOrdersByTokens` (usada por `/mis-pedidos`) NO puebla `bankAccount`.** Seguí la letra de T2.2 ("`getOrderByToken` — ... llama a `getPublicBankAccount`"), que solo menciona el seguimiento de UN pedido. Un pedido por transferencia pendiente que aparece en la lista de "mis pedidos" no muestra el CBU ahí — el cliente tiene que entrar al detalle (`/pedido/[token]`) para verlo. Si el frontend necesita el CBU también en la lista, es un cambio de una línea en `getOrdersByTokens` (mapear igual que en `getOrderByToken`) que no hice por mantenerme dentro del alcance explícito.

4. **Path del comprobante confirmado en vivo contra el bucket real** (stack local, `127.0.0.1:54321`): subí un archivo de prueba a `order-receipts`, firmé una URL y lo borré con la API de Storage antes de escribir `purgeReceiptObjects`. Confirmé que `remove()` devuelve `name` igual al path completo que se manda (no un basename relativo), que es el supuesto del que depende `clearReceiptRefs` para saber qué filas nulear. Sin esa verificación hubiera sido una suposición de la documentación, no un hecho comprobado.

5. **`initialStatus` y el predicado de "impago no confirma" se invirtieron a enumerar el método bueno (`in_store`)**, exactamente como pide T2.2, espejando el trigger `enforce_order_rules` que T0 ya redefinió así. Comenté en ambos call sites por qué (para que un quinto método de pago nazca seguro por default).

6. **No toqué `expire_pending_orders`** ni el cron `reconcile` (no está en mi lista de archivos): la RPC ya tiene la firma nueva de dos parámetros (T0 ya la aplicó y verificó), y `reconcile/route.ts` la llama pasando solo `p_minutes`, así que usa el default de `p_transfer_minutes=120` sin cambios. Verifiqué que compila y no rompe nada.

## Reglas de negocio / invariantes implementadas (spec para el test-engineer)

Todas con ID de `01-tasks.md` T2, criterios de aceptación:

- **`createOrder` con `paymentMethod:'transfer'` y `store.transferPaymentEnabled === false`** ⇒ `DomainError('Este local no está aceptando transferencias por ahora')`.
- **`createOrder` con `'transfer'` habilitado** ⇒ nace `status:'pending'`, `payment_status:'pending'`, sin preferencia de Mercado Pago (nunca se llama a `createCheckoutForOrder`/`getPaymentProvider` en esa rama).
- **`createOrder` con `'in_store'`** sigue naciendo `'confirmed'` — no-regresión del cambio de ternario a enumeración positiva.
- **`submitOrder` con `'transfer'`** ⇒ `redirectUrl === '/pedido/<token>'`, y **no** dispara `sendReceiptEmail` ni `sendConfirmedWhatsapp` (a diferencia de `'in_store'`, que sí los dispara).
- **`updateOrderStatus(id, 'confirmed')` sobre un pedido `transfer` con `payment_status !== 'approved'`** ⇒ `DomainError('Este pedido todavía no está pago')`. Mismo camino para `'online'`; **no** para `'in_store'`.
- **El route handler** rechaza (con los mensajes de la tabla de arriba): archivo > 4 MB, magic bytes que no son JPEG ni PDF, un `Content-Type: image/jpeg` declarado con bytes de otra cosa (el sniff manda siempre), y un token con forma inválida.
- **Segunda subida al mismo pedido** ⇒ 409, con o sin la primera imagen todavía en Storage (el CAS mira `transfer_receipt_uploaded_at`, no el archivo).
- **`markPaidByTransfer` sobre un pedido ya `approved`** ⇒ 409 (CAS de `orders` da 0 filas), no 500.
- **`markPaidByTransfer` sin comprobante** ⇒ funciona igual — no hay ningún chequeo de `transfer_receipt_path`.
- **`OrderPublicView.bankAccount`** es `null` para `'online'`/`'in_store'`, y trae los cuatro campos públicos (`cbu`, `alias`, `holderName`, `bankName`) para `'transfer'` mientras el pedido no esté `cancelled`.
- **`clearReceiptRefs`** nunca incluye `transfer_receipt_uploaded_at` en su `update()` — ni como columna a nulear ni de ninguna otra forma.
- **`listPurgeableReceipts`** solo devuelve filas con `transfer_receipt_path is not null`, y las separa en dos ventanas (`paid_at` no nulo → `paidHours`; `paid_at` nulo → `staleDays` desde `transfer_receipt_uploaded_at`).

### Necesita base real (`tests/db/`) — no verificable solo en TS

- **Paridad trigger ↔ TypeScript** (extender el test que ya existe): con `service_role`, `pending → confirmed` se rechaza para `payment_method in ('online','transfer')` impago y se permite para `'in_store'`.
- El trigger rechaza cualquier UPDATE que cambie `transfer_receipt_uploaded_at` cuando ya tenía valor, **incluso con `service_role`** (yo mismo dependo de esto: mi `storeTransferReceipt` nunca intenta pisarlo, pero el test tiene que probar que Postgres lo bloquearía si algo lo intentara).
- `payments_one_approved_per_order_idx`: dos `markPaidByTransfer` concurrentes sobre el mismo pedido ⇒ uno gana (200), el otro ve 409 vía el CAS de `orders` (no necesariamente vía el índice, ver la decisión #1 de arriba — vale la pena que el test verifique CUÁL de los dos caminos disparó, para documentar el comportamiento real).
- `expire_pending_orders(45, 120)`: cancela un `transfer` sin comprobante más viejo que 120 min; NO cancela uno con comprobante; NO cancela uno con pago aprobado; sigue cancelando `online` a los 45 min. **Ya implementado y verificado por T0** contra la base local — el test solo tiene que probarlo, yo no toqué la función.
- `expire_pending_orders(int)` (un solo parámetro) da `42883` — la sobrecarga vieja fue dropeada por T0.
- `authenticated` no puede escribir ninguna de las cinco columnas `transfer_receipt_*` por PostgREST (no hay `grant update` — verificado indirectamente por T0, falta el test).
- `platform_stores()` devuelve `transfer_payment_enabled` (T0 ya la reescribió con la columna).
- **Bucket `order-receipts`**: confirmé a mano con `curl` + la secret key local que `service_role` puede subir, firmar y borrar (ver decisión #4). Falta el test que pruebe que `anon`/`authenticated` NO pueden (cero policies, así que cualquier intento debería dar 403/404 de Storage).

## Lo que dejé afuera / deferido

- No implementé ninguna acción para "reemplazar" o "borrar a mano" un comprobante desde el panel — es 100% intencional (D6, un solo tiro).
- No agregué el botón "Escribirle por WhatsApp" del detalle del pedido — eso es de T5 (vista), usa `customer_phone_e164` que ya viaja en `Order`.
- No toqué `/legal/privacidad` (mencionado en 00-architecture.md §6.4 como tarea pendiente) — no está en mi lista de archivos y no es un lugar backend.

## Estado del árbol al terminar

- `npm run typecheck`: limpio para todo lo que no es `tests/**`. Quedan errores en `tests/lib/store-availability.test.ts` y `tests/lib/store-hours.test.ts` (fixtures que no pasan `transferPaymentEnabled`, consecuencia del cambio de tipo que hizo T1 en `PaymentFlags`) — no los toqué, son del test-engineer.
- `npm run lint`: limpio, cero warnings.
- `npm test`: 728/730 verdes. Los 2 rojos son los mismos dos casos de `tests/lib/store-availability.test.ts` (fixtures desactualizadas, no un bug de `canCollectPayment`: `undefined || undefined || undefined` da `undefined`, no `false`, cuando el objeto de test no manda `transferPaymentEnabled`).
- Corrí `npx next typegen` para que `RouteContext<'/api/orders/[token]/comprobante'>` exista — necesario porque Next 16 genera esos tipos por ruta y el archivo es nuevo. Si el pipeline de CI no corre `next dev`/`next build` antes de `tsc`, hay que correr `next typegen` (o `next build`) primero.
