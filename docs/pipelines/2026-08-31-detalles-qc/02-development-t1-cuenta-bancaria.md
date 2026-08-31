# T1 — Cuenta bancaria: alta con solo alias

**Resultado: no se encontró ningún bug en el código actual.** El flujo de
alta con SOLO alias funciona de punta a punta, verificado por tres caminos
independientes (detalle abajo). No se tocó ningún archivo de `src/`. No hay
código para revisar en el diff de este slice — este documento es el reporte
de la investigación, tal como pide el punto 3 del brief cuando "en realidad
no falla por el camino que probaste".

## Qué NO se volvió a recorrer

Tal como indicaba el brief, no se volvió a cuestionar:

- `bankAccountInputSchema` (Zod) acepta `{ cbu: '', alias: 'mi.local.pagos', holderName: 'Juan Perez', holderTaxId: '' }`.
- Los CHECK de Postgres (`store_bank_accounts_has_identifier_check`, `store_pending_changes_kind_check`) son correctos.

## Cómo se reprodujo (tres capas, de menos a más fiel)

### 1. Capa de modelo, contra Postgres local real

Test temporal (`tests/db/tmp-repro-t1.test.ts`, borrado al terminar) que llamó
directo, sin mocks, a `createPendingChange` → `consumePendingChange` →
`upsertBankAccount` → `getBankAccountForAdmin`, con el payload exacto de una
cuenta solo-alias (`cbu: null`). Corrido con
`node --env-file=.env.local ./node_modules/.bin/vitest run <archivo>` (el
`vitest.config.ts` no carga `.env.local` solo, y `createAdminClient()` lo
necesita para apuntar contra `127.0.0.1:54321`, no contra el proyecto hosted
de `.env`).

**Resultado: PASA.** La fila queda con `cbu: null`, `alias: 'mi.local.pagos'`.

### 2. Capa de Server Action, con mocks solo en el borde de auth/mail

Test temporal (`tests/db/tmp-repro-t1-action.test.ts`, borrado al terminar)
que llamó a `requestBankAccountChangeAction` y `confirmPendingChangeAction`
TAL CUAL se exportan, mockeando únicamente `requireStoreMembership`,
`getCurrentUser`, `getStoreById` (para no depender de cookies de sesión reales
en vitest) y `sendPaymentChangeCode`/`sendPaymentChangeNotice` (para no
depender de que el mock capture el código real en vez de mandar un mail).
Todo lo demás —`bankAccountInputSchema.parse`, `consumeOrThrow` contra el
balde real de Postgres, `resolveHolderMatch`, `bankNameForCbu`,
`createPendingChange`, `claim_store_pending_change` (RPC), `upsertBankAccount`—
corrió sin mockear.

**Resultado: PASA** el request. El confirm dio un falso negativo por una
limitación del arnés de test (ver "Hallazgo colateral" abajo), pero la fila
en `store_bank_accounts` quedó escrita igual — la escritura real había
funcionado antes de que `revalidatePath` tirara.

### 3. End-to-end real: navegador contra `npm run dev` local

La prueba más fiel: se levantó `npm run dev` (puerto 3000, leyendo
`.env.local` como hace Next normalmente) contra el Postgres local ya
corriendo, se generó un magic link real con
`supabase.auth.admin.generateLink({ type: 'magiclink' })` (mismo mecanismo
que usa el backoffice) para `tomasizuel+dueno-la-birra@gmail.com`, se entró a
`/admin/acceso/confirm?token_hash=...&type=email` y de ahí a `/admin/pagos`
como dueño real de "La Birra Burgers" (store_id=1).

En el formulario: se borró la cuenta que había quedado de la prueba anterior
(para partir de "no hay cuenta cargada", el mismo estado que describe el
reporte), se cargó **solo** `alias = solo.alias.qc` y
`holderName = Juan Perez QC` (CBU y CUIT vacíos), y se tocó "Cargar cuenta
bancaria". El código de 6 dígitos salió por Resend de verdad (`RESEND_API_KEY`
real en `.env.local`) — se leyó con la MCP de Resend (`list-emails` /
`get-email`) en vez de inventar un valor. Se tipeó el código y se confirmó.

**Resultado: "Cuenta bancaria cargada", estado "Activa".** Verificado también
en la base:

```
select * from store_bank_accounts where store_id=1;
-- cbu=NULL, alias='solo.alias.qc', holder_name='Juan Perez QC', is_active=t
```

Flujo completo, sin ningún mock, contra Auth real, Resend real y Postgres
real: **funciona**.

## Hallazgo colateral (no es el bug reportado, pero vale documentarlo)

En la prueba de la capa 2, `confirmPendingChangeAction` devolvió
`ok: false` con el mensaje genérico, pero la fila de `store_bank_accounts` SE
HABÍA ESCRITO igual. La causa: `revalidatePath('/admin/pagos')` se llama
DESPUÉS de `upsertBankAccount` dentro del mismo `try` de `toActionResult`
(`admin.actions.ts` línea ~564), y en un test de vitest (sin el async local
storage de una request real de Next) `revalidatePath` tira
`Invariant: static generation store missing`. Esto NO reproduce el bug
reportado — en la capa 3 (Next real) `revalidatePath` funciona sin problema,
y otras acciones de este mismo archivo (`setBankAccountActiveAction`,
`deleteBankAccountAction`) ya lo usan en producción sin que nadie reporte
nada — pero expone un patrón fragil que vale la pena que quede escrito: si
`revalidatePath` (o cualquier otra cosa) tirara DESPUÉS de una escritura de
plata/estado ya confirmada, el dueño vería "no pudimos procesar la
operación" con la cuenta YA guardada. No lo toqué porque no es el bug
reportado y mover `revalidatePath` fuera del alcance de este slice hubiera
sido una refactorización no pedida — lo dejo señalado para que el hilo
principal decida si separar "aplicar el cambio" de "invalidar cache" amerita
su propio slice.

## Teorías descartadas o abiertas sobre el reporte original

- **Rate limit `bank_account_change:store` (3/hora, fail-closed).** Es el
  sospechoso que el brief pedía chequear. Se confirmó que `toActionResult`
  SÍ propaga el mensaje de `RateLimitError` tal cual (es una `DomainError`,
  no cae en el branch genérico) — el dueño vería literalmente "Ya pediste
  demasiados cambios de cuenta bancaria para este local. Probá de nuevo en
  X", no un error mudo. Si esto fue lo que pasó (varios intentos de prueba
  con CBU antes de probar con solo alias, agotando el cupo justo en ese
  intento), el mensaje YA es claro sobre la causa — no hace falta ningún
  cambio de copy. No se pudo confirmar ni descartar del todo porque no hay
  forma de saber qué probó el dueño antes de reportar.
- **Cache de esquema de PostgREST recién aplicada la migración.** La
  migración `20260831120000_transferencia_bancaria.sql` es nueva
  (`store_bank_accounts` no existía antes). Si el dueño probó en el momento
  exacto entre que la migración corrió y que PostgREST recargó su cache de
  esquema, `upsertBankAccount` (que pasa por PostgREST, no SQL crudo) pudo
  haber fallado con un error transitorio de "tabla/columna no encontrada".
  Es autolimitado (no se puede seguir reproduciendo ahora que el cache ya
  está al día) y no hay rastro para confirmarlo — se deja mencionado porque
  encaja con "pasó una vez, ahora no pasa".
- **Alias con caracteres no permitidos** (ej. `_`, que algunos bancos/apps sí
  aceptan pero el patrón BCRA vigente —documentado en `src/lib/cbu.ts`— no):
  produciría un error de campo claro ("El alias tiene que tener de 6 a 20
  caracteres..."), no un fallo genérico. Si fue esto, es la app funcionando
  como debe (rechazando un alias inválido), no un bug — pero lo dejo anotado
  por si el dueño vuelve con un alias específico que "debería" andar.

## Qué se tocó

**Nada en `src/`.** Se crearon y borraron dos archivos de test temporales
(`tests/db/tmp-repro-t1.test.ts`, `tests/db/tmp-repro-t1-action.test.ts`) y un
script temporal (`scripts/tmp-gen-magic-link.mjs`) para generar el magic link
de la prueba E2E — los tres se eliminaron antes de terminar. Se dejó
`npm run dev` corriendo en background (puerto 3000) porque otros agentes de
esta misma tanda (T3/T4/T5) ya lo estaban usando desde el mismo navegador
compartido.

Se creó y se borró una fila de prueba en `store_bank_accounts` (store_id=1) y
tres filas en `store_pending_changes` (se consumen/vencen solas, no hace
falta borrarlas). `npm run typecheck` en verde (sin cambios de código, es
esperable).

## Para el test-engineer

No hay código nuevo que testear en este slice. Si de todos modos se quiere
blindar contra una regresión futura, lo que valdría la pena en
`tests/db/` (no en unit, porque son invariantes reales de Postgres/PostgREST):

- Alta de `store_bank_accounts` con `cbu = null` y `alias` no nulo: el INSERT
  pasa (`store_bank_accounts_has_identifier_check`).
- Alta con `cbu = null` Y `alias = null`: el INSERT falla con
  `store_bank_accounts_has_identifier_check`.
- El grant de `service_role` sobre `store_bank_accounts` sigue estando
  (`grants-store-bank-accounts.test.ts` ya existe — confirmar que cubre
  INSERT, no solo SELECT/UPDATE/DELETE).

## Para el hilo principal

Nada de schema para pedir — los CHECK ya están bien, como decía el brief.
Sí dejo señalado el hallazgo colateral de `revalidatePath` de la sección de
arriba, por si amerita un slice propio ("separar la escritura de la
invalidación de cache en `confirmPendingChangeAction`, para que un fallo de
`revalidatePath` no reporte `ok:false` sobre un cambio que ya se guardó").
No lo consideré parte de este bug (T1) porque cambia un archivo que no es mío
en exclusividad para otra cosa que lo que se pidió, y porque en producción
`revalidatePath` no está fallando — es una fragilidad teórica, no el síntoma
reportado.
