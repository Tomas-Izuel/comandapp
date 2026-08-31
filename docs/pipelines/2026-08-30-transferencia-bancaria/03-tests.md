# Transferencia bancaria — informe de tests

`test-engineer`. Corrió en paralelo con `code-reviewer` (que aprobó sin
bloqueantes y me ruteó dos pedidos de cobertura + una aclaración, atendidos
abajo). Dueño exclusivo de `tests/`; no toqué `src/` ni `supabase/migrations/`.

## Veredicto

**SUITE RED** — 910/915 verdes. Las 5 fallas son **dos bugs reales de
producción**, no tests mal escritos; no los debilité para que pasaran.

```
Test Files  3 failed | 70 passed (73)
     Tests  5 failed | 910 passed (915)
```

---

## Hallazgo bloqueante — `payments_provider_check` sigue sin aceptar `'transfer'`

**Este es el hallazgo que importa. Bloquea la feature entera del lado del
dinero.**

- **Archivo**: `supabase/migrations/20260831120000_transferencia_bancaria.sql`, líneas 68–83.
- **Dueño**: hilo principal (T0 — es una migración, ningún agente la toca).
- **Qué pasa**: el bloque idempotente que debería ensanchar el CHECK a
  `in ('mercadopago', 'transfer')` usa `if not exists (select 1 from
  pg_constraint where conname = 'payments_provider_check' ...)`. El problema
  es que ese constraint **ya existe**, creado por
  `20260826120000_hardening.sql:121` con `check (provider in
  ('mercadopago'))`. El comentario de la migración nueva (línea 68: *"payments.provider
  nunca tuvo CHECK"*) es **incorrecto** — sí lo tenía, con ese mismo nombre.
  Como el `if not exists` encuentra el constraint viejo, nunca lo reemplaza.
- **Verificado contra la base real** (no es una suposición del test):
  ```
  $ docker exec -i supabase_db_burger-shop psql -U postgres -d postgres -t -A -c \
    "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.payments'::regclass and contype='c';"
  payments_provider_check|CHECK ((provider = 'mercadopago'::text))
  ```
  El resto de la migración aplicó bien (verifiqué `orders_payment_method_check`,
  `store_pending_changes_kind_check`, `store_bank_accounts`, `stores.transfer_payment_enabled`,
  `expire_pending_orders(int,int)` y el bucket `order-receipts` — los cinco están
  correctos). Es un bug **aislado** a este único constraint, causado porque —a
  diferencia de los otros dos CHECK de la misma migración— a éste le faltó el
  `drop constraint` por introspección antes de re-crearlo.
- **Consecuencia en producción**: `markPaidByTransfer` (`order.model.ts:1738`)
  inserta `provider: 'transfer'` en `payments` al confirmar el pago de una
  transferencia. Con el CHECK actual, **ese insert SIEMPRE falla** con
  `23514 check_violation` — no es `23505` (el que el código sabe traducir a
  409), así que cae al `catch` genérico y el staff ve un error interno al
  tocar "Confirmar pago". El pedido queda con `payment_status='approved'` en
  `orders` (el `UPDATE` con CAS sí pasó) pero **sin fila en `payments`** —o
  sea, sin la protección real de `payments_one_approved_per_order_idx` contra
  el doble cobro, exactamente la invariante #1 que se me pidió priorizar.
- **Fix sugerido** (mismo patrón que los otros dos CHECK de la misma
  migración, líneas 38–65): introspeccionar el constraint existente por
  definición (`pg_get_constraintdef(oid) like '%provider%' and ... like
  '%mercadopago%'`), `drop constraint` por nombre real, y recién ahí `add
  constraint payments_provider_check check (provider in ('mercadopago',
  'transfer'))`.
- **Tests que lo prueban** (dejados en rojo a propósito, no debilitados):
  - `tests/db/payments-one-approved.test.ts` → `payments_provider_check >
    acepta "transfer" como provider` (la prueba más directa del bug).
  - `tests/db/payments-one-approved.test.ts` → dos casos de
    `payments_one_approved_per_order_idx` con `provider='transfer'` (no
    llegan a probar el índice porque el CHECK los frena antes).
  - `tests/db/expire-pending-orders.test.ts` → *"NO cancela un pedido por
    transferencia con un pago approved ya registrado"* (mismo bloqueo).

  Los tests de la carrera real (`tests/db/transfer-payment-race.test.ts`) NO
  dependen de `payments` y sí corren en verde — confirman que el CAS de
  `orders`, que es el que arbitra la carrera según el propio dev log de T2,
  funciona. Lo que queda sin poder probarse hasta el fix es la **segunda**
  red (el índice único de `payments`).

---

## Hallazgo — `certisend.adapter.ts`: el check de "encontrado" es un `.includes()` que se traiciona a sí mismo

- **Archivo**: `src/services/bank-validation/certisend.adapter.ts:102`.
- **Dueño**: T1 (`senior-backend-engineer`, `src/services/bank-validation/**`).
- **Severidad**: baja en la práctica hoy (el adapter está **apagado por
  default**, D0/D7 — nadie lo invoca sin configurar `BANK_VALIDATION_PROVIDER=certisend`
  a mano), pero es un bug de lógica real, no una interpretación mía de un
  contrato no verificado.
- **Qué pasa**:
  ```ts
  const found = (parsed.data.respuesta?.descripcion ?? '').toUpperCase().includes('ENCONTRADO')
  ```
  Es un chequeo por **substring**, no una igualdad contra `'ALIAS ENCONTRADO'`
  (la cadena de éxito documentada en `00-architecture.md` §3.4, verificada
  contra BDC Conecta). El problema: la contracara natural en español de
  *"ENCONTRADO"* es *"NO ENCONTRADO"* — y `'NO ENCONTRADO'.includes('ENCONTRADO')`
  es `true`. Un `.includes()` sobre una palabra que su propia negación
  contiene como substring no puede distinguir éxito de fracaso.
- **Input**: `respuesta.descripcion: 'NO ENCONTRADO'` (una respuesta de "no se
  encontró la cuenta", la contracara obvia y esperable del único string de
  éxito que el proveedor documenta).
- **Esperado**: `lookupByCbu(...)` devuelve `null` (no se encontró nada).
- **Observado**: devuelve un objeto con todos los campos en `null` (`found`
  da `true` porque la cadena contiene el substring), tratando un "no
  encontrado" como si fuera un resultado válido y vacío.
- **Fix sugerido**: comparar igualdad exacta contra `'ALIAS ENCONTRADO'` (o al
  menos excluir cualquier descripción que empiece con `'NO '`), en vez de
  `.includes('ENCONTRADO')`.
- **Test**: `tests/services/bank-validation.test.ts` → *"'ALIAS ENCONTRADO'
  ausente en respuesta.descripcion → null"*.

---

## Los tres pedidos del `code-reviewer`, atendidos

1. **El CAS perdido DESPUÉS de subir el objeto** — cubierto con
   comportamiento real, no una opinión:
   `tests/models/order-transfer.model.test.ts`, describe *"el CAS pierde
   DESPUÉS de subir"*. Verifiqué que **sí** limpia el objeto huérfano
   (`removeMock` se llama con el path exacto) y que sigue propagando 409 aunque
   el borrado del huérfano también falle. No es un hallazgo — el código está
   bien.
2. **`resendPendingChangeCodeAction` consume el balde de MP para `bank_account`**
   — documentado como gap conocido, no como regla:
   `tests/controllers/bank-account.actions.test.ts`, describe con el prefijo
   `GAP CONOCIDO` en el nombre. El test asegura el comportamiento **actual**
   (consume `payment_change:store`), y el comentario dice explícitamente que
   hay que actualizarlo si algún día se resuelve distinto — no consagra nada
   como deseable.
3. **`toEmailPaymentMethod()` no existe** — confirmado contra el código
   integrado (`EmailVars.paymentMethod` ensanchado a las tres opciones,
   `order.paymentMethod` viaja literal). Cubierto en
   `tests/services/checkout-email-transfer.test.ts`: un pedido `transfer`
   manda `vars.paymentMethod === 'transfer'`, no colapsado a `'online'`.

---

## Qué cubrí, y por qué invariante

### Dinero / doble cobro
- `tests/db/transfer-payment-race.test.ts` — **paralelismo real** (`sqlConcurrently`,
  procesos `psql` concurrentes, no un `for`): N=6 confirmaciones simultáneas
  del mismo pedido, exactamente una gana el CAS de `orders`. Segundo test
  idéntico para la carrera de subida del comprobante
  (`transfer_receipt_uploaded_at is null`).
- `tests/models/mark-paid-by-transfer.model.test.ts` — CAS perdido ⇒ 409, no
  500; el índice único de `payments` (23505) también ⇒ 409; sin comprobante
  igual confirma (D del dueño, no re-abierta).
- `tests/db/payments-one-approved.test.ts` (extendido) — `provider='transfer'`
  también choca contra `payments_one_approved_per_order_idx`, y un
  `mercadopago` + un `transfer` sobre el MISMO pedido también (el índice es
  por pedido, no por provider). **Bloqueados por el hallazgo bloqueante de
  arriba** — quedan en rojo a propósito.

### Un comprobante por pedido
- `tests/db/transfer-receipt-immutable.test.ts` — el trigger rechaza
  reemplazar `transfer_receipt_uploaded_at` **incluso corriendo como
  `service_role`** (es la capa que sobrevive a que alguien le pegue directo a
  PostgREST); nulear solo el `path` (la purga) sí está permitido.
- `tests/models/order-transfer.model.test.ts` — las seis validaciones de
  `storeTransferReceipt` antes de tocar Storage (token inválido, pedido
  inexistente, método distinto, estado terminal, ya pagado, ya tiene
  comprobante), el camino feliz, y el CAS perdido después de subir (pedido
  explícito del reviewer).
- `tests/services/receipt-upload-route.test.ts` — el route handler completo:
  rate limits en el orden correcto, magic bytes (JPEG/PDF) **ignorando el
  `Content-Type` declarado** (el caso central: `Content-Type: image/jpeg`
  con bytes que no son JPEG rebota igual que uno sin declarar nada), 4 MB,
  409/404 propagados sin convertirse en 500.

### Aislamiento multi-tienda / grants por columna
- `tests/db/grants-store-bank-accounts.test.ts` — `anon` lee exactamente las
  5 columnas del grant y no una más (`holder_tax_id`/`holder_match`/`checked_at`
  dan `permission denied`); no ve la fila si `is_active=false` ni si la
  tienda está suspendida; `authenticated` (ni siquiera el dueño) no puede
  insert/update/delete por PostgREST; `service_role` sí puede.
- `tests/db/grants-orders.test.ts` (extendido) — las cinco columnas
  `transfer_receipt_*` no tienen grant de UPDATE para `authenticated`.
- `tests/services/receipt-upload-route.test.ts` — el `public_token` es la
  única credencial; un token con forma inválida ni siquiera toca el balde.

### "Impago no confirma", los tres métodos
- `tests/db/order-state-machine.test.ts` (extendido) — el trigger rechaza
  `transfer` impago → `confirmed` con el mensaje que nombra el método
  (`es de pago transfer y todavia no esta pago`), y lo permite una vez
  `payment_status='approved'`. Corre como `postgres` (= `service_role`): el
  punto es que la versión de TypeScript se puede saltear, ésta no.
- `tests/models/update-order-status.model.test.ts` (nuevo) — el espejo en
  TypeScript de `updateOrderStatus`: transfer impago rechaza, transfer pagado
  pasa, `online` impago rechaza (no-regresión), `in_store` impago pasa (es el
  único método que confirma sin plata asegurada).
- `tests/models/order.model.test.ts` (extendido) — el gate de
  `createOrder` (`transferPaymentEnabled:false` ⇒ `DomainError`),
  `canCollectPayment` con **solo** transferencia, y el caso central:
  `initialStatus` nace `pending` con transferencia (nunca `confirmed` — es
  el bug exacto que la feature vino a matar, antes con el ternario de dos
  ramas `isOnline ? … : …` una tienda con solo transferencia hubiera nacido
  `confirmed` e impaga).

### El precio lo pone el servidor / `.strict()`
- `tests/models/bank-account.schema.test.ts` (nuevo) — `bankAccountInputSchema`
  rechaza una clave desconocida (`.strict()`), un CBU con checksum malo con
  mensaje que nombra el problema, y exige al menos un identificador (D3).
  `bankName` no es un campo de input: mandarlo rebota.

### El precio y la máquina de estados no cambiaron para los otros métodos
- `tests/lib/store-availability.test.ts` / `tests/lib/store-hours.test.ts`
  (arreglados) — los dos fixtures rotos por el campo nuevo obligatorio de
  `PaymentFlags`, más el caso nuevo: **solo transferencia habilitada** da
  `true` en `canCollectPayment`/`canTakeOrders`/`storefrontGate`, que es el
  bug de las líneas 182-187 de `checkout-form.tsx` que la feature vino a
  matar.

### Checksum de CBU
- `tests/lib/cbu.test.ts` (nuevo, 27 tests) — los dos vectores reales
  documentados (CVU de Mercado Pago, CBU bancario), barrido de las 22
  posiciones mutando un dígito por vez (los 44 casos invalidan), el caso
  obligatorio de DV=0 (prefijo de Prex, construido con la fórmula exacta del
  BCRA para no depender de una segunda copia del algoritmo), `isCvu` de
  forma vs. de validez, `bankNameForCbu` con y sin cobertura de la tabla,
  `isValidAlias` en los bordes 5/6/20/21.

### El puerto de validación, nunca tira
- `tests/services/bank-validation.test.ts` (nuevo) — manual siempre `null`;
  la fábrica por env; `hasBankAccountValidator()` en sus tres combinaciones;
  el adapter de Certisend ante timeout, HTTP no-ok, JSON roto, forma
  inesperada — todos `null`, nunca propagan. (Y el hallazgo de arriba.)

### El CBU llega al cliente por un solo camino
- `tests/models/order-public-view.model.test.ts` (nuevo) — `bankAccount` es
  `null` para `online`/`in_store` (ni siquiera consulta el modelo), se
  puebla para `transfer` no cancelado, vuelve a `null` si se cancela, y si el
  dueño desactivó la cuenta después de crear el pedido (`null`, nunca un CBU
  inventado).

### Purga
- `tests/services/cron-cleanup-receipts.test.ts` (nuevo) — el orden exacto
  (`listPurgeableReceipts` → `purgeReceiptObjects` → `clearReceiptRefs`);
  `clearReceiptRefs` recibe **solo** los ids cuyo objeto se borró de verdad
  (no todos los candidatos); un fallo del RPC de `cleanup_old_records` sí
  tumba la respuesta, un fallo de la purga de comprobantes no.

### `expire_pending_orders`
- `tests/db/expire-pending-orders.test.ts` (extendido) — cancela `transfer`
  sin comprobante a los 120 min; NO cancela con comprobante; NO cancela con
  pago aprobado (bloqueado por el hallazgo #1); NO cancela uno "reciente"
  (< 120 min, distingue la ventana propia de la de `online`); sigue
  cancelando `online` a los 45. Y la trampa de la sobrecarga: en vez de
  probar `expire_pending_orders(45)` esperando que falle (**falso negativo**
  garantizado — la función de 2 parámetros con default acepta 1 argumento
  igual), consulté `pg_proc` directo: existe exactamente **una** sobrecarga,
  con los dos parámetros.

### Flag derivado y `platform_stores`
- `tests/db/transfer-payment-flag.test.ts` (nuevo, hermano de
  `online-payment-flag.test.ts`) — insert activo → `true`, apagar → `false`,
  reactivar → `true`, borrar → `false`, sin grant de UPDATE para
  `authenticated`.
- `tests/db/platform-rpcs.test.ts` (extendido) — `platform_stores()` trae
  `transfer_payment_enabled` (la trampa de las columnas enumeradas a mano).

### `submitOrder` — transferencia
- `tests/services/submit-order-transfer.test.ts` (nuevo) — sin preferencia
  de Mercado Pago, `redirectUrl` al seguimiento, **sin** mail ni WhatsApp
  (el pedido todavía no está confirmado).

---

## Qué decidí NO cubrir, y por qué

- **La forma exacta del payload de Certisend contra un endpoint real.** No
  hay sandbox (T1 lo documentó); testear contra una API que no se puede
  llamar es simular el simulacro. Sí cubrí que el adapter nunca propaga, que
  es la garantía real que el resto del sistema necesita.
- **`markPaidByTransfer` con race real de dos inserts en `payments`** (la
  segunda red). Bloqueado por el hallazgo #1 — no tiene sentido escribir un
  test de concurrencia contra una tabla en la que ni un insert secuencial
  entra hoy.
- **UI/accesibilidad de T3/T4/T5** (`bank-account-form.tsx`, `transfer-panel.tsx`,
  `transfer-tray.tsx`). No escribo tests de componentes React en este repo —
  la convención de `tests/` es Node puro (modelos, schemas, controllers,
  rutas, Postgres). Los devlogs de T3/T4/T5 documentan sus propias
  verificaciones de accesibilidad; si el proyecto suma un runner de
  componentes en el futuro, ahí corresponde.
- **`certisend.adapter.ts` con credenciales reales.** No existen (D0/D7); el
  adapter está apagado por default y el hallazgo que encontré no depende de
  tener credenciales.
- **Verificación visual del checkout/KDS en browser real.** Fuera del
  alcance de este rol.

---

## Fixtures arregladas (bloqueaban el árbol antes de empezar)

- `tests/lib/store-availability.test.ts` y `tests/lib/store-hours.test.ts`:
  `PaymentFlags`/`Store` ganaron el campo obligatorio `transferPaymentEnabled`
  (T1) y los fixtures viejos no lo pasaban. Arreglados, y aproveché para
  sumar el caso "solo transferencia" en los dos archivos.

## Archivos nuevos

```
tests/lib/cbu.test.ts
tests/models/bank-account.schema.test.ts
tests/models/order-transfer.model.test.ts
tests/models/order-public-view.model.test.ts
tests/models/mark-paid-by-transfer.model.test.ts
tests/models/update-order-status.model.test.ts
tests/controllers/bank-account.actions.test.ts
tests/services/bank-validation.test.ts
tests/services/receipt-upload-route.test.ts
tests/services/checkout-email-transfer.test.ts
tests/services/submit-order-transfer.test.ts
tests/services/cron-cleanup-receipts.test.ts
tests/db/grants-store-bank-accounts.test.ts
tests/db/transfer-payment-flag.test.ts
tests/db/transfer-receipt-immutable.test.ts
tests/db/transfer-payment-race.test.ts
```

## Archivos extendidos

```
tests/lib/store-availability.test.ts   (fixture rota + caso nuevo)
tests/lib/store-hours.test.ts          (fixture rota + caso nuevo)
tests/models/order.model.test.ts       (createOrder — transferencia)
tests/db/order-state-machine.test.ts   (paridad trigger, transfer)
tests/db/expire-pending-orders.test.ts (ventana propia + sobrecarga)
tests/db/grants-orders.test.ts         (columnas transfer_receipt_*)
tests/db/payments-one-approved.test.ts (provider=transfer + CHECK)
tests/db/platform-rpcs.test.ts         (transfer_payment_enabled)
```

## `npm test` — resultado final

```
Test Files  3 failed | 70 passed (73)
     Tests  5 failed | 910 passed (915)
```

`npm run typecheck` y `npm run lint`: limpios (0 errores, 0 warnings) sobre
todo `tests/`.

## Ruteo

- **Hilo principal (T0, migración)**: `supabase/migrations/20260831120000_transferencia_bancaria.sql:68-83`
  — `payments_provider_check` sigue rechazando `'transfer'`. **Bloqueante.**
- **`senior-backend-engineer` (T1, `src/services/bank-validation/**`)**:
  `certisend.adapter.ts:102` — el check de "encontrado" es un `.includes()`
  que una respuesta de "no encontrado" satisface igual. No bloqueante hoy
  (adapter apagado por default).

---

## Resolución del bloqueante — hilo principal, 2026-08-31

El bug de `payments_provider_check` era real y era **del hilo principal (T0)**.
Reproducido y confirmado antes de tocar nada:

```
payments_provider_check | CHECK ((provider = 'mercadopago'::text))
```

**Causa raíz.** Al escribir la migración busqué el CHECK de `payments.provider`
solo en `20260825120100_orders.sql` (donde se crea la tabla) y no lo encontré,
porque no está ahí: lo agrega `20260826120000_hardening.sql:121`, ya con el
nombre `payments_provider_check`. Con esa premisa falsa usé un
`if not exists (conname = 'payments_provider_check')` en vez del
drop-por-introspección que sí usé para los otros dos CHECK de la misma
migración. El `if not exists` encontró el constraint viejo, se salteó el `add`, y
dejó el CHECK de un solo valor en pie.

**Por qué era bloqueante.** `markPaidByTransfer` inserta `provider: 'transfer'`
en `payments` al confirmar. Ese insert fallaba con `23514` en **cada**
confirmación de transferencia: el staff veía un error interno y el pedido quedaba
`payment_status = 'approved'` **sin** la fila que arma
`payments_one_approved_per_order_idx`, o sea sin la defensa real contra el doble
cobro. La feature quedaba rota exactamente del lado del dinero.

**Fix.** Mismo drop-por-introspección que los otros dos, con un comentario largo
en la migración que nombra el modo de falla para que no vuelva.

**Verificado después del `db:reset`**, contra la base real:

| Caso | Resultado |
|---|---|
| `insert payments (provider='transfer', status='approved')` | entra |
| Segundo pago aprobado del mismo pedido | rebota con `payments_one_approved_per_order_idx` |
| `provider = 'transferencia'` (basura) | rebota con `payments_provider_check` |
| CHECK vigente | `provider = ANY (ARRAY['mercadopago','transfer'])` |

Se verificó además que el mismo descuido **no** afectó a los otros dos CHECK:
`orders_payment_method_check` tiene los tres métodos y
`store_pending_changes_kind_check` los tres kinds.

## El hallazgo secundario, también arreglado

`certisend.adapter.ts` usaba `.includes('ENCONTRADO')`, y `'NO ENCONTRADO'`
contiene `'ENCONTRADO'` como substring: la respuesta negativa se leía como
positiva. Arreglado exigiendo la palabra y descartando la negación, con la regla
de que ante cualquier descripción no reconocida se devuelve `null`
("no pudimos comprobar") y **nunca** un match — equivocarse hacia "coincide"
sobre la cuenta donde el local cobra es el único error que no se puede cometer.
Probado contra ocho variantes (`ALIAS ENCONTRADO`, `NO ENCONTRADO`,
`ALIAS NO ENCONTRADO`, `NO  ENCONTRADO` con doble espacio, etc.): las ocho dan lo
esperado.

## Estado final de la rama

```
npm run typecheck   limpio
npm run lint        limpio
npm test            915 passed (73 archivos)
npm run build       exitoso
```
