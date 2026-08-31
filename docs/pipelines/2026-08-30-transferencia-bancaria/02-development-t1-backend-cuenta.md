# T1 — Backend: cuenta bancaria, validación de CBU y confirmación por código

Agente: `senior-backend-engineer`. Rama: `feat/transferencia-bancaria`.

## Qué se implementó

Todas las tareas T1.1 a T1.9 de `01-tasks.md`, sección T1 (líneas ~165-465).

### T1.1 — `src/lib/cbu.ts` (nuevo)

Módulo puro, **sin `server-only`** (mismo motivo que `src/lib/delivery.ts`: la
misma función valida en el browser mientras el dueño tipea y en el servidor).

Exports: `CBU_LENGTH`, `ALIAS_PATTERN`, `isValidCbu`, `isCvu`, `cbuEntityCode`,
`bankNameForCbu`, `normalizeCbu`, `normalizeAlias`, `isValidAlias`.

Algoritmo verificado empíricamente antes de dar el módulo por bueno (no me
limité a transcribir la fórmula):

- Los dos vectores de prueba de `00-architecture.md` §3.1
  (`0000003100023596996524` un CVU de Mercado Pago, `0070325120000003733248`
  un CBU) validan `true` con mi implementación, y decodifican exactamente lo
  que el documento dice: el CVU tiene `0003` en las posiciones 4-7 (Mercado
  Pago), y las dos suman los DV correctos en las posiciones 8 y 22.
- Mutar CUALQUIER dígito de cualquiera de los dos vectores hace que
  `isValidCbu` devuelva `false` (barrido completo de las 22 posiciones,
  hecho con un script descartable, no comprometido al repo).
- El caso del `% 10` exterior (DV=0) se verificó con el prefijo de Prex
  (`0000013` → DV real `0`), como pide el criterio de aceptación de
  `01-tasks.md`.

**Tabla de entidades**: no usé la lista "de memoria" que traía en el
entrenamiento — hice `curl` en vivo contra
`https://api.bcra.gob.ar/cheques/v1.0/entidades` (gratis, sin auth, confirmado
`200` y 59 resultados, igual que dice `00-architecture.md`) y construí la
tabla desde esa respuesta real. Los 59 códigos y nombres de banco en
`ENTITY_NAMES` son exactos contra esa respuesta (normalicé mayúsculas/points
pero no inventé ningún nombre ni código).

**Tabla de PSP para CVU**: dejé **solo** `'0003': 'Mercado Pago'`, el único
verificado dos veces (contra el texto del BCRA y contra el checksum real del
vector de arriba). Hice una búsqueda web durante la implementación para ver si
había más códigos de PSP publicados con confianza, y el primer resultado
repite textualmente la creencia que `00-architecture.md` marca como
**incorrecta** ("0031 es Mercado Pago" — es la cadena con el dígito
verificador incluido, no el código de PSP real). Confirma que la trampa está
viva y activa hoy en la web en español, y reforzó la decisión de no agregar
Ualá/Naranja X/Brubank/etc. sin una fuente primaria: mostrarle al dueño el
nombre de un banco equivocado al lado de su propio CBU es peor que no
mostrar nada. Si en el futuro alguien consigue una fuente primaria (contrato
con COELSA, doc oficial de un PSP), se agregan a `PSP_NAMES` sin tocar nada
más.

### T1.2 — `src/services/bank-validation/` (nuevo)

Copia literal de la forma de `src/services/geocoding/`:

- `bank-account-validator.port.ts` — `BankAccountLookup` + `BankAccountValidator`,
  con el comentario obligatorio de que el puerto se llama SOLO sobre el CBU
  del propio local.
- `manual.adapter.ts` — no-op, los dos métodos devuelven `null` siempre. Es
  el adapter **activo hoy** (default).
- `certisend.adapter.ts` — escrito contra el contrato reportado en
  `00-architecture.md` §3.4 (`titular.nombre`, `cuenta.nro_cbu`,
  `respuesta.descripcion`), **apagado**. Mapeo del CUIT del titular
  (`titular.cuit`) es mejor esfuerzo y **no está verificado contra un payload
  real** — no hubo sandbox para probarlo. Está comentado explícitamente para
  que quien active este adapter algún día lo corrija contra la respuesta real
  antes de confiar en `holderMatch`.
- `index.ts` — `getBankAccountValidator()` (fábrica memoizada) y
  `hasBankAccountValidator()` (para que el panel sepa si mostrar la sección de
  contraste automático).

**Decisión que reporto**: `BANK_VALIDATION_PROVIDER`,
`CERTISEND_API_URL`, `CERTISEND_TOKEN_SUSC` y `CERTISEND_TOKEN_API` **no
viven en `src/lib/env.server.ts`**. Ese archivo es un contrato compartido
(mismo tipo que `types.ts` o `rate-limit-policy.ts`) y no está en mi lista de
propiedad exclusiva ni en la de ningún otro slice de T1-T5 — así que hice lo
más seguro: leer `process.env` directo, contenido a
`src/services/bank-validation/`. Es una desviación del patrón establecido
(`WHATSAPP_PROVIDER` sí vive en `env.server.ts`). **Recomendación para el
hilo principal**: si en algún momento se toca `env.server.ts` por otro
motivo, mover estas 4 variables ahí centraliza la validación con Zod que hoy
falta (hoy son `string | undefined` sin `z.enum()` ni default tipado).

### T1.3 — `bankAccountInputSchema` (`store.schema.ts`)

**Nota importante sobre una contradicción en `01-tasks.md` que resolví a
favor de la decisión más reciente del dueño**: el bloque de T1.3 en
`01-tasks.md` (líneas ~287-306) describe el CBU como obligatorio, citando
§4.2 — pero el encabezado del mismo archivo (líneas 1-15) dice explícitamente
que **D3 (2026-08-31) reemplazó esa recomendación**: el dueño puede cargar
cualquiera de los tres identificadores, `cbu` es nullable, `alias` es
nullable, y un CHECK exige al menos uno. `types.ts` (T0, ya escrito) ya
refleja D3 (`StoreBankAccount.cbu: string | null`). Implementé el schema
según **D3**, no según el texto obsoleto de T1.3, porque:

1. Es la decisión vigente y más reciente del dueño del producto.
2. `types.ts` (que no puedo editar) ya está escrito asumiendo D3.
3. La migración de T0 (`store_bank_accounts_has_identifier_check`) ya lo
   exige así en la base.

`bankAccountInputSchema`:
- `cbu` y `alias`: ambos **opcionales**, normalizados y validados con
  `isValidCbu`/`isValidAlias` de `cbu.ts` cuando vienen. `.superRefine()` a
  nivel objeto exige que venga al menos uno (espejo del CHECK de Postgres).
- `holderName`: obligatorio, 2-120 caracteres.
- `holderTaxId`: opcional, se limpia a solo dígitos y exige 11.
- `bankName` **no está en el schema de input**: lo deriva el servidor con
  `bankNameForCbu` — un campo de texto libre rotulado "Banco" sería mostrarle
  al cliente lo que el dueño quiera escribir al lado de su CBU.
- `.strict()`.

Verifiqué contra la documentación de Zod v4 (Context7,
`/colinhacks/zod/v4.0.1`) que `.transform().refine()` es un patrón soportado
antes de usarlo en el helper `optionalIdentifier`.

### T1.4 — `src/models/store-bank-account.model.ts` (nuevo)

```ts
getPublicBankAccount(storeId: number): Promise<StoreBankAccount | null>
getBankAccountForAdmin(storeId: number): Promise<StoreBankAccountAdmin | null>
export type BankAccountWrite = {
  cbu: string | null; alias: string | null; holderName: string
  holderTaxId: string | null; bankName: string | null
  holderMatch: 'match' | 'mismatch' | 'unavailable' | null; checkedAt: string | null
}
upsertBankAccount(storeId: number, row: BankAccountWrite): Promise<void>
setBankAccountActive(storeId: number, isActive: boolean): Promise<void>
deleteBankAccount(storeId: number): Promise<void>
```

**Desviación menor y deliberada de la firma que sugiere `01-tasks.md`** para
`upsertBankAccount` (que decía `row: BankAccountInput & {...}`): usé un tipo
propio `BankAccountWrite` con `string | null` en vez de reusar
`BankAccountInput` (que tiene `string | undefined` en los campos opcionales,
porque así es como Zod resuelve un `.optional()`). Mezclar `null` (lo que
espera la fila de Postgres) con `undefined` (lo que produce el schema) en el
mismo tipo es una fuente de bugs silenciosos — `row.cbu ?? null` en dos
lugares distintos en vez de una conversión explícita en el borde. El
comportamiento es idéntico al que pedía la tarea, solo cambia el tipo.

`getPublicBankAccount` usa el cliente de **sesión** y enumera las cinco
columnas del grant (`select('store_id, cbu, alias, holder_name, bank_name')`)
— confirmado contra `01-tasks.md`: `select('*')` da `permission denied` para
`anon` porque el grant es por columna.

Las otras cuatro funciones usan `createAdminClient()` y **no verifican
permisos** — eso es responsabilidad del caller (`admin.actions.ts`), igual
que `markPaidInStore`.

`upsertBankAccount` fuerza `is_active: true` siempre, incluso en un upsert
sobre una cuenta que estaba apagada: `00-architecture.md` §5.11 dice
explícitamente que cambiar el CBU con el código "es un alta", así que
confirmar un cambio de cuenta reactiva el medio de pago.

### T1.5 — `store.model.ts` / `store.mapper.ts`

**`store.mapper.ts` ya venía con `transferPaymentEnabled` mapeado** (lo hizo
el hilo principal, según el brief). **`store.model.ts` no necesitó ningún
cambio**: `fetchStoreWithBranding` sigue con `select('*, store_branding(*)')`
y no embebe `store_bank_accounts` (tal como pide la tarea — el CBU viaja por
`OrderPublicView`, no por `Store`), y `StoreRow` ya trae la columna nueva
porque `database.types.ts` ya está regenerado. No toqué el archivo.

### T1.6 — `src/lib/store-availability.ts`

`PaymentFlags` ganó `transferPaymentEnabled`; `canCollectPayment` pasa a
`online || inStore || transfer`. `canTakeOrders` no cambió de forma (sigue
siendo `PaymentFlags & Pick<Store, 'acceptingOrders'>`, así que se actualizó
solo). Sigue sin `server-only`.

**Efecto colateral que tuve que resolver para no romper el árbol**:
`src/lib/store-hours.ts` (`storefrontGate`) tenía un `Pick<Store, ...>` que
no incluía `transferPaymentEnabled` y dejó de compilar apenas hice
`PaymentFlags` más estricto. Ese archivo no es de nadie en `01-tasks.md`
(no está en la lista de ningún slice), así que lo consideré una consecuencia
mecánica y obligatoria de mi propio cambio de T1.6 y lo arreglé (una línea:
sumar `'transferPaymentEnabled'` al `Pick`). Los cuatro `page.tsx` que llaman
a `storefrontGate` (`/[store]/{page,carrito,checkout,producto/[id]}`) siguen
compilando sin cambios porque le pasan la tienda completa.

**Rompí (a propósito, es inevitable) 2 tests preexistentes** en
`tests/lib/store-availability.test.ts` (2 de 8, el resto sigue en verde):
los fixtures llaman a `canCollectPayment`/`canTakeOrders` con objetos que no
tienen `transferPaymentEnabled`, así que en JS puro da `undefined` en vez de
`false` en los casos de "ningún medio de pago". Es exactamente el precio de
que `PaymentFlags` gane un campo obligatorio — **no lo arreglé yo** (es
`tests/`, territorio del `test-engineer`); el fix es agregar
`transferPaymentEnabled: false` a esos dos fixtures.

### T1.7 — `store-pending-change.model.ts`

`PendingChangeKind` ganó `'bank_account'`, con el comentario de por qué su
payload NO se cifra (a diferencia de `payment_credentials`).

### T1.8 — `admin.controller.ts`

```ts
export type BankAccountStatus = { account: StoreBankAccountAdmin | null; validatorAvailable: boolean }
getBankAccountStatus(storeId: number): Promise<BankAccountStatus>

export type BankHolderProbe = {
  available: boolean
  match: 'match' | 'mismatch' | 'unavailable'
  bankName: string | null
  resolvedCbu: string | null
}
```

`BankHolderProbe` no lleva `holderName`, tal como pide la tarea (evitar
divulgar el nombre de un tercero cuando el resultado es `mismatch`).

### T1.9 — `admin.actions.ts`

```ts
requestBankAccountChangeAction(storeId: number, input: BankAccountInput): Promise<ActionResult<PendingChangeStarted>>
lookupBankHolderAction(storeId: number, probe: { cbu?: string; alias?: string; holderTaxId?: string }): Promise<ActionResult<BankHolderProbe>>
setBankAccountActiveAction(storeId: number, isActive: boolean): Promise<ActionResult>
deleteBankAccountAction(storeId: number): Promise<ActionResult>
```

**Desviación deliberada que reporto explícitamente porque otro slice (T3)
depende de esta firma**: `01-tasks.md` describe `lookupBankHolderAction` con
`probe: { cbu?: string; alias?: string }`, **sin `holderTaxId`**. Sin el CUIT
que el dueño está tipeando en ese momento no hay con qué comparar, y calcular
`holderMatch` — que es el propósito entero de la función, y que el criterio
de aceptación de T1 exige probar explícitamente — es imposible sin ese dato.
Traté la omisión como un vacío editorial del documento (no una decisión de
diseño) y agregué `holderTaxId?: string` al `probe`. **T3 tiene que mandar el
valor actual del campo CUIT del formulario en esta llamada.**

`confirmPendingChangeAction` ganó la tercera rama (`kind === 'bank_account'`)
que llama a `upsertBankAccount` + `revalidatePath('/admin/pagos')`, siguiendo
el patrón exacto de la rama `payment_credentials`.

`resolveHolderMatch` (privada, no exportada) es el único lugar que compara
CUIT contra CUIT — la reusan tanto `requestBankAccountChangeAction` como la
lógica inline de `lookupBankHolderAction` (que no pude factorizar en la misma
función sin cambiar el tipo de retorno, así que quedó una pequeña
duplicación de la rama de decisión de 3 líneas; lo dejo así porque intentar
unificarlas complica más de lo que ahorra).

## Archivo fuera de mi propiedad que tuve que tocar (reportado)

**`src/services/notifications/email/payment-change.tsx`**: no está en la
lista de ningún slice de `01-tasks.md`. Extender `PendingChangeKind` con
`'bank_account'` (T1.7, obligatorio) rompe la compilación de
`sendPaymentChangeCode`/`sendPaymentChangeNotice`, cuyo parámetro `kind` es
`keyof typeof CHANGE_LABELS` — un tipo derivado de un `const` que no incluía
la clave nueva. Agregué **una entrada** al `const CHANGE_LABELS`:
`bank_account: 'la cuenta bancaria donde recibís las transferencias'`. Es el
mismo patrón que las dos entradas existentes, no cambié nada de la lógica de
envío. Sin este cambio el árbol quedaba roto por un archivo que ningún slice
declaraba dueño.

## Contratos expuestos (para T2/T3, y confirmación de las firmas pedidas)

```ts
// src/models/store-bank-account.model.ts
function getPublicBankAccount(storeId: number): Promise<StoreBankAccount | null>
function getBankAccountForAdmin(storeId: number): Promise<StoreBankAccountAdmin | null>

// src/lib/store-availability.ts
function canCollectPayment(store: Pick<Store, 'inStorePaymentEnabled' | 'onlinePaymentEnabled' | 'transferPaymentEnabled'>): boolean
```

`getPublicBankAccount` es la función que T2 tiene que importar en
`getOrderByToken` (`order.model.ts`) para poblar `OrderPublicView.bankAccount`
cuando `paymentMethod === 'transfer'`. `canCollectPayment` es la que ya
importa `createOrder` para el gate de "¿esta tienda puede cobrar?" — ahora
también es `true` con solo transferencia habilitada.

## Reglas de negocio, invariantes y casos de error implementados (spec para `test-engineer`)

Verificables en TS (sin base real):

- `isValidCbu` acepta los dos vectores reales verificados en este dev log y
  rechaza cualquier mutación de un solo dígito de cualquiera de los dos.
- `isValidCbu` rechaza un CBU cuyo bloque suma resto 0 SIN el `% 10` exterior
  bien implementado — el caso de Prex (`0000013` → DV 0) está verificado.
- `isValidAlias` acepta 6-20 de `[A-Za-z0-9.-]`, rechaza 5, 21, espacio, `_`, `@`.
- `isCvu('0000003100023596996524') === true`; `isCvu('0070325120000003733248') === false`.
- `canCollectPayment` es `true` con **solo** `transferPaymentEnabled: true`
  (los otros dos en `false`).
- `bankAccountInputSchema` rechaza una clave desconocida (`.strict()`), un
  CBU con checksum malo (mensaje que nombra el problema, no "campo
  inválido"), y un objeto sin `cbu` NI `alias`.
- `bankAccountInputSchema` ACEPTA un objeto con solo `alias` (sin `cbu`) — es
  D3, y es intencional.
- `manual.adapter` devuelve `null` en `lookupByAlias` y `lookupByCbu`
  siempre; `getBankAccountValidator()` sin `BANK_VALIDATION_PROVIDER`
  configurado devuelve el manual.
- Un adapter que tira (timeout, JSON inválido, forma inesperada) hace que
  `lookupBy*` devuelva `null`, nunca propaga — cubre tanto `manual` (nunca
  tira por construcción) como `certisend` (envuelto en `try/catch`).
- `deleteBankAccountAction` y `setBankAccountActiveAction` con rol `staff`
  (no `owner`) devuelven `{ ok: false }` con el mensaje de "solo para el
  dueño" (equivalente al 403 que ya prueban los tests existentes de
  `requestPaymentCredentialsChangeAction`).
- `lookupBankHolderAction` con un adapter stub que devuelve
  `{ holderName: 'OTRA PERSONA', holderTaxId: '20111111112' }`: el
  `ActionResult` NO contiene el string `'OTRA PERSONA'` en ninguna parte
  (verificar tanto el campo `data` como cualquier mensaje de error).
- `requestBankAccountChangeAction` con el mismo stub: el payload que
  `createPendingChange` recibe (mockeable) tampoco contiene `'OTRA PERSONA'`
  — solo `holderMatch` y `checkedAt`.
- `holderMatch` resuelve `'match'` cuando los CUIT coinciden dígito a dígito,
  `'mismatch'` cuando no, y `'unavailable'` cuando falta el CUIT declarado, el
  CUIT de la respuesta, o no hay proveedor — nunca compara por nombre. Probar
  los dos call sites: `resolveHolderMatch` (usado por
  `requestBankAccountChangeAction`) y la lógica inline de
  `lookupBankHolderAction`.
- `bankHolderProbeInputSchema` (interno, no exportado) rechaza un probe sin
  `cbu` NI `alias`.

**Solo probable contra base real (`tests/db/`)** — ya cubierto por T0, pero
re-listo para que quede junto al resto de la spec de T1:

- `anon` puede `select` `cbu, alias, holder_name, bank_name` de una cuenta
  `is_active` de una tienda `active`, y NO puede leer `holder_tax_id`,
  `holder_match` ni `checked_at` (`42501`/`permission denied`).
- `anon` no ve la fila si `is_active = false` ni si la tienda está `suspended`.
- `authenticated` no puede `insert`/`update`/`delete` sobre
  `store_bank_accounts` por PostgREST.
- `stores.transfer_payment_enabled` se pone en `true` al insertar una cuenta
  activa, `false` al apagarla y `false` al borrarla (trigger), y
  `authenticated` no puede escribir esa columna directo.
- **Nuevo, no estaba en la lista original**: un test que confirme que
  `store_pending_changes` acepta `kind = 'bank_account'` (el CHECK ya lo
  permite, T0) y que `claim_store_pending_change` funciona igual para este
  kind que para los otros dos (no debería haber diferencia, pero no estaba
  cubierto explícitamente en `01-tasks.md`).

## Lo que dejé afuera / deferido

- El campo `holderTaxId` en `lookupBankHolderAction` (ver desviación
  reportada arriba) — necesita que T3 lo mande.
- `certisend.adapter.ts` no está verificado contra un payload real (sin
  sandbox). Si algún día se activa, hay que confirmar el nombre exacto del
  campo de CUIT (`titular.cuit` es mi mejor esfuerzo, no un hecho verificado).
- No agregué más códigos de PSP para CVU más allá de Mercado Pago (`0003`),
  a propósito — ver la nota larga en `cbu.ts` sobre la creencia extendida e
  incorrecta de "0031".

## Problemas de schema o de archivos ajenos para el hilo principal

Ninguno nuevo del lado de la migración: T0 ya cubre todo lo que T1 necesita
(grants por columna, trigger derivado, CHECK de `kind`). El único hallazgo es
el de `payment-change.tsx` documentado arriba, que ya resolví yo mismo por no
tener dueño declarado y ser un bloqueante de compilación directo de mi propio
trabajo de T1.7.

## Verificación

- `npm run typecheck`: cero errores en los archivos de mi propiedad. Quedan
  errores en `checkout.controller.ts`, `kitchen.controller.ts`,
  `checkout/page.tsx` (todos de T2/T4, en progreso en paralelo, confirmé que
  no vienen de mis cambios) y en `tests/lib/store-availability.test.ts` (2
  tests, reportado arriba, territorio de `test-engineer`).
- `npm run lint`: cero errores (1 warning preexistente en un archivo de T2,
  no mío).
- `npx vitest run`: 728/730 verdes. Los 2 rojos son exactamente los fixtures
  de `store-availability.test.ts` ya explicados. Los `tests/db/*` corrieron
  contra el stack local real (Docker levantado) y pasaron completos,
  incluidos los que ya cubren T0 para `store_bank_accounts`.
