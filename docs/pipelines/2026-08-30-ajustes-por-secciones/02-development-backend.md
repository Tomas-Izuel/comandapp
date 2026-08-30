# Slice A — backend

**Agente:** senior-backend-engineer · **Rama:** `feat/ajustes-por-secciones`

## Qué se hizo

Partió `updateStoreSettings` (escribía las 28/29 columnas de `stores` de una)
en dos modelos y dos acciones, cada uno con su schema `.pick()`ado, según el
contrato fijado en `01-tasks.md`. Cero migraciones, cero cambios de schema en
Postgres — esto es únicamente recortar qué columnas toca cada `.update()`.

### Archivos tocados (los tres de mi slice, ninguno más)

- `src/models/schemas/store.schema.ts`
- `src/models/store.model.ts`
- `src/controllers/admin.actions.ts`

## Contratos expuestos (para el agente de frontend)

### `src/models/schemas/store.schema.ts`

```ts
export const storeProfileInputSchema = storeSettingsInputSchema.pick({
  name: true, description: true, phoneE164: true, whatsappPhoneE164: true,
  address: true, latitude: true, longitude: true,
  instagramHandle: true, mapsUrl: true, rappiUrl: true,
  pedidosYaUrl: true, uberEatsUrl: true,
})
export type StoreProfileInput = z.infer<typeof storeProfileInputSchema>

export const storeOrderingInputSchema = storeSettingsInputSchema.pick({
  acceptingOrders: true, inStorePaymentEnabled: true, minOrderCents: true,
  autoStartOrders: true, autoReadyOrders: true,
  deliveryEnabled: true, deliveryFeeCents: true, deliveryFreeFromCents: true,
  deliveryMinOrderCents: true, deliveryMinutes: true, deliveryBusyMinutes: true,
  scheduledDeliveryEnabled: true, scheduledCapacityPerNight: true,
  demandThresholdOrders: true, demandMultiplier: true,
})
export type StoreOrderingInput = z.infer<typeof storeOrderingInputSchema>
```

12 + 15 = 27 claves de las 29 de `storeSettingsInputSchema` (que se **conserva
intacto** como fuente de las dos derivadas — `location-map-field.tsx`, que no
se toca en este pipeline, sigue importando `StoreSettingsInput` de ahí y
compila igual). `timezone` y `currency` quedan fuera de las dos a propósito:
no tienen página, se siguen leyendo de `session.store`.

### `src/models/store.model.ts`

```ts
export async function updateStoreProfile(storeId: number, input: StoreProfileInput): Promise<void>
export async function updateStoreOrdering(storeId: number, input: StoreOrderingInput): Promise<void>
```

`updateStoreSettings` **se eliminó** (no quedó ni como wrapper). Cada función:
1. `requireStoreMembership(storeId)` — mismo permiso que antes, cualquier
   staff (no `owner`).
2. Parsea **su propio** schema (no confía en que el caller ya validó).
3. Hace `.update()` enumerando a mano **solo sus columnas** — mismo estilo que
   el resto del repo (`create_order`, `store_couriers`, etc. hacen lo mismo a
   nivel SQL).

La normalización "las dos o ninguna" de `latitude`/`longitude` se movió tal
cual a `updateStoreProfile`, comentario incluido: sigue sin ser un `.refine()`
porque eso rompería `.pick()` (explicado en el propio schema, no repetido acá).

El comentario que documenta por qué `courier_collects_payment` NO se escribe
en el `.update()` se preservó y se movió a `updateStoreOrdering` (es la
función que ahora vive al lado de los otros campos de envío/pago).

### `src/controllers/admin.actions.ts`

```ts
export async function updateStoreProfileAction(storeId: number, input: StoreProfileInput): Promise<ActionResult>
export async function updateStoreOrderingAction(storeId: number, input: StoreOrderingInput): Promise<ActionResult>
```

`updateStoreSettingsAction` se eliminó. Cada acción: `storeIdSchema.parse` →
`requireStoreMembership` → parse del schema picked → delega al modelo. Mismo
patrón que ya usaban las demás acciones de este archivo (`toActionResult`
envuelve para separar `DomainError` de fallas internas).

**No agregué `revalidatePath` a estas dos acciones nuevas.** La
`updateStoreSettingsAction` original tampoco llamaba `revalidatePath` — nada
en su cuerpo lo hacía — así que mantener eso es preservar el comportamiento
existente, no una omisión. Si el frontend necesita que el submit refresque la
página sin recargar, es un `router.refresh()` del lado del cliente (ya sea que
`settings-form.tsx` lo hiciera así, o algo a resolver en las nuevas
`profile-form.tsx`/`ordering-form.tsx` — no es mi slice).

## El `revalidatePath` que sí cambió

`confirmPendingChangeAction` (rama `courier_collects_payment`, la que
consume el código de 6 dígitos) tenía `revalidatePath('/admin/ajustes')` sin
segundo argumento. Ese campo ahora vive en la sub-ruta
`/admin/ajustes/pedidos` (vía `CourierCollectsPaymentField`, que el frontend
mueve a `ordering-form.tsx`), y `revalidatePath` sin `'layout'` **no invalida
sub-rutas** — la confirmación por código aplicaba en la base pero el switch
seguía mostrando el valor viejo hasta un refresh manual. Cambiado a:

```ts
revalidatePath('/admin/ajustes', 'layout')
```

Esta es la única ocurrencia de `revalidatePath('/admin/ajustes')` (sin
`'layout'`) que existía en el archivo — verificado con grep antes y después
del cambio.

## Uso de `updateStoreSettings*` fuera de mi slice (reportado, no tocado)

Dos hallazgos, ninguno bloqueante para este slice:

1. **`src/views/admin/ajustes/settings-form.tsx`** importa
   `updateStoreSettingsAction` (línea 18) y usa `StoreSettingsInput` en varios
   lugares (`storeToInput`, `FIELD_LABELS`, `useForm`, `zodResolver`). Es
   exactamente el archivo que `01-tasks.md` marca para **eliminar** en el
   Slice B (frontend), reemplazado por `profile-form.tsx` +
   `ordering-form.tsx`. `npm run typecheck` falla ahí mismo (`TS2724:
   '@/controllers/admin.actions' has no exported member named
   'updateStoreSettingsAction'`) — es exactamente el error esperado mientras
   el Slice B no haya terminado de moverlo. No es un error en mis archivos.

2. **`tests/services/invite-rate-limit.test.ts:57`** mockea
   `@/models/store.model` con `updateStoreSettings: vi.fn()` dentro de un
   `vi.mock(...)` factory. Verificado que ningún test de ese archivo llama a
   `updateStoreSettingsAction` ni a la función mockeada directamente (solo se
   usa para completar la forma del módulo mockeado) — el mock queda
   "colgado" (una key que ya no existe en el módulo real) pero no rompe nada
   en tiempo de ejecución porque Vitest no valida que el mock calce con la
   forma real del módulo. Igual lo señalo para el test-engineer: la key
   sobrante debería limpiarse o, si se agrega cobertura para las dos acciones
   nuevas, mockear `updateStoreProfile` / `updateStoreOrdering` en su lugar.

No encontré ninguna otra referencia a `updateStoreSettings` ni
`updateStoreSettingsAction` en `src/` ni `tests/` fuera de estos dos casos.

## Invariantes protegidas / reglas de negocio implementadas

Para que el test-engineer sepa qué mapear a casos de test (nada de esto
necesita Postgres real salvo lo marcado):

- **Cada acción valida su propio schema picked antes de llamar al modelo, y
  el modelo vuelve a parsear.** Defensa en profundidad ya existente en el
  repo (`updateStoreSettingsAction` ya hacía doble parse); se preserva en las
  dos acciones nuevas.
- **`.pick()` es la única fuente de los dos schemas nuevos.** Si
  `storeSettingsInputSchema` gana un campo nuevo con `.default()`, ninguno de
  los dos derivados lo ve hasta que se agregue explícitamente a un `.pick()`
  — comportamiento esperado y deseado (un campo nuevo no aparece en una
  página sin que alguien decida en cuál).
- **`updateStoreProfile` nunca escribe una columna que no sea de las 12
  enumeradas.** Verificable con una prueba de contrato: llamar con un
  `StoreOrderingInput`-shaped object (si TypeScript no lo impidiera) no
  debería ser posible porque el tipo de entrada es `StoreProfileInput`; a
  nivel runtime, el `.update()` solo referencia las claves de arriba —
  ninguna interpolación dinámica de columnas.
- **Ídem `updateStoreOrdering` con sus 15 columnas.** Ninguna de las dos toca
  `timezone`, `currency` ni `courier_collects_payment` — verificable
  leyendo el objeto pasado a `.update()`.
- **`courier_collects_payment` sigue sin grant de escritura vía RLS y sigue
  sin aparecer en ningún schema del set editable por staff.** Esto
  **necesita Postgres real** para probarse de punta a punta: un test de
  `tests/db/` que intente `PATCH /rest/v1/stores` con la publishable key del
  staff y ese campo, y confirme `permission denied` — ya debería existir
  cobertura de esto de antes de este pipeline (S-03), no es nuevo.
- **La normalización "las dos o ninguna" de lat/lng.** Caso de test puro
  (sin Postgres): `updateStoreProfile` con `latitude` seteada y `longitude:
  null` debería persistir `latitude: null` también (mock del cliente
  Supabase, verificar el payload de `.update()`).
- **`revalidatePath('/admin/ajustes', 'layout')` en la confirmación de
  `courier_collects_payment`.** No es testeable con vitest puro (es una API
  de Next con efectos de caché) — si el test-engineer quiere cubrirlo, es un
  mock de `next/cache` verificando los argumentos exactos de la llamada
  (`path` y `type: 'layout'`), no algo que necesite Postgres.
- **`requireStoreMembership(storeId)` sin `{ role: 'owner' }` en ambas
  acciones nuevas** — cualquier staff (no solo el dueño) puede guardar tanto
  perfil como pedidos/envío. Ya cubierto por el mismo patrón que el resto de
  `admin.actions.ts`.

## Decisiones y trade-offs

- **No convertí `storeProfileInputSchema`/`storeOrderingInputSchema` en
  objetos independientes.** El contrato pedía `.pick()` explícitamente y hay
  una razón de fondo: si `storeSettingsInputSchema` cambia de forma (un
  campo nuevo, un tipo distinto), TypeScript señala automáticamente cualquier
  `.pick()` que necesite revisión, en vez de que los tres schemas diverjan en
  silencio.
- **No agregué revalidatePath a las dos acciones nuevas** (ver arriba) —
  preserva el comportamiento exacto de la acción que reemplazan.
- **Dejé `storeSettingsInputSchema` y `StoreSettingsInput` intactos** en
  `store.schema.ts` pese a que ya no los usa ningún modelo propio: los sigue
  necesitando `location-map-field.tsx` (no tocado en este pipeline, según
  `01-tasks.md`) y son la fuente de los dos `.pick()`. Eliminarlos habría sido
  un cambio no pedido y hubiera roto un archivo que no es mío.
- **Los comentarios largos existentes** (normalización de coordenadas,
  motivo de excluir `courier_collects_payment`, motivo de que `timezone`/
  `currency` no se editen) se preservaron literalmente donde correspondía y
  se relocalizaron donde el código se movió, en vez de resumirlos.

## Deferido / no es mío

- El corte de `settings-form.tsx` en `profile-form.tsx` / `ordering-form.tsx`
  y el resto de `src/views/admin/ajustes/**` y `src/app/admin/(app)/ajustes/**`
  es del Slice B (frontend-react-craftsman), en paralelo.
- No hay schema, migración ni RLS nuevos que pedirle al hilo principal: este
  slice es puramente una reorganización de qué columnas toca cada `.update()`
  ya existente, sobre la misma tabla, mismo cliente (`createClient()`, RLS),
  mismo grant.

## Verificación

- `npm run typecheck`: limpio en mis tres archivos. Los únicos errores que
  quedan son en `src/views/admin/ajustes/settings-form.tsx` (archivo del
  Slice B, pendiente de eliminación) — `TS2724` por el import de
  `updateStoreSettingsAction` que ya no existe, y un `TS18046` preexistente
  no relacionado a mi cambio.
- `npm run lint`: sin salida, limpio.
- No corrí `npm test` como parte de "declarar hecho" más allá de confirmar
  que no rompí nada compilando: no toqué ningún archivo de `tests/`, y el
  único mock que referencia el nombre viejo (`invite-rate-limit.test.ts`) no
  ejercita el código eliminado (ver arriba).

---

## Round de arreglos (2026-08-30) — hallazgo bloqueante #1 de 03-review.md

Contexto: el switch "Tomando pedidos" tenía dos caminos de escritura
asimétricos. Apagar pasaba por `pauseScheduledNightAction` (`cancel_scheduled_orders`
apaga `accepting_orders` en la misma transacción que cancela los programados,
se aplica al instante). Prender solo tocaba el `useForm` y esperaba al submit
general, porque `acceptingOrders` seguía siendo una clave de
`storeOrderingInputSchema` que `updateStoreOrdering` escribía. Consecuencia: el
banner "Se aplica al instante" mentía al prender, y un submit con el valor
viejo (hecho desde otra pestaña/dispositivo) podía revertir en silencio una
pausa o una reapertura ajena. Detalle completo en `03-review.md`, hallazgo #1,
y en el mensaje de la orquestación.

### Cambios

1. **`src/models/schemas/store.schema.ts`** — Saqué `acceptingOrders` del
   `.pick()` de `storeOrderingInputSchema` (queda en 14 claves). Dejé un
   comentario en el propio `.pick()` explicando el porqué (dos caminos de
   escritura inmediatos, uno por dirección) y actualicé el comentario de
   cabecera del schema para que no la liste como parte del contrato. **NO
   toqué `storeSettingsInputSchema`**: `acceptingOrders` sigue viva ahí como
   fuente de la que derivan los `.pick()` (y porque `storeSettingsInputSchema`
   sigue siendo la fuente única, aunque hoy solo la lea el schema derivado, no
   un `.update()`).

2. **`src/models/store.model.ts`**:
   - `updateStoreOrdering`: saqué `accepting_orders: parsed.acceptingOrders`
     del `.update()` (queda en 14 columnas), con comentario explicando por qué
     falta pese a que el campo se vea y se toque en la misma página.
   - Agregué **`resumeAcceptingOrders(storeId: number): Promise<void>`**, la
     mitad simétrica de `cancelScheduledNight(..., { pause: true })`. Prender
     nunca cancela nada, así que no hay nada con lo que compartir atomicidad:
     un `UPDATE` de una sola columna alcanza. Va con el cliente de **sesión**
     (`createClient()`, RLS), no `createAdminClient()`: verifiqué en
     `supabase/migrations/20260826120000_hardening.sql` (bloque "Grants por
     columna: el corazón del arreglo") que `accepting_orders` SÍ tiene
     `grant update` para `authenticated`, a diferencia de `status`, `slug` y
     `courier_collects_payment` — así que no hace falta el patrón
     `markPaidInStore`/`setStoreStatus` (admin client + chequeo de permiso
     explícito) que exige CLAUDE.md para las escrituras que si necesitan
     bypassear RLS. Llama `requireStoreMembership(storeId)` sin `{ role:
     'owner' }`: mismo criterio que el resto de ajustes (S-03), cualquier
     staff logueado puede tocar esta decisión de negocio.

3. **`src/controllers/admin.actions.ts`**:
   - Importé `resumeAcceptingOrders` de `store.model.ts`.
   - Agregué **`resumeAcceptingOrdersAction(storeId: number): Promise<ActionResult>`**
     — firma exacta para que la use el frontend. Valida `storeId` con
     `storeIdSchema` (mismo patrón que toda acción del archivo) y delega en el
     modelo, que hace su propio `requireStoreMembership`. Sin diálogo, sin
     preview, sin código de confirmación: prender nunca es destructivo.
   - **Sin `revalidatePath`**: seguí el criterio de `pauseScheduledNightAction`,
     que tampoco la llama — el que revalida es el cliente
     (`ordering-form.tsx`) con `router.refresh()` después de que la acción
     resuelve (confirmé el patrón en el `onConfirm` del diálogo destructivo
     existente, línea ~244-248 de `ordering-form.tsx` antes del corte del
     frontend). Si el frontend termina necesitando invalidación de caché de
     Server Component en vez de `router.refresh()`, sería
     `revalidatePath('/admin/ajustes', 'layout')` (mismo motivo que
     `confirmPendingChangeAction`: la ruta real es la sub-ruta
     `/admin/ajustes/pedidos`).

### Contrato para el frontend

```ts
resumeAcceptingOrdersAction(storeId: number): Promise<ActionResult>
```

Sin body más allá del `storeId`. Éxito → `accepting_orders = true` aplicado ya
en la base. Igual que `pauseScheduledNightAction`, el llamador tiene que
refrescar la pantalla del lado del cliente (`router.refresh()`) para que el
`useForm` deje de mostrar el valor viejo — la acción no re-renderiza nada
sola.

### Qué necesita una base real para probarse

- Que `accepting_orders` tenga en efecto `grant update` para `authenticated`
  y que un `UPDATE` con el cliente de sesión (no admin) lo escriba sin
  `permission denied` — ya lo prueba (indirectamente) cualquier test que
  ejercite `pauseScheduledNightAction`/`updateStoreOrdering` contra Postgres
  real, pero conviene un caso explícito para `resumeAcceptingOrders` en
  `tests/db/` o `tests/models/`: staff no-owner reabre con éxito.
- Carrera entre `resumeAcceptingOrders` y `pauseScheduledNightAction`
  disparados casi simultáneamente desde dos sesiones: al no compartir
  transacción con nada, el UPDATE de una columna no tiene ninguna guarda de
  concurrencia más allá del `UPDATE` mismo — es una escritura de última
  escritura gana, igual que cualquier otro campo booleano simple del repo. No
  es una regresión (la escritura vieja, dentro del form completo, tampoco
  tenía guarda), pero es un comportamiento a documentar si alguna vez se
  decide que "reabrir" necesita el mismo `.eq('status', from)` que la máquina
  de estados de cocina.

### Verificación

- `npx next typegen && npm run typecheck`: limpio en mis tres archivos. Quedan
  3 errores esperados en `src/views/admin/ajustes/ordering-form.tsx` (el
  agente de frontend todavía no terminó de sacar `acceptingOrders` de su
  propio `Record`/`useForm`) y 1 en
  `tests/models/store-settings-split.model.test.ts` (paridad de schema, la
  actualiza `test-engineer`) — ambos anunciados como esperados en el mensaje
  de la orquestación, no los toqué.
- `npm run lint`: 0 errores. 1 warning preexistente-al-corte en
  `ordering-form.tsx` (`resumeAcceptingOrdersAction` importado y aún no
  usado del lado del frontend) — no es mi archivo.
- No corrí `npm test` más allá de la lectura de arriba: el test de paridad de
  schemas ya está roto a propósito (lo dice el mensaje de la orquestación) y
  no debo tocarlo.
