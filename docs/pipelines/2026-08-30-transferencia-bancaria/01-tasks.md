# Transferencia bancaria — corte en slices

Referencia de decisiones: `00-architecture.md`. **Las cinco decisiones abiertas
(D0, D2, D3, D5, D7) las respondió el dueño el 2026-08-31** y están registradas
en §8; nada quedó pendiente. Tres de ellas cambian lo que este archivo decía:

- **D3 — cualquiera de los tres identificadores (CBU, CVU o alias).** `cbu` es
  **nullable**, `alias` es nullable, y un CHECK exige al menos uno. El contrato
  de T0.b dice `cbu: string | null` (abajo ya corregido). **La UI de T3 tiene que
  advertir** cuando el dueño guarda solo alias: sin CBU no hay checksum, así que
  un tipeo no se detecta.
- **D5 — la retención tras confirmar es de 24 h**, no 48.
- **D0 y D7 — no entra ningún proveedor de validación.** El adapter automático se
  construye igual (es el seam), pero el que queda configurado es el no-op.

**Regla del reparto: ningún archivo tiene dos dueños.** Importar lo del otro está
bien; editarlo, no. Los "no toca" son vinculantes y el hilo principal los
verifica en el diff.

**Orden de ejecución**

```
T0  (hilo principal, en serie)  ── migraciones + contratos + db:types
      │
      ├── T1  backend cuenta bancaria      ─┐
      ├── T2  backend pedido + comprobante ─┤  en paralelo
      ├── T3  frontend /admin/pagos        ─┤  (T3/T4/T5 arrancan con el
      ├── T4  frontend cliente             ─┤   contrato de T0, no esperan
      └── T5  frontend KDS                 ─┘   a que T1/T2 terminen)
      │
      └── T6 code-reviewer  +  T7 test-engineer   ── en paralelo, al final
```

---

## T0 — Schema y contratos · **HILO PRINCIPAL, NO UN AGENTE**

`CLAUDE.md` es explícito: **ningún agente toca migraciones ni resetea la base.**
Esta tarea también fija los archivos de contrato que dos o más slices necesitan,
para que ninguno de los dos los edite.

### T0.a — Migración `supabase/migrations/2026083____transferencia_bancaria.sql`

Contenido requerido (intención; el SQL lo escribe el hilo principal). Leer antes
la skill `supabase-postgres-best-practices` — en particular
`.claude/skills/supabase-postgres-best-practices/references/schema-constraints.md`
(patrón idempotente con `do $$ … pg_constraint … $$`, porque Postgres no tiene
`add constraint if not exists`), `security-privileges.md` y
`query-partial-indexes.md`.

1. **`orders_payment_method_check`**: `drop constraint` + `add constraint` con
   `in ('online','in_store','transfer')`.
2. **`payments_provider_check`**: idem, `in ('mercadopago','transfer')`.
3. **`store_pending_changes.kind` CHECK**: idem,
   `in ('payment_credentials','courier_payment_policy','bank_account')`.
4. **`public.store_bank_accounts`** — tabla nueva, forma en `00-architecture.md`
   §5.2. Con: CHECK `^[0-9]{22}$` en `cbu`, CHECK `^[A-Za-z0-9.-]{6,20}$` en
   `alias`, CHECK `^[0-9]{11}$` en `holder_tax_id`, trigger `set_updated_at`,
   `enable row level security`.
   - `revoke all … from anon, authenticated;`
   - `grant select (store_id, cbu, alias, holder_name, bank_name) on … to anon, authenticated;`
     — **exactamente esas cinco columnas.**
   - Policy `for select to anon, authenticated using (is_active and exists(store activa))`.
   - Policy `for select to authenticated using (private.is_store_member(store_id))`
     **NO se agrega**: el panel lee con admin client. Menos superficie.
   - **`grant select, insert, update, delete … to service_role;` explícito** — sin
     esto es `42501` aunque bypassee RLS (trampa documentada en `CLAUDE.md`).
5. **`stores.transfer_payment_enabled boolean not null default false`** +
   `private.sync_store_transfer_payment()` + trigger
   `after insert or update of is_active or delete on store_bank_accounts`,
   calcado de `20260829160000_online_payment_flag.sql`.
   **Sin `grant update` para `authenticated`.** `comment on column` diciendo que
   es derivada.
6. **Cinco columnas en `orders`**: `transfer_receipt_path`,
   `transfer_receipt_uploaded_at`, `transfer_receipt_mime`,
   `transfer_receipt_size`, `transfer_receipt_sha256`. **Ningún grant nuevo.**
7. **Índice parcial**
   `orders_transfer_pending_idx on orders (store_id, created_at) where payment_method='transfer' and payment_status='pending'`.
8. **`private.enforce_order_rules`** — redefinición completa (copiar la vigente de
   `20260829170000_scheduled_orders_and_hours.sql:641` y aplicar dos cambios):
   - el predicado de "impago no confirma" pasa de `= 'online'` a
     **`<> 'in_store'`**, con comentario explicando por qué el default seguro es
     enumerar el método bueno y no los malos;
   - **`transfer_receipt_uploaded_at` es inmutable una vez no nula**: si
     `old` no es null y `new` difiere, `raise` con `errcode = 'check_violation'`.
     Es la invariante de "un comprobante por pedido" y **es lo único que la
     sostiene contra PostgREST**.
9. **`expire_pending_orders`**: `drop function public.expire_pending_orders(int);`
   **explícito** (agregar parámetro crea una sobrecarga, no reemplaza), luego
   `create function public.expire_pending_orders(p_minutes int default 45, p_transfer_minutes int default 120)`
   que además cancela `payment_method='transfer' and payment_status='pending' and
   status='pending' and transfer_receipt_uploaded_at is null and created_at < now() - p_transfer_minutes`.
   Conservar el `not exists (payments approved)`. Rehacer
   `revoke execute … from public, anon, authenticated` + `grant … to service_role`.
10. **`platform_stores(bigint)`** — **sexta reescritura completa**, sumando
    `s.transfer_payment_enabled` a la lista de columnas enumeradas a mano. Sin
    esto la columna **desaparece sin error**.
11. **Bucket `order-receipts`**: privado, `file_size_limit` 5242880,
    `allowed_mime_types` `['image/jpeg','application/pdf']`, con
    `on conflict (id) do update` como el de `product-images`.
    **CERO policies.** Un comentario diciendo que es a propósito y que el único
    camino es `service_role`.
12. `pg_cron` **no se toca**: la purga va dentro del cron de Vercel que ya existe.
    `cleanup_old_records` **no se toca**.

**Verificación obligatoria antes de dar la migración por buena** (`CLAUDE.md`,
sección de trampas): con `curl` y la secret key, comprobar que `service_role`
puede (a) insertar en `store_bank_accounts`, (b) subir un objeto a
`order-receipts` y (c) firmar una URL de lectura. Y con la publishable key, que
`anon` **no** puede leer `holder_tax_id` ni escribir nada.

Después: `npm run db:reset` y `npm run db:types`.

### T0.b — Contratos que ningún slice edita

**`src/models/types.ts`** (lo escribe el hilo principal; T1–T5 solo importan):

```
StoreBankAccount = {
  cbu: string | null      // D3: puede venir solo el alias
  alias: string | null
  holderName: string
  bankName: string | null
}

StoreBankAccountAdmin = StoreBankAccount & {
  holderTaxId: string | null
  isActive: boolean
  // Resultado del contraste con el proveedor. Es TODO lo que sobrevive a esa
  // llamada: el nombre que devolvió la API no se persiste nunca (00-architecture §3.5).
  holderMatch: 'match' | 'mismatch' | 'unavailable' | null
  checkedAt: string | null
}

Store gana:            transferPaymentEnabled: boolean
Order gana:            transferReceiptPath: string | null
                       transferReceiptUploadedAt: string | null
                       transferReceiptMime: string | null
                       transferReceiptSizeBytes: number | null
                       transferReceiptSha256: string | null
OrderPublicView gana:  transferReceiptUploadedAt: string | null
                       bankAccount: StoreBankAccount | null
                         // poblado SOLO cuando paymentMethod === 'transfer'.
                         // Es el único camino por el que el CBU llega al cliente.
RateLimitBucket gana:  'receipt:order' | 'receipt:ip' | 'bank_account_change:store'
```

`Store` **no** gana `bankAccount`: el CBU llega al cliente por
`OrderPublicView`, no por la tienda. Ver la nota de T4.2 sobre por qué el
checkout no lo muestra.

**`src/lib/rate-limit-policy.ts`** (lo escribe el hilo principal):

| Balde | Límite | Modo | Por qué |
|---|---|---|---|
| `receipt:order` | **1 / 8 h** | bloquea, fail-open | La ventana anti-abuso del endpoint que pidió el dueño. **No es la regla de negocio**: "un comprobante por pedido" lo sostiene el trigger + el CAS |
| `receipt:ip` | 20 / 1 h | bloquea, fail-open | Un script probando tokens |
| `bank_account_change:store` | 3 / 1 h | **fail-closed (`'deny'`)** | Toca las credenciales de cobro, igual que `payment_change:store` |

Fail-open en los dos primeros porque protegen storage, no plata: si Postgres no
responde, negar la subida no protege nada y el pedido ya está roto igual.

---

## T1 — Backend: cuenta bancaria, validación de CBU y confirmación por código

**Agente: `senior-backend-engineer`.**

### Dueño exclusivo de

- `src/lib/cbu.ts` **(nuevo)**
- `src/services/bank-validation/**` **(nuevo)**
- `src/models/store-bank-account.model.ts` **(nuevo)**
- `src/models/store.model.ts`
- `src/models/mappers/store.mapper.ts`
- `src/models/schemas/store.schema.ts`
- `src/models/store-pending-change.model.ts`
- `src/lib/store-availability.ts`
- `src/controllers/admin.controller.ts`
- `src/controllers/admin.actions.ts`
- `.env.example` (solo las variables nuevas de §T1.2)

### No toca

`src/models/order.model.ts`, `src/models/schemas/order.schema.ts`,
`src/controllers/checkout.*`, `src/controllers/kitchen.*`, nada bajo
`src/views/**` ni `src/app/**`, `src/lib/storage.ts`,
`src/lib/rate-limit-policy.ts`, `src/models/types.ts`,
`supabase/migrations/**`, `tests/**`.

### T1.1 — `src/lib/cbu.ts`: módulo PURO, sin `server-only`

Sin `server-only` **a propósito**, por el mismo motivo que `src/lib/delivery.ts`:
el formulario de `/admin/pagos` valida en el browser mientras el dueño tipea, y
el schema de Zod valida en el servidor, y tiene que ser **la misma función**.

Exports:

```
CBU_LENGTH = 22
ALIAS_PATTERN = /^[A-Za-z0-9.-]{6,20}$/
isValidCbu(value: string): boolean
isCvu(value: string): boolean               // los tres primeros dígitos son '000'
cbuEntityCode(value: string): string | null // posiciones 1-3
bankNameForCbu(value: string): string | null
normalizeCbu(raw: string): string           // saca todo lo que no sea dígito
normalizeAlias(raw: string): string         // trim + lowercase
isValidAlias(value: string): boolean
```

**El algoritmo, exacto** (fuente y verificación en `00-architecture.md` §3.1):

- Bloque 1 = posiciones 1-7, pesos `[7,1,3,9,7,1,3]`, DV en la posición 8.
- Bloque 2 = posiciones 9-21, pesos `[3,9,7,1,3,9,7,1,3,9,7,1,3]`, DV en la 22.
- `DV = (10 − (Σ dígitoᵢ·pesoᵢ mod 10)) mod 10`.
- **El `mod 10` exterior es obligatorio y va comentado.** El texto del BCRA dice
  "el resto se deducirá de 10", lo que daría 10 cuando el resto es 0. El
  comportamiento real es 0 — verificado con el prefijo de CVU de Prex
  (`00000130`). Un implementador que lo omita rechaza CBU válidos y el bug solo
  aparece en un puñado de entidades.

**Tabla de entidades embebida y versionada en el repo**, no una llamada de red.
Semilla: `GET https://api.bcra.gob.ar/cheques/v1.0/entidades` (gratis, sin auth,
CORS `*`) **más** los códigos de PSP para CVU, que el BCRA no publica. Comentar
que la lista del BCRA trae solo 59 entidades (las del sistema de cheques) y que
faltan bancos reales, así que `bankNameForCbu` devuelve `null` sin drama y la UI
tiene que aguantarlo.

### T1.2 — `src/services/bank-validation/`: puerto + dos adapters

**Copiar literalmente la forma de `src/services/geocoding/`** (leer
`geocoder.port.ts`, `nominatim.adapter.ts`, `index.ts` antes de escribir).

```
bank-account-validator.port.ts   BankAccountLookup + interface BankAccountValidator
certisend.adapter.ts             el proveedor pago
manual.adapter.ts                no-op: los dos métodos devuelven null
index.ts                         getBankAccountValidator(), fábrica memoizada
```

Contrato (forma exacta en `00-architecture.md` §5.3):

```
BankAccountLookup = {
  cbu: string | null; alias: string | null
  holderName: string | null; holderTaxId: string | null
  bankCode: string | null; accountStatus: string | null
}
interface BankAccountValidator {
  lookupByAlias(alias: string): Promise<BankAccountLookup | null>
  lookupByCbu(cbu: string): Promise<BankAccountLookup | null>
}
```

Reglas **no negociables** del puerto:

- `import 'server-only'` en el port y en los adapters. `index.ts` también.
- Timeout de 5 s, `AbortSignal`, validación **Zod campo por campo** de la
  respuesta.
- **Ante cualquier error devuelve `null`, nunca tira.** Idéntico a
  `Geocoder.search`, y por el mismo motivo escrito en su docstring.
- **Nunca loguear la respuesta cruda**: contiene el nombre de una persona.
- Comentario obligatorio en el port: *este puerto se llama SOLO sobre el CBU del
  propio local, tipeado por su propio dueño. Nunca sobre un CBU que venga de un
  cliente* — es lo que mantiene el feature fuera del alcance de la Ley 25.326
  (`00-architecture.md` §5.3, §6.4).
- Fábrica por env: `BANK_VALIDATION_PROVIDER` (`manual` | `certisend`, **default
  `manual`**), igual que `WHATSAPP_PROVIDER`. **Sin variable configurada el
  sistema funciona entero.**

**`certisend.adapter.ts` se escribe contra el contrato y queda APAGADO.** La
investigación cerró y el veredicto es **no viable hoy** (`00-architecture.md`
§3.4): el endpoint responde `401 security tokens not defined.` sin credenciales,
no hay sandbox, el producto GOLD desapareció del catálogo autoservicio de 2026,
no publican SLA, y su propia status page marcó *"BD Certisend & VWCore"* en
**0,000 % de uptime durante 90 días corridos**. Se escribe igual, con el mapeo de
la forma reportada (`titular.nombre`, `cuenta.nro_cbu`, `respuesta.descripcion`),
**para que el día que haya credenciales sea una variable de entorno y no un
refactor** — pero el sistema no depende de él y el default es `manual`.

**Regla que el adapter tiene que cumplir aunque devuelva un nombre:** el nombre
**no sale del adapter hacia la base ni hacia el browser**. El único consumidor de
`BankAccountLookup` es la Server Action de T1.9, que lo reduce a un
`'match'|'mismatch'|'unavailable'` comparando **CUIT contra CUIT** y descarta el
resto. Va comentado en el port con el porqué (`00-architecture.md` §3.5).

### T1.3 — `store.schema.ts`

```
bankAccountInputSchema = z.object({
  cbu: z.string().transform(normalizeCbu).refine(isValidCbu, 'Revisá el CBU: los dígitos verificadores no dan'),
  alias: z.string().transform(normalizeAlias).refine(isValidAlias).optional()…,
  holderName: z.string().trim().min(2).max(120),
  holderTaxId: z.string().transform(solo dígitos).refine(11 dígitos).optional()…,
}).strict()
export type BankAccountInput
```

- **`.strict()`**, como `createOrderSchema`, y por el mismo motivo.
- El string vacío se trata como ausente (patrón `optionalText` de
  `order.schema.ts:183`).
- `bankName` **no entra al schema de input**: lo deriva el servidor con
  `bankNameForCbu`. Un campo de texto libre rotulado "Banco" es un campo de texto
  libre que se muestra al cliente al lado de un CBU.
- **El CBU es obligatorio, el alias opcional** — decisión D3, `00-architecture.md`
  §4.2. Si D3 se revierte, es cambiar este schema.

### T1.4 — `store-bank-account.model.ts`

```
getPublicBankAccount(storeId: number): Promise<StoreBankAccount | null>
getBankAccountForAdmin(storeId: number): Promise<StoreBankAccountAdmin | null>
upsertBankAccount(storeId: number, row: BankAccountInput & {
  bankName: string | null
  holderMatch: 'match'|'mismatch'|'unavailable'|null; checkedAt: string | null
}): Promise<void>
setBankAccountActive(storeId: number, isActive: boolean): Promise<void>
deleteBankAccount(storeId: number): Promise<void>
```

- `getPublicBankAccount` usa el cliente de **sesión** (RLS) y **enumera las cinco
  columnas del grant**: `select('store_id, cbu, alias, holder_name, bank_name')`.
  **`select('*')` da `permission denied` para `anon`** — el grant es por columna.
  Esto es exactamente lo que se rompe si alguien "simplifica" a `*`.
- Las otras cuatro usan `createAdminClient()`. **Ninguna verifica permisos**: eso
  es del caller, igual que `markPaidInStore`.
- `getBankAccountForAdmin` mapea `holder_tax_id` a `holderTaxId` **completo**
  (es el CUIT del propio local, no de un tercero).

### T1.5 — `store.model.ts` y `store.mapper.ts`

- `toStore` gana `transferPaymentEnabled: row.transfer_payment_enabled`.
  `StoreRow` se actualiza.
- `fetchStoreWithBranding` **no embebe** `store_bank_accounts`: si se embebiera
  habría que enumerar las columnas del grant y el dato no lo necesita ninguna de
  las cinco pages que leen la tienda. El CBU viaja por `OrderPublicView` (T2).
- Nada más cambia de firma.

### T1.6 — `store-availability.ts`

`PaymentFlags` gana `transferPaymentEnabled`; `canCollectPayment` pasa a
`onlinePaymentEnabled || inStorePaymentEnabled || transferPaymentEnabled`.
`canTakeOrders` no cambia de forma. **Sigue sin `server-only`.**

### T1.7 — `store-pending-change.model.ts`

`PendingChangeKind` gana `'bank_account'`. **Nada más**: el payload es
`PendingChangePayload` genérico y la RPC no cambia. **El payload NO se cifra** —
comentario obligatorio explicando que a diferencia del token de Mercado Pago el
CBU se publica, así que cifrarlo daría una falsa sensación.

### T1.8 — `admin.controller.ts` (lecturas y tipos)

```
export type BankAccountStatus = {
  account: StoreBankAccountAdmin | null
  validatorAvailable: boolean          // hay proveedor configurado
}
getBankAccountStatus(storeId: number): Promise<BankAccountStatus>   // requireStoreMembership adentro

export type BankHolderProbe = {
  available: boolean                             // hay proveedor Y contestó
  match: 'match' | 'mismatch' | 'unavailable'
  bankName: string | null                        // derivado OFFLINE por bankNameForCbu
  resolvedCbu: string | null                     // solo si se buscó por alias
}
```

**`BankHolderProbe` NO lleva `holderName`, y es deliberado** (`00-architecture.md`
§3.5). Cuando el resultado es `mismatch`, la cuenta puede ser de otra persona, y
devolver ese nombre al browser del dueño **es una divulgación de un dato personal
ajeno**. El veredicto alcanza: *"el CUIT de esa cuenta no coincide con el que
cargaste"* le dice al dueño exactamente lo que necesita hacer.

Los tipos y schemas van acá y **no** en `admin.actions.ts`: ese archivo tiene
`'use server'` y **solo puede exportar funciones async** (comentario ya presente
en `admin.controller.ts:102-108`).

### T1.9 — `admin.actions.ts`

```
requestBankAccountChangeAction(storeId: number, input: BankAccountInput): Promise<ActionResult<PendingChangeStarted>>
lookupBankHolderAction(storeId: number, probe: { cbu?: string; alias?: string }): Promise<ActionResult<BankHolderProbe>>
setBankAccountActiveAction(storeId: number, isActive: boolean): Promise<ActionResult>
deleteBankAccountAction(storeId: number): Promise<ActionResult>
```

Patrón calcado de `requestPaymentCredentialsChangeAction` (`admin.actions.ts:432`):

1. `toActionResult(async () => { … }, 'admin.<nombre>')`
2. `storeIdSchema.parse(storeId)`
3. `requireOwnerForPaymentChange(id)` (ya existe, línea 363) — **exige `owner`**
4. `consumeOrThrow('bank_account_change:store', String(id), msgFn, 'deny')`
   — **fail-closed**, como `payment_change:store`
5. parsear con `bankAccountInputSchema`
6. derivar `bankName` **offline** con `bankNameForCbu`; correr
   `getBankAccountValidator().lookupByCbu/Alias`; calcular `holderMatch`
   **comparando CUIT contra CUIT, dígito contra dígito** — nunca nombre contra
   nombre (`00-architecture.md` §3.5). Sin `holderTaxId` cargado, o sin CUIT en
   la respuesta, o sin proveedor ⇒ `'unavailable'`. **El `BankAccountLookup`
   completo se descarta en esta línea: no se persiste, no se loguea, no se
   devuelve al browser.**
7. `startPendingChange({ …, kind: 'bank_account', payload })` (ya existe, 388)

`confirmPendingChangeAction` (`admin.actions.ts:509`) gana una **tercera rama**
en el despacho por `kind` (524-554): `upsertBankAccount(...)` +
`revalidatePath('/admin/pagos')`.

`setBankAccountActiveAction` y `deleteBankAccountAction` **NO piden el código**:
`requireStoreMembership(id, { role: 'owner' })` y listo. Motivo escrito en
`00-architecture.md` §5.11 — el código protege el **destino de la plata**, no la
disponibilidad del método, y apagar no redirige nada. Va comentado en el código.

### Criterios de aceptación (spec del `test-engineer`)

Verificables en TS:

- `isValidCbu` acepta los nueve CBU/CVU de `00-architecture.md` §3.1 y rechaza
  cada uno con un dígito cambiado. **Caso obligatorio: un CBU cuyo bloque sume
  resto 0 (DV = 0)** — es el que rompe si falta el `mod 10` exterior.
- `isValidAlias` acepta `6`–`20` caracteres de `[A-Za-z0-9.-]`, rechaza 5, 21,
  espacio, `_` y `@`.
- `isCvu('0000003100023596996524') === true`;
  `isCvu('0070325120000003733248') === false`.
- `canCollectPayment` es `true` con **solo** `transferPaymentEnabled`.
- `bankAccountInputSchema` rechaza una clave desconocida (`.strict()`) y rechaza
  un CBU con checksum malo con un mensaje que nombra el problema.
- `manual.adapter` devuelve `null` en los dos métodos; `getBankAccountValidator()`
  sin env devuelve el manual.
- Un adapter que tira (fetch rechaza, timeout, JSON inválido, respuesta con forma
  inesperada) hace que `lookupBy*` devuelva `null`, **no que propague**.
- `deleteBankAccountAction` con rol `staff` (no `owner`) devuelve 403.
- **Con un adapter stub que devuelve `{ holderName: 'OTRA PERSONA', holderTaxId:
  '20111111112' }`: el `ActionResult` de `lookupBankHolderAction` NO contiene el
  string `'OTRA PERSONA'` en ninguna parte, y el payload que llega a
  `store_pending_changes` tampoco.** Es el test que sostiene §3.5 — el nombre que
  devuelve el proveedor no se persiste ni se devuelve al browser.
- `holderMatch` sale `'match'` cuando los CUIT coinciden dígito a dígito,
  `'mismatch'` cuando no, y `'unavailable'` cuando falta cualquiera de los dos o
  no hay proveedor. **Nunca se compara por nombre.**

**Solo probable contra base real (`tests/db/`)** — marcarlos como tales:

- `anon` puede `select` `cbu, alias, holder_name, bank_name` de una cuenta
  `is_active` de una tienda `active`, y **NO** puede leer `holder_tax_id`,
  `holder_match` ni `checked_at` (debe dar `42501`).
- `anon` no ve la fila si `is_active = false` **ni** si la tienda está
  `suspended`.
- `authenticated` (staff de la tienda) **no puede** `insert`/`update`/`delete`
  sobre `store_bank_accounts` por PostgREST.
- `stores.transfer_payment_enabled` se pone en `true` al insertar una cuenta
  activa, en `false` al apagarla y en `false` al borrarla — **por el trigger**, y
  `authenticated` no puede escribir esa columna (test hermano del que ya existe:
  `tests/db/online-payment-flag.test.ts`).

### Skills obligatorias

- **`supabase`** — cliente admin vs. sesión, grants por columna, RLS.
- **`supabase-postgres-best-practices`** — antes de escribir cualquier query:
  `.claude/skills/supabase-postgres-best-practices/references/security-privileges.md`
  y `security-rls-performance.md`.
- **`context7` (MCP)** — antes de usar la API de Zod v4 (`z.url()`, `error.issues`)
  y de `supabase-js`. Tu memoria de esas APIs está desactualizada.
- **`vercel-react-best-practices`** — para las Server Actions.

---

## T2 — Backend: pedido por transferencia, comprobante y purga

**Agente: `senior-backend-engineer`.**

### Dueño exclusivo de

- `src/models/schemas/order.schema.ts`
- `src/models/order.model.ts`
- `src/controllers/checkout.controller.ts`
- `src/controllers/kitchen.controller.ts`
- `src/controllers/kitchen.actions.ts`
- `src/lib/storage.ts`
- `src/app/api/orders/route.ts`
- `src/app/api/orders/[token]/comprobante/route.ts` **(nuevo)**
- `src/app/api/cron/cleanup/route.ts`

### No toca

`src/models/store*.ts`, `src/models/mappers/store.mapper.ts`,
`src/lib/store-availability.ts`, `src/lib/cbu.ts`, `src/services/**`,
`src/controllers/admin.*`, **`src/controllers/checkout.actions.ts`**, nada bajo
`src/views/**`, el resto de `src/app/**`, `src/models/types.ts`,
`src/lib/rate-limit-policy.ts`, `supabase/migrations/**`, `tests/**`.

**Tres comparaciones con `'online'` que NO se tocan** (`00-architecture.md` §2.2,
ítems 7-9): `canResumePayment` (`order.model.ts:236`), la guarda de
`resumePaymentAction` (`checkout.actions.ts:29`) y el `mismatch` de
`markOrderPaid` (`order.model.ts:1296`). En las tres, agregar `'transfer'` sería
el bug: una transferencia no tiene link de pago que retomar, y un pago de Mercado
Pago que aterriza en un pedido por transferencia **es** un `mismatch`.

**Importa de T1** (no edita): `getPublicBankAccount` de
`src/models/store-bank-account.model.ts` y `canCollectPayment` de
`src/lib/store-availability.ts`. Las firmas están en T1.4 y T1.6: podés arrancar
sin esperar a que T1 termine.

### T2.1 — `order.schema.ts`

- `paymentMethodSchema = z.enum(['online','in_store','transfer'])`.
- **No agregar `'transfer'` a `PAYMENT_PROVIDER`** (línea 86): esa constante es
  el provider de Mercado Pago y se usa en el camino de MP. El provider de la
  fila de `payments` de una transferencia se escribe literal en el modelo.
- `receiptUploadSchema`: MIME (`'image/jpeg' | 'application/pdf'`) y tamaño.
  `MAX_RECEIPT_BYTES = 4 * 1024 * 1024` exportado desde acá.
- **`ALLOWED_TRANSITIONS` no cambia.** Los estados son los mismos.

### T2.2 — `order.model.ts`

`createOrder` — sin cambio de firma. Cambios adentro:

- Gate nuevo junto a los de las líneas 544-552:
  `if (parsed.paymentMethod === 'transfer' && !store.transferPaymentEnabled) throw new DomainError('Este local no está aceptando transferencias por ahora')`.
- **Línea 681-682**: `initialStatus` deja de ser el ternario `isOnline ? …`.
  Pasa a `payment_method === 'in_store' ? 'confirmed' : 'pending'`. **Es el mismo
  criterio invertido que el trigger** (`00-architecture.md` §5.5) y va comentado:
  enumerar el método bueno hace que un cuarto método nazca seguro.
- El resto del payload a `create_order` no cambia: la RPC pasa
  `payment_method` como texto.

`updateOrderStatus` — línea 1177-1183: `current.payment_method === 'online'` pasa
a `current.payment_method !== 'in_store'`. Espejo exacto del trigger.

`toOrder` / `toOrderPublicView` — mapear las cinco columnas nuevas.
`canResumePayment` **se deja como está** (`paymentMethod === 'online'`): una
transferencia no ofrece "Ir a pagar", y eso ya es correcto.

`getOrderByToken` — cuando `payment_method === 'transfer'` y el pedido no está
cancelado, llama `getPublicBankAccount(storeId)` y lo pone en
`OrderPublicView.bankAccount`. **Es el único camino por el que el CBU llega al
cliente.** Para cualquier otro método, `null`.

Funciones nuevas:

```
markPaidByTransfer(p: {
  storeId: number; orderId: number
  reference: string | null; confirmedBy: string
}): Promise<Order>
```
- Admin client. **CAS**: `.eq('payment_method','transfer').eq('payment_status','pending')`
  — calcado de `markPaidInStore` (1212). Cero filas ⇒ `DomainError` 409.
- Escribe `payment_status='approved'`, `payment_ref = reference ?? 'transfer'`,
  `paid_at`.
- **Inserta fila en `payments`**: `provider='transfer'`,
  `provider_payment_id = 'order:'+orderId`, `status='approved'`,
  `amount_cents = total_cents`, `raw = { confirmedBy, reference, receiptSha256, receiptSizeBytes, receiptMime }`.
  Un `23505` sobre `payments_one_approved_per_order_idx` (usar
  `isUniqueViolationOn(err, ONE_APPROVED_PAYMENT_INDEX)`, que ya existe en
  `order.schema.ts:96-98`) ⇒ `DomainError` 409, **no un 500**.
- **NO exige que exista comprobante.** Si la resolución fue por WhatsApp, se
  confirma igual (`00-architecture.md` §5.9). Decisión del dueño, no re-abrir.

```
storeTransferReceipt(p: {
  token: string; bytes: Buffer; mime: 'image/jpeg' | 'application/pdf'; sha256: string
}): Promise<{ orderId: number; storeId: number }>
```
Orden de operaciones **exacto**, y el orden importa:
1. Resolver el pedido por token con admin client. Validar:
   `payment_method='transfer'`, `payment_status='pending'`, estado no terminal, y
   `transfer_receipt_uploaded_at is null`. Cada falla es un `DomainError` con
   texto propio.
2. Subir a `order-receipts` en `orderReceiptPath(storeId, orderId)` con
   `contentType` y `upsert: false`.
3. **UPDATE con CAS**: `.eq('id', orderId).is('transfer_receipt_uploaded_at', null)`
   escribiendo las cinco columnas. Cero filas ⇒ otra request ganó ⇒ **borrar el
   objeto recién subido (best-effort)** y tirar `DomainError` 409.
4. Comentario obligatorio: *se sube antes de escribir la fila, no al revés,
   porque un objeto huérfano lo barre el cron y una fila que miente no.*

```
getTransferReceiptSignedUrl(storeId, orderId): Promise<{ url: string; mime: string } | null>
listPurgeableReceipts(p: { paidHours: number; staleDays: number }): Promise<{ orderId: number; path: string }[]>
purgeReceiptObjects(paths: string[]): Promise<string[]>   // devuelve los que SÍ se borraron
clearReceiptRefs(orderIds: number[]): Promise<void>       // nulea path y mime, NUNCA uploaded_at
getPendingTransferOrders(storeId: number): Promise<Order[]>
```
- `getPendingTransferOrders`: `payment_method='transfer'`,
  `payment_status='pending'`, `status='pending'`, ordenado por
  `transfer_receipt_uploaded_at` **nulls last** y después `created_at`. Los que
  ya subieron comprobante van primero: son los que esperan una decisión.
- `getTransferReceiptSignedUrl` usa `createSignedUrl(path, 300)`. Cinco minutos.
- **`clearReceiptRefs` nunca nulea `transfer_receipt_uploaded_at`.** Es el
  registro durable de "este pedido ya usó su oportunidad", y el trigger lo
  bloquea igual — si el modelo lo intenta, explota con `check_violation`.

### T2.3 — `src/lib/storage.ts`

Agregar (sin tocar lo de `product-images`):

```
export const ORDER_RECEIPTS_BUCKET = 'order-receipts'
export function orderReceiptPath(storeId: number, orderId: number): string
  // `${storeId}/${orderId}/comprobante` — sin extensión, a propósito
```

Comentar por qué no lleva extensión: **un objeto por pedido, para siempre**, y el
MIME vive en la fila.

### T2.4 — `src/app/api/orders/[token]/comprobante/route.ts` (nuevo)

Un solo `POST`, `multipart/form-data`. Leer antes
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
— en Next 16 `params` es una **Promise** y existe el helper global
`RouteContext<'/api/orders/[token]/comprobante'>` (así lo usa
`src/app/api/orders/[token]/route.ts:43`, que es el modelo a copiar, headers
`Cache-Control: private, no-store` y log de IP truncada incluidos).

Orden **exacto**:

1. `orderTokenSchema.parse(token)` (ya existe, `order.schema.ts:272`).
2. `consumeRateLimit('receipt:ip', ip)` y `consumeRateLimit('receipt:order', token)`.
   El *subject* del segundo es el token, que `hashSubject()` va a firmar con HMAC
   antes de tocar la tabla — **nunca el token crudo en `rate_limits`**.
3. Leer el `File` del `FormData`. **Rechazar > `MAX_RECEIPT_BYTES` (4 MB) con un
   mensaje propio**, antes de que Vercel devuelva su `413
   FUNCTION_PAYLOAD_TOO_LARGE`, que no dice nada útil.
4. **Sniff de magic bytes sobre los bytes reales**, no sobre el `Content-Type`:
   `FF D8 FF` ⇒ `image/jpeg`; `25 50 44 46` (`%PDF-`) ⇒ `application/pdf`.
   Cualquier otra cosa: 400. **El `Content-Type` que manda el browser se ignora
   por completo** — es exactamente lo que el pedido del dueño exige y lo que un
   signed upload URL no permitiría.
5. SHA-256 de los bytes (`node:crypto`).
6. `storeTransferReceipt(...)`.
7. Devolver el `OrderPublicView` actualizado, con
   `Cache-Control: private, no-store`.
8. `toApiError(err, 'POST /api/orders/[token]/comprobante')` para todo lo demás.

**Nunca loguear el token.** Es la única credencial del pedido.

### T2.5 — `checkout.controller.ts`

`submitOrder` (línea 288) gana una tercera rama. Para `'transfer'`:
**no** se crea preferencia de Mercado Pago, `redirectUrl = /pedido/${token}`,
y **no** salen el comprobante por mail ni el WhatsApp de confirmación — el pedido
todavía no está confirmado. Esos dos salen recién al confirmar el pago (T2.6).

### T2.6 — `kitchen.controller.ts` y `kitchen.actions.ts`

```
// controller
confirmTransferPayment(p: { storeId: number; orderId: number; reference: string | null; userId: string }): Promise<void>
getTransferReceipt(p: { storeId: number; orderId: number }): Promise<{ url: string; mime: string } | null>

// actions
confirmTransferPaymentAction(p: { storeId: number; orderId: number; reference?: string }): Promise<ActionResult>
transferReceiptUrlAction(p: { storeId: number; orderId: number }): Promise<ActionResult<{ url: string; mime: string } | null>>
fetchPendingTransfersAction(storeId: number): Promise<ActionResult<Order[]>>
```

`confirmTransferPayment` orquesta, **en este orden**:
1. `markPaidByTransfer(...)`
2. `updateOrderStatus(orderId, 'confirmed')` — el trigger lo deja pasar recién
   ahora, que es el punto
3. `refreshFrozenEta(orderId)` — el ETA de hace media hora no le sirve a nadie
4. `after(() => sendReceiptEmail(...))` y `after(() => sendConfirmedWhatsapp(...))`
   — mismo patrón que `submitOrder` (`checkout.controller.ts:300-301`): no
   bloquean la respuesta
5. Borrar el objeto del comprobante **solo si D5 = borrado inmediato**. Con la
   retención decidida (24 h) **no se borra acá**: lo hace el cron. En los dos casos,
   **es un no-op tranquilo si no hay comprobante.**

Las tres acciones hacen `requireStoreMembership(storeId)` — **cualquier staff**,
no solo el dueño, igual que `markPaidInStoreAction` (`kitchen.actions.ts:109`).
El que está en el mostrador a las 21:00 no es el dueño.

### T2.7 — `src/app/api/cron/cleanup/route.ts`

Sumar un paso después del `cleanup_old_records` que ya está (línea 32-35):

```
RECEIPT_PAID_RETENTION_HOURS = 24     // D5, decidido 2026-08-31
RECEIPT_STALE_RETENTION_DAYS = 7
```

1. `listPurgeableReceipts({ paidHours, staleDays })`
2. `purgeReceiptObjects(paths)` → los que efectivamente se borraron
3. `clearReceiptRefs(orderIds de esos)`
4. Sumar `receiptsPurged` al JSON de respuesta

**El orden importa y va comentado**: nulear la fila antes de borrar el objeto lo
dejaría huérfano para siempre. Y **la purga NO puede ir dentro de
`cleanup_old_records`**: borrar filas de `storage.objects` con SQL **no borra el
archivo del backend de objetos** (`00-architecture.md` §5.8).

### T2.8 — `src/app/api/orders/route.ts`

El `GET` de cotización (línea 141-157) suma `transferPaymentEnabled` al objeto
`store` que devuelve. Nada más.

### Criterios de aceptación (spec del `test-engineer`)

Verificables en TS:

- `createOrder` con `paymentMethod:'transfer'` y `transferPaymentEnabled:false`
  ⇒ `DomainError` con el texto de interfaz.
- `createOrder` con `'transfer'` habilitado ⇒ `status:'pending'`,
  `payment_status:'pending'`, **y ninguna preferencia de MP creada**.
- `createOrder` con `'in_store'` ⇒ sigue naciendo `'confirmed'` (no-regresión del
  cambio de ternario).
- `submitOrder` con `'transfer'` ⇒ `redirectUrl === '/pedido/<token>'` y **no**
  dispara mail ni WhatsApp.
- `updateOrderStatus(id, 'confirmed')` sobre un `transfer` impago ⇒ `DomainError`.
- El route handler rechaza: > 4 MB, magic bytes que no son JPEG ni PDF, un
  `Content-Type: image/jpeg` con bytes de otra cosa, y un token inexistente.
- Segunda subida al mismo pedido ⇒ 409 con texto de dominio.
- `markPaidByTransfer` sobre un pedido ya `approved` ⇒ 409, no 500.
- `markPaidByTransfer` **sin comprobante** ⇒ funciona.
- `OrderPublicView.bankAccount` es `null` para `online` e `in_store`, y trae los
  cuatro campos para `transfer`.
- `clearReceiptRefs` no toca `transferReceiptUploadedAt`.

**Solo probable contra base real (`tests/db/`)**:

- **Paridad trigger ↔ TypeScript**, igual que el test que ya existe: el trigger
  rechaza `pending → confirmed` para `payment_method in ('online','transfer')`
  impago y lo permite para `'in_store'`. **Con `service_role`**, que es el punto:
  la versión de TS se puede saltear, la de Postgres no.
- El trigger rechaza cualquier UPDATE que cambie `transfer_receipt_uploaded_at`
  cuando ya tenía valor, **incluso con `service_role`**.
- `payments_one_approved_per_order_idx`: dos inserts de `provider='transfer'`
  aprobados sobre el mismo pedido ⇒ el segundo da `23505` (extender
  `tests/db/payments-one-approved.test.ts`).
- `payments_provider_check` acepta `'transfer'` y sigue rechazando cualquier otro
  valor.
- `expire_pending_orders(45, 120)`: cancela un `transfer` viejo **sin**
  comprobante; **no** cancela uno **con** comprobante; **no** cancela uno con un
  `payments` aprobado; y sigue cancelando los `online` a los 45 min (extender
  `tests/db/expire-pending-orders.test.ts`).
- **La función vieja de un solo parámetro ya no existe** (`drop function`
  aplicado). Probar que `expire_pending_orders(int)` da `42883`.
- `authenticated` no puede escribir ninguna de las cinco columnas
  `transfer_receipt_*` por PostgREST (extender `tests/db/grants-orders.test.ts`).
- `platform_stores()` devuelve `transfer_payment_enabled` (extender
  `tests/db/platform-rpcs.test.ts`) — es la trampa de las columnas enumeradas a
  mano.

### Skills obligatorias

- **`supabase`** — Storage (bucket privado, signed URLs), admin client, RLS.
- **`supabase-postgres-best-practices`** — antes de escribir queries nuevas.
- **`context7` (MCP)** — obligatorio para `@supabase/storage-js` (`createSignedUrl`,
  `upload`, `remove`, `info`) y para Zod v4. **Además**, leer
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
  antes de escribir el route handler: Next 16 no es el que tenés en memoria.
- **`vercel-react-best-practices`** — Server Actions y `after()`.

---

## T3 — Frontend: `/admin/pagos`, la cuenta bancaria

**Agente: `frontend-react-craftsman`.**

### Dueño exclusivo de

- `src/views/admin/pagos/**` (incluye `bank-account-form.tsx`, nuevo)
- `src/app/admin/(app)/pagos/page.tsx`
- `.impeccable/surfaces/src-views-admin-pagos-bank-account-form-tsx.md` **(nuevo)**

### No toca

`src/controllers/**`, `src/models/**`, `src/lib/**`, `src/views/admin/shell.tsx`,
`src/views/shared/**`, el resto de `src/views/**` y de `src/app/**`, `tests/**`,
`supabase/migrations/**`.

### Qué construir

Una sección nueva en la pantalla de Pagos, hermana de la de Mercado Pago que ya
está. `page.tsx` suma `getBankAccountStatus(session.store.id)` a la carga y se lo
pasa al form. **La page no importa `@supabase/*`** (regla dura).

- **Reusa `ConfirmWithCode`** (`src/views/admin/shared/confirm-with-code.tsx`,
  `ConfirmWithCodeHandle = { start: () => void }`), exactamente como
  `payment-form.tsx:262-267` lo hace para las credenciales de MP. **No se escribe
  un segundo flujo de código.**
- **Validación en vivo mientras el dueño tipea el CBU**, importando
  `isValidCbu` / `bankNameForCbu` de `src/lib/cbu.ts` (T1). Ese módulo **no**
  tiene `server-only` justamente para esto. Cuando el CBU es válido, el nombre
  del banco aparece al lado; cuando `bankNameForCbu` devuelve `null` (la tabla
  del BCRA no cubre todas las entidades), **no se muestra un hueco ni un error**:
  simplemente no se muestra el banco.
- **El contraste** (`lookupBankHolderAction`) se dispara a mano, con un botón, no
  en cada tecla. Devuelve un veredicto — `match` / `mismatch` / `unavailable` —
  **y nada más: no hay nombre que mostrar** (`00-architecture.md` §3.5, y la nota
  de T1.8). El copy de `mismatch` es *"el CUIT de esa cuenta no coincide con el
  que cargaste"*, que es exactamente lo accionable. Con
  `validatorAvailable: false` la sección entera **no se muestra** — nada de un
  botón que no hace nada.
- **`mismatch` NO bloquea.** Puede ser una cuenta a nombre del cónyuge, o el
  local puede facturar con un CUIT y cobrar en otro. Advierte, no impide.
- **Hoy `validatorAvailable` va a ser `false` siempre**, porque el proveedor
  quedó descartado (`00-architecture.md` §3.4). Construí igual el camino
  completo, pero **el estado que tenés que dejar impecable es el de "sin
  proveedor"** — es el que va a ver el dueño el día uno.
- Apagar (`setBankAccountActiveAction`) y borrar (`deleteBankAccountAction`) **no
  piden código**. Borrar sí pide confirmación destructiva — reusar el patrón de
  `src/views/admin/catalogo/confirm-delete-button.tsx`.

### Copy: lo que NO se puede escribir

- **Nada que diga "cuenta verificada"** ni ningún sello de confianza. Ni acá ni,
  sobre todo, en nada que vea el cliente. Lo que tenemos es una declaración del
  dueño contrastada contra un proveedor que puede no estar. Ver
  `00-architecture.md` §4.1.
- El texto del bloque explica, en rioplatense y sin vueltas, que **este CBU se le
  muestra a los clientes** y que cambiarlo redirige todos los cobros por
  transferencia. Es lo que justifica el código.

### Criterios de aceptación

- Sin cuenta cargada: estado vacío que **enseña** (qué es, qué habilita, qué se
  necesita), no un "no hay nada".
- Con cuenta cargada: CBU, alias, titular, banco, y el interruptor de activo.
- Un CBU inválido no se puede enviar y el mensaje **nombra el problema**
  ("los dígitos verificadores no dan"), no "campo inválido".
- Estados completos en cada control: default, hover, focus visible, disabled,
  loading, error. Targets de 44 px.
- El formulario no pierde lo tipeado si el código de 6 dígitos falla.

### Skills obligatorias

- **`impeccable`** — modo **Operate**. Leer antes de editar:
  `.claude/skills/impeccable/reference/craft-floor.md` y
  `.claude/skills/impeccable/reference/operate.md`.
  Para planificar la superficie nueva: `.claude/skills/impeccable/reference/shape.md`,
  y dejar el brief en `.impeccable/surfaces/`.
  **NO correr `scripts/context.mjs` ni `scripts/concept-seed.mjs`**: el mundo
  visual ya está decidido y volver a abrirlo produce una segunda identidad.
  El hook de `impeccable` corre solo después de cada edición: actuar sobre lo que
  reporta, no re-auditar a mano.
- **`web-design-guidelines`** — antes de cerrar el slice.
- **`frontend-design`** — solo para decidir tratamiento dentro del mundo ya
  elegido.
- **`vercel-react-best-practices`** — Server vs. Client Components, `useTransition`.
- **`context7` (MCP)** — antes de usar la API de `react-hook-form`, `sonner` o
  Tailwind v4. Recordar: `rounded-(--radius)`, **no** `rounded-[--radius]`.

---

## T4 — Frontend: checkout y seguimiento del cliente

**Agente: `frontend-react-craftsman`.**

### Dueño exclusivo de

- `src/views/storefront/checkout-form.tsx`
- `src/views/storefront/transfer-panel.tsx` **(nuevo)**
- `src/views/storefront/receipt-upload.ts` **(nuevo)**
- `src/views/storefront/order-tracking.tsx`
- `src/views/shared/order-status.tsx`
- `src/views/shared/image-compress.ts` **(nuevo — extracción, ver T4.3)**
- `src/views/admin/catalogo/image-upload.ts` **(solo para la extracción)**
- `src/app/[store]/checkout/page.tsx`
- `src/app/pedido/[token]/page.tsx`
- `src/app/legal/privacidad/page.tsx`
- `.impeccable/surfaces/src-views-storefront-transfer-panel-tsx.md` **(nuevo)**
- `.impeccable/surfaces/src-views-storefront-checkout-form-tsx.md` (actualizar)
- `.impeccable/surfaces/src-views-storefront-order-tracking-tsx.md` (actualizar)

### No toca

`src/controllers/**`, `src/models/**`, `src/lib/**`, `src/views/admin/**` salvo
el único archivo listado arriba, `src/views/shared/surfaces.tsx`, `tests/**`,
`supabase/migrations/**`.

### T4.1 — `checkout-form.tsx`: de dos métodos a tres

**El bug que hay que matar** está en las líneas 182-187:

```
bothPaymentMethodsAvailable = onlinePaymentEnabled && inStorePaymentEnabled
effective = both ? paymentMethod : (onlinePaymentEnabled ? 'online' : 'in_store')
```

Con transferencia habilitada y sin las otras dos, eso manda `in_store` y **el
pedido nace `confirmed` e impago: la cocina cocina gratis.** La derivación pasa a
ser sobre una **lista de métodos disponibles**: cero ⇒ no se puede pedir (ya lo
cubre `canTakeOrders`); uno ⇒ ese, sin `RadioGroup`; dos o más ⇒ `RadioGroup` con
los que haya. Nada de ternarios anidados.

También: el label del botón de envío (826-830) y el `initialState` (96).

### T4.2 — El checkout NO muestra el CBU

Deliberado. La opción dice **"Transferencia bancaria"** con una sublínea del tipo
*"Te mostramos el CBU y el monto exacto en la pantalla siguiente"*. Dos motivos:
mostrar el CBU antes de que el pedido exista invita a transferir sin pedido, y
evita una query más en el checkout. **`OrderPublicView.bankAccount` es el único
camino del CBU al cliente** (T2.2).

### T4.3 — `image-compress.ts`: extracción, no copia

`src/views/admin/catalogo/image-upload.ts:20` ya tiene `compressImage` (canvas,
1600 px, JPEG 0.82). **Se extrae a `src/views/shared/image-compress.ts` y los dos
lugares la importan.** Escribir una segunda es exactamente lo que `CLAUDE.md`
prohíbe. La extracción es mecánica: mover la función, exportarla, y que
`image-upload.ts` la importe. **No cambiar su comportamiento.**

La compresión no es solo peso: **re-encodea los píxeles, así que la salida es un
JPEG genuino producido por el browser**, cualquiera haya sido la entrada. Eso
es lo que mantiene la subida por debajo del límite de 4,5 MB de Vercel y lo que
hace que el sniff del servidor sea una segunda red y no la única.

`receipt-upload.ts` (cliente): si es imagen ⇒ comprimir e ir como
`image/jpeg`; si es PDF ⇒ **no tocar**, tope duro de 4 MB con mensaje propio
antes de mandar. `POST` a `/api/orders/<token>/comprobante` con `FormData`.

### T4.4 — `transfer-panel.tsx`: el panel del seguimiento

Es la pieza nueva más delicada del slice. Muestra, en este orden de importancia:

1. **El monto exacto**, en `Price`, con `.tabular`. Es lo primero que el cliente
   necesita y lo que tiene que copiar bien.
2. **El CBU**, con botón de copiar (patrón `CopyField` de
   `payment-form.tsx:16`) — en mobile, copiar 22 dígitos a mano es un error
   garantizado. Alias al lado si existe.
3. Titular y banco.
4. **El `shortCode` como referencia/motivo** de la transferencia.
5. El control de subida.

**La subida es de un solo tiro y la UI TIENE que decirlo ANTES, no después.**
Es una decisión tomada a conciencia por el dueño (`00-architecture.md` §1.1) y el
riesgo que trae es que el cliente suba una foto borrosa y quede trabado. La
mitigación es de interfaz:

- **Preview de la imagen elegida** antes de confirmar. Para PDF, el nombre y el
  peso del archivo.
- Una confirmación explícita del tipo *"Revisá que se lea el monto y la fecha.
  Solo podés subir un comprobante"*, **junto al botón**, no en un tooltip ni
  después.
- Después de subir: estado terminal claro ("Recibimos tu comprobante, el local lo
  está revisando"), **sin** control de subida, **sin** mostrar la imagen de vuelta
  (el cliente nunca recibe una signed URL de lectura).
- Y el escape hatch, visible: **el WhatsApp del local**, para el caso de "subí
  cualquier cosa". Reusar `store.whatsappPhoneE164` y la forma
  `https://wa.me/${phone.replace(/\D/g,'')}` de `store-dock.tsx:57`.

Estados a cubrir: sin comprobante · eligiendo (preview) · subiendo (progreso, no
spinner pelado) · recibido · error de red · error de validación del servidor ·
**pedido ya confirmado** (el panel desaparece y queda el flujo normal) · pedido
cancelado.

### T4.5 — `PaymentNotice` con tres casos

`order-status.tsx:157` es hoy un ternario binario. Tres casos, cada uno con su
texto: retiro ("Pagás al retirar"), online (el label de `payment_status`), y
transferencia (**qué tiene que hacer el cliente**, o "Estamos verificando tu
transferencia" si ya subió). Lo importa también el KDS (T5), que **no lo edita**.

### T4.6 — `/legal/privacidad`

Sumar el tratamiento del comprobante: qué se sube, dónde se guarda, **quién lo
ve** (solo el staff del local), y **por cuánto tiempo** (24 h después de
confirmado el pago, 7 días en cualquier otro caso). `CLAUDE.md` lo pide
explícitamente: esa página *"describe el comportamiento real"* y esto es
exactamente el tipo de cambio que la desactualiza. Los números tienen que
coincidir con las constantes de T2.7.

### Criterios de aceptación

- Con **solo** transferencia habilitada, el checkout la ofrece y el pedido creado
  tiene `paymentMethod: 'transfer'` (no `in_store`). **Es el bug de las líneas
  182-187 y es el caso que más importa.**
- Con los tres métodos, hay tres opciones y la primera seleccionada es coherente.
- El CBU se copia de una en mobile.
- Elegir un archivo muestra preview y la advertencia de un solo intento **antes**
  de que se pueda confirmar.
- Un archivo > 4 MB se rechaza en el cliente, con mensaje propio.
- Después de subir no hay forma de volver a subir en la UI.
- Un 409 del servidor ("ya subiste un comprobante") se muestra como estado, no
  como error rojo genérico.
- Sin `prefers-reduced-motion` y con él, el resultado final es idéntico: todos
  los keyframes arrancan desde un estado ya visible.
- Contraste ≥ 4.5:1 en todo el panel, sobre el color de marca del local — que es
  un color arbitrario. `ensureContrast()` ya lo garantiza; **no romperlo con
  opacidades sobre texto**.

### Skills obligatorias

- **`impeccable`** — el checkout y el seguimiento son **Operate** (el cliente ya
  decidió comprar; ahora tiene que completar con una mano y mala señal). Leer:
  `.claude/skills/impeccable/reference/craft-floor.md`,
  `.claude/skills/impeccable/reference/operate.md`, y
  `.claude/skills/impeccable/reference/shape.md` para el brief de
  `transfer-panel`. Leer también los dos briefs que ya existen y que este slice
  modifica:
  `.impeccable/surfaces/src-views-storefront-checkout-form-tsx.md` y
  `.impeccable/surfaces/src-views-storefront-order-tracking-tsx.md`.
  **NO correr `context.mjs` ni `concept-seed.mjs`.**
- **`web-design-guidelines`** — antes de cerrar. Es la superficie con más
  exposición del producto.
- **`frontend-design`**, **`vercel-react-best-practices`**, **`context7` (MCP)**
  (Tailwind v4: `rounded-(--radius)`, nunca `rounded-[--radius]`).

---

## T5 — Frontend: la bandeja de transferencias del KDS

**Agente: `frontend-react-craftsman`.**

### Dueño exclusivo de

- `src/views/admin/kds/**` (incluye `transfer-tray.tsx`, nuevo)
- `src/app/admin/(app)/page.tsx`
- `.impeccable/surfaces/src-app-admin-app-page-tsx.md` (actualizar)

### No toca

`src/views/shared/**` (importa `PaymentNotice` de T4, no lo edita),
`src/views/admin/pagos/**`, `src/views/admin/pedidos/**`, `src/controllers/**`,
`src/models/**`, `src/lib/**`, `tests/**`, `supabase/migrations/**`.

### Por qué existe este slice

`ACTIVE_STATUSES` no incluye `pending` (`order.schema.ts:29`), así que
**el KDS no muestra los pedidos por transferencia**. Sin esta bandeja el cliente
sube un comprobante y nadie se entera nunca. No es una mejora: es lo que hace que
el feature funcione (`00-architecture.md` §2.3).

### Qué construir

Una bandeja **arriba del tablero**, no una columna más. Precedente cercano:
`src/views/admin/pedidos/scheduled-tray.tsx` — pero acá va en el KDS y no en
`/admin/pedidos`, porque un programado no es urgente y **una transferencia sin
confirmar sí**: hay un cliente esperando y la cocina no arrancó.

- Se alimenta de `fetchPendingTransfersAction(storeId)` (T2.6), enganchada al
  **mismo poll de 30 s + Realtime que `board.tsx` ya tiene**. **Cero mecanismos
  nuevos de refresco.** El staff tiene SELECT sobre `orders`, así que —a
  diferencia de la cola del repartidor— Realtime sí dispara acá.
- Por fila: `shortCode`, nombre, monto, hace cuánto, y si subió comprobante.
  Los que **sí** subieron van primero (ya vienen ordenados del modelo).
- **Ver el comprobante** llama `transferReceiptUrlAction` **en el momento del
  click**, no al renderizar la lista. La URL vive 5 minutos: pedir N URLs
  firmadas para una lista que se repolea cada 30 s es tirar trabajo y ampliar la
  ventana. Imagen inline en un overlay; PDF en pestaña nueva.
  Overlay con `<dialog>` o la popover API: `board.tsx` tiene contenedores con
  `overflow`, y un dropdown posicionado adentro queda recortado.
- **"Confirmar pago"** llama `confirmTransferPaymentAction`, con un campo
  **opcional** para el número de operación. Está **habilitado con o sin
  comprobante** (`00-architecture.md` §5.9): si se resolvió por WhatsApp, se
  confirma igual.
- **"Escribirle por WhatsApp"**: deep link
  `https://wa.me/${order.customerPhoneE164.replace(/\D/g,'')}?text=...` con texto
  prellenado (nombre, `shortCode`, el problema). **`customer_phone_e164` YA está
  normalizado** por `phoneSchema` al crear el pedido, con la trampa del "15" de
  Córdoba resuelta. **No escribir una segunda normalización** — la forma exacta
  está en `store-dock.tsx:57` y `whatsapp-link.adapter.ts:68-70`.

### `order-card.tsx`: la tarjeta del tablero

Hoy la línea 121 (`unpaidInStore`) y la 286 son binarias sobre `in_store`. Un
pedido por transferencia **ya confirmado** cae en `PaymentNotice`, que con el
arreglo de T4.5 dice lo correcto. Lo único que falta acá es que la tarjeta
muestre **de qué medio vino la plata** (un chip "Transferencia"), porque en el
mostrador importa saber si hay que buscar el efectivo en la caja. **No agregar un
segundo botón de "Confirmar pago" en la tarjeta**: ese vive solo en la bandeja,
un pedido `pending` no está en el tablero, y dos caminos para la misma acción es
cómo se duplica un cobro.

### Copy: la regla que no se negocia

El botón y su contexto preguntan **"¿la plata está en tu cuenta?"**, nunca
"¿el comprobante es válido?". No es una preferencia de tono: en Argentina no
existe ninguna verificación oficial de autenticidad de un comprobante, y las apps
que los falsifican reproducen hasta el sonido de la app real
(`00-architecture.md` §3.3). Una interfaz que invita a validar la imagen le da al
local una confianza falsa, que es peor que ninguna.

**Prohibido**: cualquier cosa que parezca un veredicto sobre la imagen (checks
verdes, "comprobante válido", puntajes, OCR). La imagen es contexto.

### Criterios de aceptación

- Un `transfer` `pending` aparece en la bandeja en el siguiente poll.
- Confirmar lo saca de la bandeja y lo mete al tablero como `confirmed`.
- Sin transferencias pendientes, la bandeja **no ocupa espacio** — el tablero es
  la pantalla, no la bandeja.
- El comprobante se abre con un toque y se cierra con Escape y con el botón.
  Foco atrapado en el overlay y devuelto al disparador al cerrar.
- Un 409 (otro operario confirmó primero) se muestra como información, no como
  error, y la fila desaparece.
- Se puede confirmar un pedido sin comprobante.
- Densidad y targets de 44 px: se opera parado, en hora pico, con
  interrupciones cada treinta segundos.

### Skills obligatorias

- **`impeccable`** — modo **Operate**, la vara son los KDS de cocina. Leer:
  `.claude/skills/impeccable/reference/craft-floor.md`,
  `.claude/skills/impeccable/reference/operate.md`,
  `.claude/skills/impeccable/reference/shape.md` (para la bandeja nueva), y el
  brief que ya existe: `.impeccable/surfaces/src-app-admin-app-page-tsx.md`.
  **NO correr `context.mjs` ni `concept-seed.mjs`.**
- **`web-design-guidelines`** — antes de cerrar. El overlay y el foco son lo
  primero que se rompe.
- **`vercel-react-best-practices`**, **`context7` (MCP)**.

---

## T6 — Revisión · `code-reviewer`

Corre sobre el diff completo de la rama, en paralelo con T7. Escribe
`docs/pipelines/2026-08-30-transferencia-bancaria/03-review.md`. **No implementa
nada.** Además de su checklist habitual, verificar explícitamente:

1. **Ningún `page.tsx` importa `@supabase/*`.**
2. **Ningún `.actions.ts` exporta algo que no sea una función async.**
3. Ningún archivo tiene dos dueños según este documento (revisar el diff contra
   las listas de arriba).
4. **Los siete binarios de `00-architecture.md` §2.2 están todos cubiertos.** Los
   ítems 4 y 5 producen comida gratis: son el primer lugar donde mirar.
5. El predicado del trigger y el de `updateOrderStatus` dicen **lo mismo**
   (`<> 'in_store'`), no cosas parecidas.
6. **No se agregó ningún `grant` sobre `orders` ni sobre las columnas nuevas.**
7. `getPublicBankAccount` enumera columnas y **no usa `select('*')`**.
8. El route handler del comprobante **ignora el `Content-Type` del browser** y
   valida magic bytes.
9. `clearReceiptRefs` **no** nulea `transferReceiptUploadedAt`.
10. No hay una segunda normalización de teléfono ni una segunda `compressImage`.
11. **No hay copy que diga "verificado"** en nada que vea el cliente, ni nada que
    dé un veredicto sobre la imagen del comprobante.
12. Ningún adapter de `bank-validation` puede tirar hacia arriba.
13. **El nombre del titular que devuelve el proveedor no aparece en ninguna
    columna, en ningún payload de `store_pending_changes`, en ningún `log.*` y en
    ningún `ActionResult`.** Solo sobreviven `holderMatch` y `checkedAt`. Es la
    regla de `00-architecture.md` §3.5 y es la que mantiene el feature fuera del
    análisis de la Ley 25.326.

## T7 — Tests · `test-engineer`

Dueño **exclusivo** de todo `tests/`. Corre en paralelo con T6 y escribe
`docs/pipelines/2026-08-30-transferencia-bancaria/03-tests.md`. **No escribe
código de producción**: un test que falla y revela un bug real es un hallazgo que
se rutea al agente correspondiente.

Los criterios de aceptación de T1 y T2 son la spec, y están separados en
"verificable en TS" y "solo probable contra base real". Los segundos van a
`tests/db/` — RLS, grants por columna, triggers, índices únicos, `drop function`,
y las funciones que enumeran columnas a mano. Archivos nuevos sugeridos, siguiendo
la convención que ya existe:

```
tests/lib/cbu.test.ts
tests/models/bank-account.schema.test.ts
tests/services/bank-validation.test.ts
tests/services/receipt-upload-route.test.ts
tests/db/grants-store-bank-accounts.test.ts
tests/db/transfer-payment-flag.test.ts        (hermano de online-payment-flag)
tests/db/transfer-receipt-immutable.test.ts
```

Y extensiones a los que ya existen: `payments-one-approved`,
`expire-pending-orders`, `grants-orders`, `platform-rpcs`,
`order-state-machine`, `store-availability`.

**El test de paridad más importante** es el del trigger contra
`ALLOWED_TRANSITIONS` y contra la regla de "impago no confirma": tiene que correr
**con `service_role`**, porque el punto entero es que la versión de TypeScript se
puede saltear pegándole a PostgREST y la de Postgres no.
