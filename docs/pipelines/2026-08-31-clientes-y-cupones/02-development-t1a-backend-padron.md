# T1A — Backend: padrón de clientes, baja pública y rate limit

Agente: `senior-backend-engineer`. Rama `feat/clientes-y-cupones`. Schema ya
aplicado por el hilo principal (`supabase/migrations/20260901120000_clientes.sql`),
no tocado en este slice.

## Archivos agregados

- `src/models/schemas/customer.schema.ts` — Zod: `unsubscribeTokenSchema`,
  `storeIdSchema`/`customerIdSchema` (locales a este dominio, no confundir con
  los `storeIdSchema` privados de otros `.actions.ts`), `customerNotesSchema`,
  y `customerDirectoryRpcSchema` (valida el `jsonb` de `store_customer_directory`).
- `src/models/customer.model.ts` — único lugar que habla con Postgres para
  `store_customers`.
- `src/controllers/customers.controller.ts` — lectura para `/admin/clientes`.
- `src/controllers/customers.actions.ts` — las dos acciones del dueño.
- `src/controllers/unsubscribe.actions.ts` — la baja pública (`/baja/[token]`).

`npm run typecheck` y `npm run lint` en verde. No se corrió `npm test` (no me
corresponde: `test-engineer` es dueño del suite; además `db:reset`/`npm install`
están prohibidos para este agente).

## Contratos expuestos (para el frontend y para T1B/otros slices)

### `customer.model.ts`

```ts
function getCustomerDirectory(storeId: number): Promise<CustomerDirectory>
function updateCustomerNotes(storeId: number, customerId: number, notes: string): Promise<void>
function setCustomerOptOut(storeId: number, customerId: number, optedOut: boolean): Promise<void>
function findCustomerByUnsubscribeToken(token: string): Promise<UnsubscribeTarget | null>
function optOutByToken(token: string): Promise<void>

type UnsubscribeTarget = { displayName: string; alreadyOptedOut: boolean }
```

`UnsubscribeTarget` es un tipo **nuevo, no pedido explícitamente en el
encargo** y **no está en `src/models/types.ts`** porque tengo prohibido
tocar ese archivo en este slice. Vive exportado desde `customer.model.ts`.
Si el hilo principal quiere que suba a `types.ts` como vocabulario
compartido (coherente con la regla del repo de que los tipos de dominio
viven ahí), es un movimiento de una línea — lo señalo en vez de decidirlo
por mi cuenta.

`CustomerDirectory` y `StoreCustomer` se reusan tal cual de `types.ts`
(ya estaban puestos por el hilo principal antes de este slice).

### `customers.controller.ts` (lectura, `import 'server-only'`)

```ts
function getCustomerDirectoryForStore(storeId: number): Promise<CustomerDirectory>
```

**Renombrado a mitad de tarea por corrección del hilo principal** (el nombre
original era `getCustomerDirectoryForOwner`): el contrato fijo es
`getCustomerDirectoryForStore(storeId)`, calcado de
`getBankAccountStatus`/`getStoreScheduleForAdmin` en `admin.controller.ts`.
Recibe un `storeId` ya autorizado por la page (que hace su propio gate de
sesión, mismo patrón que `resolveStaffSession()` +
`src/app/admin/(app)/repartidores/page.tsx`) — el controller NO resuelve de
nuevo "quién es el usuario y de qué tienda es dueño" desde `getCurrentUser()`.

**Decisión: mantuve el controller en vez de eliminarlo**, aunque el hilo
principal dejó la puerta abierta a borrarlo si quedaba como un reenvío de una
línea (`CLAUDE.md`: "un controller que solo reenvía a un modelo es indirección
sin valor"). No es ese caso acá: el controller repite
`requireStoreMembership(storeId, { role: 'owner' })` como defensa en
profundidad, exactamente el mismo patrón que sus dos precedentes
(`getBankAccountStatus`, `getStoreScheduleForAdmin`), que también llaman
`requireStoreMembership` pese a ser alcanzados desde pages que ya resolvieron
sesión. Es coherente con la regla dura de `CLAUDE.md`: *"Cada page y server
action de /admin y /backoffice verifica de nuevo. La defensa real vive en
Postgres."* Sin este chequeo acá, la única barrera entre un `staff` no-dueño y
el padrón sería el redirect de la page (`resolveStaffSession`) y el `42501`
crudo de la RPC — ninguno de los dos es un `DomainError` legible. Con él, un
`staff` que golpee este controller sin pasar por la page (otra page nueva que
se olvide del gate, un test, un refactor futuro) recibe el mismo 403 legible
de siempre.

Un `staff` que no sea dueño recibe el `DomainError` estándar de
`requireStoreMembership` ("Esta acción es solo para el dueño del local", 403).
Esto es lo que la `page.tsx` de `/admin/clientes` tiene que llamar — no
importa `@supabase/*` directo, así que respeta la regla dura de `app/**`.

### `customers.actions.ts` (`'use server'` en la primera línea)

```ts
function updateCustomerNotesAction(storeId: number, customerId: number, notes: string): Promise<ActionResult<void>>
function setCustomerOptOutAction(storeId: number, customerId: number, optedOut: boolean): Promise<ActionResult<void>>
```

Ambas: parsean `storeId`/`customerId` con Zod, exigen `role: 'owner'`, delegan
al modelo y `revalidatePath('/admin/clientes')`. Un `staff` no-owner recibe
`ActionResult<{ ok:false, error: '...' }>` con el mensaje de `DomainError`
(no una excepción sin capturar: pasa por `toActionResult`).

`notes: ''` (string vacío) borra la nota — no hace falta un tercer parámetro
ni un `null` explícito desde el formulario.

### `unsubscribe.actions.ts` (`'use server'`, sin auth)

```ts
function getUnsubscribeTargetAction(token: string): Promise<ActionResult<UnsubscribeTarget>>
function confirmUnsubscribeAction(token: string): Promise<ActionResult<void>>
```

**Decisión no pedida explícitamente, documentada acá:** el encargo solo
mencionaba "la baja pública" como una acción, pero el plan (§5.12.2) describe
un `GET` que muestra de qué local es antes de dar de baja, y un `POST` que
recién ahí ejecuta. Como no soy dueño de ningún `.controller.ts` público para
esto (solo del `.actions.ts`), separé las dos responsabilidades en dos
Server Actions:

- `getUnsubscribeTargetAction` — de solo lectura, para el paso `GET` de la
  página (`app/baja/[token]/page.tsx`, fuera de mi alcance). Nunca da de baja
  por sí sola: RFC 8058 exige que un `GET` no tenga efecto, porque los
  escáneres de link de los clientes de mail hacen `GET` de todo.
- `confirmUnsubscribeAction` — el botón "Darme de baja" (o el submit del
  formulario que arme el frontend), idempotente.

Si el frontend prefiere no hacer una llamada de lectura previa (por ejemplo,
mostrar un formulario genérico de confirmación sin nombre de local), puede
ignorar `getUnsubscribeTargetAction` y llamar directo a
`confirmUnsubscribeAction`. Ninguna de las dos expone plata, historial ni PII
más allá del nombre del local — el error de token inválido es
`DomainError('Este link de baja no es válido', 404)`, igual para "no existe" y
"formato inválido": no hay forma de distinguir un token que nunca existió de
uno mal tipeado, a propósito (no es un oráculo).

Ambas consumen el balde `unsubscribe:ip` (30/1h, fail-open, ya cableado por
otro agente en `rate-limit-policy.ts` — no lo toqué). `humanizeRetryAfter` está
duplicada localmente porque un `.actions.ts` solo puede exportar funciones
async (mismo patrón que `admin.actions.ts`/`platform.actions.ts`/`staff.actions.ts`).

## Reglas de negocio / invariantes implementados

1. **`getCustomerDirectory` usa el cliente de SESIÓN, nunca el admin.** La RPC
   `store_customer_directory` es `SECURITY DEFINER` pero verifica
   `is_store_owner()` leyendo `auth.uid()`; con `service_role` no hay
   `auth.uid()` y la llamada falla siempre (idéntico a `store_couriers`,
   documentado en `CLAUDE.md` y en el comentario de la migración). Si algún
   día alguien "optimiza" esto a `createAdminClient()`, la RPC empieza a tirar
   `42501` en el 100% de los casos — **necesita una prueba contra Postgres
   real**, no se puede probar mockeando supabase-js.
2. **El `jsonb` de la RPC se valida con Zod antes de confiar en él**
   (`customerDirectoryRpcSchema`). `database.types.ts` tipa el retorno como
   `Json` puro; sin esta validación, un cambio de forma en la función SQL
   (redefinición futura, típico en este repo — ver "trampas conocidas" de
   `platform_stores`) pasaría desapercibido hasta romper en producción con un
   `undefined.something` en la vista.
3. **`updateCustomerNotes`/`setCustomerOptOut` van con `createAdminClient()` +
   `.eq('store_id', storeId)` explícito**, porque `store_customers` no tiene
   ni un grant para `authenticated` (RLS prendida, cero policies, revoke total
   — ver la migración). El aislamiento por tienda no se apoya en que el
   `customerId` que mandó el browser sea de esa tienda: si no matchea,
   `.select('id')` devuelve `[]` y se tira `DomainError` 404, no
   `permission denied`. **Esto sí se puede probar con Postgres real**: un
   `customerId` válido pero de OTRA tienda tiene que devolver 404, no éxito
   silencioso ni filtrar el nombre del cliente ajeno.
4. **`notes` vacío = `null` en la base**, no un string vacío. Es la forma
   natural de "borrar la nota" desde un textarea sin agregar un botón
   "Borrar" aparte.
5. **`findCustomerByUnsubscribeToken`/`optOutByToken` validan el token con
   Zod antes de tocar la base** y devuelven `null`/no-op en vez de tirar
   cuando el token no matchea ninguna fila — mismo patrón que
   `orderTokenSchema` en `order.model.ts`. Un token con formato inválido
   (largo o alfabeto incorrecto) ni siquiera genera una query.
6. **`optOutByToken` es idempotente por diseño, no por un `if` en TypeScript**:
   el `UPDATE` lleva `.is('marketing_opt_out_at', null)`, así que una segunda
   confirmación no pisa la fecha original con "ahora". **Esto necesita una
   prueba contra Postgres real**: dos llamadas seguidas con el mismo token
   tienen que dejar `marketing_opt_out_at` en el valor de la PRIMERA, no de la
   segunda.
7. **El error de token inválido no distingue "no existe" de "formato
   incorrecto"** en `unsubscribe.actions.ts`: los dos devuelven el mismo
   `DomainError` 404. Es el mismo criterio que "el mismo mensaje exista o no
   el email" en `requestMagicLinkAction` — evitar que el endpoint sea un
   oráculo de qué tokens son válidos.
8. **`customers.controller.ts`/`customers.actions.ts` exigen `role: 'owner'`
   explícito, dos veces** (una por cada archivo, porque son dos caminos de
   entrada distintos: lectura desde `page.tsx`, escritura desde el
   `Client Component`). Un `staff` que no sea dueño no puede ver el padrón ni
   editar una nota ni dar de baja a un cliente — el padrón muestra plata
   gastada por cliente, que es información de caja, mismo criterio que
   `store_couriers`/`is_store_owner` en vez de `is_store_member`.
9. **`unsubscribe:ip` fail-open**: si Postgres no responde, `consumeRateLimit`
   deja pasar (default `onError: 'allow'`, no lo pisé). Coherente con el plan
   (§5.13): es un endpoint que ya depende de Postgres para lo que hace de
   fondo, así que negar por el limitador no protege nada.

## Lo que necesita una base real para probarse (no se puede mockear)

- Trampa `store_customer_directory` + `service_role` → falla siempre. Ya
  cubierto arriba (punto 1).
- Aislamiento por tienda en `updateCustomerNotes`/`setCustomerOptOut`: un
  `customerId` de otra tienda → 404, no filtración (punto 3).
- Idempotencia de `optOutByToken` vía `.is('marketing_opt_out_at', null)`
  (punto 6).
- Que `store_customers` realmente no tenga grants para `authenticated`/`anon`
  (si algún día un test golpea la tabla con el cliente de sesión y NO recibe
  `permission denied`, es una regresión de la migración, no de este código).
- Que el `42501` de la RPC efectivamente se traduzca en el `DomainError` del
  punto 1 cuando se la llama sin ser dueño (requiere invocar la RPC de verdad
  contra un usuario `staff`, no `owner`).

## Supuestos y decisiones no cubiertas literalmente por el encargo

- **`UnsubscribeTarget`** (ver arriba): tipo nuevo fuera de `types.ts` por no
  poder tocar ese archivo. Reportado, no decidido unilateralmente como
  definitivo.
- **Dos Server Actions en `unsubscribe.actions.ts`** en vez de una sola,
  porque el plan (§5.12.2) describe un `GET` de solo lectura y un `POST` que
  ejecuta, y el encargo no me asignó ningún controller de lectura pública para
  esto. Si el frontend prefiere una sola acción, `getUnsubscribeTargetAction`
  puede quedar sin uso — no rompe nada, pero lo dejo señalado para que no se
  perciba como código muerto sin explicación.
- **No implementé el header `List-Unsubscribe`/RFC 8058 en sí** (eso vive en
  el mail template, servicio de notificaciones o en una ruta HTTP fuera de mi
  alcance) — solo la lógica de negocio que ese flujo necesita del lado del
  modelo/acciones. Si el `POST` de un solo click de un cliente de mail
  necesita una ruta de verdad (`app/api/baja/[token]/route.ts` en vez de una
  Server Action, porque `mailto`/one-click no invoca Server Actions de Next),
  eso es trabajo de quien sea dueño de `app/`: `confirmUnsubscribeAction` está
  lista para que un route handler la llame internamente si hace falta.
- **No toqué ningún archivo fuera de mi lista de dueño exclusivo.** No agregué
  nada a `RESERVED_SLUGS`, `rate-limit-policy.ts` ni `types.ts` (ya estaban
  con lo necesario, verificado antes de escribir código).

## Problemas de schema encontrados

Ninguno. La migración aplicada (`20260901120000_clientes.sql`) cubre todo lo
que este slice necesita: RPC, tabla, índices, grants y el token de baja. No
hubo que pedir nada al hilo principal.

---

## Corrección de integración (hilo principal, post-T1A)

Dos cambios sobre lo entregado, hechos al verificar el slice antes de darlo por
bueno. No son reproches al slice: el primero es un requisito que el brief de T1A
no nombraba y el segundo es una decisión de contratos que es del hilo principal.

**1. `findCustomerByUnsubscribeToken` devolvía el nombre del CLIENTE, no del LOCAL.**

Devolvía `display_name` de `store_customers`. Pero §5.12.2 pide que la página de
baja diga *de qué local* es la baja, y eso es el punto entero: el padrón es por
tienda, así que alguien que come en tres locales tiene tres bajas distintas. Con
el nombre del cliente, la página no puede decir qué se está dando de baja y el
cliente confirma a ciegas.

Ahora hace `select('marketing_opt_out_at, stores(name)')` y devuelve `storeName`.
Verificado contra PostgREST con la secret key: devuelve `"La Birra Burgers"`. Y
verificado que la tabla sigue cerrada — con la publishable key, `42501 permission
denied for table store_customers`.

De paso se sacó el nombre del cliente del payload en vez de sumarle el del local:
lo único que autoriza esa página es un token que llegó por mail, así que todo dato
de más es algo que se le confirma a cualquiera que tenga el link.

**2. `UnsubscribeTarget` se movió a `src/models/types.ts`.**

Estaba exportado desde `customer.model.ts`, que tiene `import 'server-only'` y
arrastra `@supabase/*`. La página de `/baja/[token]` necesita el tipo para tipar
las props de su vista, y `app/**/page.tsx` no puede importar ese módulo — regla
dura del repo, y grepeable. `types.ts` es el vocabulario compartido del dominio:
solo tipos, sin runtime, y es donde va todo lo que cruza modelo → controller →
vista.

O sea que la nota del informe de arriba sobre `UnsubscribeTarget` viviendo fuera
de `types.ts` quedó desactualizada: vive adentro.
