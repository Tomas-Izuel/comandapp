# Clientes y cupones — corte en slices

> Consume `00-architecture.md`, que está **aprobado y cerrado** (cero preguntas
> abiertas). Las referencias `§x.y` son a ese archivo y son vinculantes: donde este
> documento resume, el otro manda.
>
> Rama: **`feat/clientes-y-cupones`**, desde `main` (que es el tronco real, aunque
> `origin/HEAD` diga otra cosa).
>
> **Dos entregas.** **A = Clientes** (T0A → T3A). **B = Cupones y campañas**
> (T0B → T7B). B depende de A y no arranca hasta que A esté integrada.
>
> **Ningún agente toca `supabase/migrations/**` ni resetea la base.** El schema es
> del hilo principal (T0A y T0B). Un agente que encuentra un problema de schema
> **lo reporta**, no lo arregla.
>
> **Ningún agente corre `npm install`.** Las dependencias ya están: no hace falta
> ninguna nueva (`vaul`, `react-hook-form`, `lucide-react`, `sonner`, `resend`,
> `@react-email/components` están todas en el stack).
>
> **Ningún agente escribe tests.** `tests/**` es del `test-engineer`, que corre
> después. Lo que cada tarea marca como "criterio de aceptación" **es su spec**.

---

## Mapa de propiedad de archivos

Regla dura del repo: **dos agentes sobre el mismo archivo se pisan sin aviso.** El
corte es por directorio y acá está declarado entero. Si una tarea necesita tocar un
archivo que no es suyo, **para y lo reporta**.

### Entrega A

| Archivo | Dueño |
|---|---|
| `supabase/migrations/*` | **T0A — hilo principal** |
| `src/models/types.ts` | **T0A — hilo principal** (contratos) |
| `src/models/customer.model.ts` | T1A |
| `src/models/schemas/customer.schema.ts` | T1A |
| `src/controllers/customers.controller.ts` | T1A |
| `src/controllers/customers.actions.ts` | T1A |
| `src/controllers/unsubscribe.actions.ts` | T1A |
| `src/models/schemas/platform.schema.ts` | T1A (solo `RESERVED_SLUGS`) |
| `src/lib/rate-limit-policy.ts` | T1A (solo el balde de A) |
| `src/app/admin/(app)/clientes/**` | T2A |
| `src/views/admin/clientes/**` | T2A |
| `src/views/admin/shell.tsx` | T2A |
| `src/app/baja/**` | T3A |
| `src/views/unsubscribe/**` | T3A |
| `src/app/legal/privacidad/page.tsx` | T3A |
| `src/app/legal/terminos/page.tsx` | T3A |

### Entrega B

| Archivo | Dueño |
|---|---|
| `supabase/migrations/*` | **T0B — hilo principal** |
| `src/models/types.ts` | **T0B — hilo principal** (contratos) |
| `src/lib/coupon.ts` | **T0B — hilo principal** (contrato compartido, ver T0B.3) |
| `src/lib/money.ts` | **T0B — hilo principal** (una función) |
| `src/models/coupon.model.ts` | T1B |
| `src/models/campaign.model.ts` | T1B |
| `src/models/schemas/coupon.schema.ts` | T1B |
| `src/controllers/marketing.controller.ts` | T1B |
| `src/controllers/marketing.actions.ts` | T1B |
| `src/lib/rate-limit-policy.ts` | T1B (los baldes de B) |
| `src/models/order.model.ts` | **T2B** |
| `src/models/schemas/order.schema.ts` | **T2B** |
| `src/controllers/checkout.controller.ts` | **T2B** |
| `src/app/api/orders/route.ts` | **T2B** |
| `src/services/notifications/email/**` | T3B |
| `src/emails/**` | T3B |
| `src/app/api/cron/campaigns/route.ts` | T3B |
| `src/views/admin/clientes/cupones/**` | T4B |
| `src/app/admin/(app)/clientes/cupones/**` | T4B |
| `src/views/storefront/checkout-form.tsx` | T5B |
| `src/views/storefront/order-tracking.tsx` | T5B |
| `src/views/storefront/use-priced-cart.ts` | T5B |
| `src/lib/cart.tsx` | T5B |
| `src/views/admin/pedidos/history-list.tsx` | T6B |
| `src/views/admin/kds/**` | T6B |
| `src/views/courier/**` | T6B |

**Los archivos calientes**, con un solo dueño en toda la vida del pipeline:
`order.model.ts` (T2B), `checkout-form.tsx` (**solo T5B** — el aviso de promos se
movió a la Entrega B por §5.12.3, así que A y B **no comparten un solo archivo**),
`cart.tsx` (T5B), `types.ts` / `lib/coupon.ts` / `lib/money.ts` (siempre el hilo
principal).

---

# ENTREGA A — Clientes

## T0A — Schema y contratos · **HILO PRINCIPAL, NO UN AGENTE**

**Lane:** `schema`. No se delega.

### T0A.1 — Migración `supabase/migrations/2026090____clientes.sql`

Contenido, según §5.3, §5.4, §5.12.1:

1. **Tabla `public.store_customers`** con las columnas de §5.3.1 exactas. PK
   `bigint identity`, `unique (store_id, phone_e164)`,
   `unsubscribe_token text not null unique default private.random_token(24)`.
   `comment on table` y en las columnas que no se explican solas.
2. **Los cuatro índices de §5.3.2**, incluido
   `orders_store_customer_phone_idx on public.orders (store_id, customer_phone_e164)`
   y el parcial de segmento (`where email is not null and marketing_opt_out_at is null`).
3. **Trigger `store_customers_set_updated_at`** con `private.set_updated_at()`.
4. **`private.sync_store_customer()`** — `AFTER INSERT OR UPDATE OF
   (payment_status, status, customer_name, customer_email, refunded_at) ON
   public.orders FOR EACH ROW`. **Recalcula el agregado completo** para
   `(store_id, phone)` leyendo `orders`, con `insert ... on conflict (store_id,
   phone_e164) do update`. Predicado de "plata gastada" **exactamente** el de §5.4:
   `order_is_billable(...) and status <> 'cancelled' and payment_status <>
   'refunded' and refunded_at is null`. `display_name` sale de
   `coalesce(o.customer_name, '')` — §6.4: **un error acá aborta la transacción del
   pedido**, así que nada que pueda tirar. `email` = el último no nulo, y **un
   pedido posterior sin mail NO lo borra**.
5. **RLS + grants de §5.11.2**: `enable row level security`,
   `revoke all from anon, authenticated`, `grant select, insert, update, delete to
   service_role`. **Cero policies.**
6. **RPC `public.store_customer_directory(p_store_id bigint)`** — `SECURITY
   DEFINER`, `set search_path = ''`, `is_store_owner(p_store_id)` **en el cuerpo**,
   devuelve `jsonb`. Deriva `avgTicketCents` y `daysSinceLastOrder`. `revoke
   execute from public, anon` + `grant to authenticated`. **El nombre NO es
   `store_customers`** (§5.11.4).
7. **`stores_slug_not_reserved_check`** += `'baja'`, con drop-por-introspección.
8. **Backfill** idempotente (§5.3.3) al final.

**Trampas obligatorias** (§7.3): `ADD CONSTRAINT IF NOT EXISTS` no existe → todo
constraint en un `do $$ ... if not exists (select 1 from pg_constraint ...)`.
Grant explícito a `service_role`. Verificar con `curl` + secret key antes de dar la
migración por buena.

### T0A.2 — Contratos en `src/models/types.ts`

Los tipos de §5.1 que corresponden a A: `StoreCustomer`, `CustomerDirectory`, y
`RateLimitBucket` += `'unsubscribe:ip'`. **Ningún slice de A edita este archivo.**

### T0A.3 — Regenerar `database.types.ts`

`npm run db:reset && npm run db:types`. El CI compara drift.

---

## T1A — Backend: el padrón, la baja y el rate limit

**Lane:** `backend`. Agente: `senior-backend-engineer`.

### Dueño exclusivo de
- `src/models/customer.model.ts` (nuevo)
- `src/models/schemas/customer.schema.ts` (nuevo)
- `src/controllers/customers.controller.ts` (nuevo)
- `src/controllers/customers.actions.ts` (nuevo)
- `src/controllers/unsubscribe.actions.ts` (nuevo)
- `src/models/schemas/platform.schema.ts` — **solo** agregar `'baja'` a `RESERVED_SLUGS`
- `src/lib/rate-limit-policy.ts` — **solo** la entrada `'unsubscribe:ip'`

### No toca
`types.ts`, `order.model.ts`, `admin.controller.ts`, `admin.actions.ts`, nada de
`src/views/**`, nada de `src/app/**`, `supabase/migrations/**`, `tests/**`.

### Qué construir

**`customer.model.ts`** — el único que habla con Postgres:
- `getCustomerDirectory(storeId: number): Promise<CustomerDirectory>` — llama la
  RPC `store_customer_directory` **con el cliente de SESIÓN** (`createClient()`),
  nunca con el admin. §5.11.4: la RPC verifica `is_store_owner()` leyendo
  `auth.uid()`, que con `service_role` no existe, **así que con el admin client
  falla siempre**. Es la misma trampa que `store_couriers`.
- `updateCustomerNotes(storeId, customerId, notes)` — admin client,
  `.eq('store_id', storeId)` **explícito**.
- `setCustomerOptOut(storeId, customerId, optedOut: boolean)` — idem.
- `findCustomerByUnsubscribeToken(token)` — admin client. Devuelve `null` si no
  existe. Valida el token con Zod antes de consultar (formato del alfabeto de
  `random_token`), mismo patrón que `orderTokenSchema`.
- `optOutByToken(token)` — admin client. **Idempotente**: darse de baja dos veces
  no cambia nada y no es un error.

**`customers.controller.ts`** (`import 'server-only'`) — resuelve sesión y
**exige `role === 'owner'`** antes de leer (§5.11.1). Existe porque hay algo que
orquestar: sesión + permiso + la lectura. Nada más.

**`customers.actions.ts`** (`'use server'` en la **primera línea**) — las dos
acciones del dueño (nota y baja manual), con `requireStoreMembership(id, { role:
'owner' })` y `revalidatePath('/admin/clientes')`. **Solo funciones async
exportadas.**

**`unsubscribe.actions.ts`** — la baja pública, **sin auth**. Consume
`unsubscribe:ip` fail-open. Lo único que autoriza es el token.

### Criterios de aceptación (spec del `test-engineer`)

**Solo con base real (`tests/db/`):**
1. Insertar un pedido → aparece una fila de `store_customers` con
   `orders_count = 0` si el pedido no es facturable, y con `1` si lo es.
2. Un pedido `in_store` que pasa a `delivered` y después a `payment_status =
   'refunded'` → **`total_spent_cents` vuelve a bajar**. Es el hueco de
   `order_is_billable` que §5.4 tapa.
3. Un pedido online `approved` que después pasa a `cancelled` → **no cuenta**.
4. Dos pedidos del mismo teléfono con **nombres distintos** → una sola fila,
   `display_name` = el del pedido facturable más reciente.
5. Un pedido con email y otro después **sin** email, mismo teléfono → `email` se
   **conserva**.
6. Dos teléfonos con el **mismo** email → **dos filas**.
7. El mismo teléfono en **dos tiendas** → dos filas, una por tienda, y cada una con
   su propio `unsubscribe_token`.
8. `store_customer_directory` llamada con el `store_id` de **otra** tienda → error
   `42501`. Llamada con `service_role` → **falla** (no hay `auth.uid()`).
9. `select` sobre `store_customers` con la publishable key de un `authenticated`
   → **cero filas o permission denied**. Ídem `anon`.
10. `unsubscribe_token` es único y sale de `private.random_token` (no de `random()`).
11. El backfill es idempotente: correrlo dos veces da el mismo resultado.
12. **Un error dentro del trigger aborta el insert del pedido** — probar que el
    camino feliz no lo dispara nunca con datos válidos.

**Sin base:** el schema del token rechaza basura antes de consultar; `optOutByToken`
es idempotente.

### Skills obligatorias
- `supabase-postgres-best-practices` — antes de escribir una sola query.
- `supabase` — RLS, RPC con cliente de sesión vs. admin.
- `vercel-react-best-practices` — Server Actions y data fetching.
- `context7` — antes de usar cualquier API de `supabase-js`.

---

## T2A — Frontend: `/admin/clientes` (el padrón)

**Lane:** `frontend`. Agente: `frontend-react-craftsman`.

### Dueño exclusivo de
- `src/app/admin/(app)/clientes/layout.tsx` y `page.tsx` (nuevos)
- `src/views/admin/clientes/**` (nuevo)
- `src/views/admin/shell.tsx` — **solo** el ítem nuevo de `NAV_ITEMS`

### No toca
`src/models/**`, `src/controllers/**`, `src/app/admin/(app)/pedidos/**`, ningún
otro archivo de `src/views/admin/`, `tests/**`.

### Qué construir

**Modo Operate.** Superficie de tarea, no de expresión.

1. **`layout.tsx`** — `PageFrame title="Clientes"` + una sub-nav de tabs, calcada
   de `src/views/admin/ajustes/settings-tabs.tsx`. **NO resuelve sesión**: el
   layout no autoriza (regla dura del repo).
2. **`page.tsx`** — `resolveAdminSession()`, `redirect('/admin/acceso')` si no está
   ok, y **`redirect('/admin')` si `role !== 'owner'`** (§5.11.1). Llama al
   controller y renderiza. `PageFrame width="table"`.
3. **La tabla** — las **seis** columnas de §5.5, ordenada por gastado desc, con
   `SearchField` (ya existe en `views/shared/surfaces.tsx`) filtrando en el cliente
   sobre las filas cargadas.
4. **La línea de tres números** arriba: *"142 clientes · 38 con email · 9 sin
   comprar hace más de 30 días"*. **Texto, no tarjetas.**
5. **La hoja de detalle** (`vaul`) al tocar una fila: primera compra, cancelados,
   la nota editable, y el toggle de baja.
6. **Contacto**: botón de WhatsApp y `mailto:`. Icon buttons de `lucide-react`,
   **44px mínimo**. Si `marketingOptOutAt` no es nulo: `StatusPill` "Sin promos", y
   **tanto el `mailto:` como el WhatsApp se atenúan** — la baja es del cliente, no
   del canal.
7. **El WhatsApp lleva MENSAJE PRECARGADO, y es la herramienta de reactivación**
   (§5.5.1). Decisión del dueño: no hay segmento de campaña para reactivar.
   - **Usar `whatsappHref(phoneE164, text?)` de `src/lib/whatsapp.ts:17`**, que ya
     acepta el texto y normaliza el E.164. **No armar la URL a mano.**
     (`store-dock.tsx` la arma a mano; su propio comentario dice que es deuda.
     **No es tu archivo y no es un ejemplo a seguir.**)
   - **Los tres mensajes de §5.5.1**, elegidos por lo que la fila ya sabe:
     reactivación si `daysSinceLastOrder >= 30`, cupón si el dueño elige uno, y el
     default. `{nombre}` es **solo el primer token** de `displayName`.
   - **Las cuatro reglas del copy son duras**: nunca la plata del cliente; nunca un
     hecho que no tenemos; suena a persona (rioplatense, sin "usted"); y arranca
     editable, porque el prefill cae en el campo de texto de WhatsApp y el dueño lo
     retoca antes de mandar.
   - **El menú de cupones no va en la Entrega A** (los cupones no existen todavía).
     En A van los dos mensajes sin cupón; el tercero lo agrega T4B.

### Piso de calidad — lo que hace fallar la revisión
- **Prohibido el kicker/eyebrow** arriba de cualquier título. Sin excepciones.
- Nada de plantilla de métrica-héroe, nada de grilla de tarjetas como estructura,
  **nada de `Panel` dentro de `Panel`**.
- Nada de emoji ni glifos unicode como ícono: `lucide-react` o SVG propio.
- Monoespaciada (`.tabular`) **solo** para plata, cantidades y fechas.
- Todos los estados: vacío (`EmptyState` que **enseña**: *"Acá van a aparecer los
  clientes cuando entren los primeros pedidos"*), búsqueda sin resultados, con
  contenido, y la hoja guardando / con error.
- **Mobile**: la tabla colapsa a filas apiladas (nombre + gastado arriba, el resto
  abajo). El 90% de los pedidos entra de un celular y el dueño mira desde el suyo.
- **CERO data fetching en las views.** Todo llega por props desde la page.

### Criterios de aceptación
1. La page **no importa `@supabase/*`** (regla dura, grepeable).
2. Ninguna view hace fetch.
3. Un `staff` que entra a `/admin/clientes` a mano **es redirigido**, y **no ve el
   ítem en la nav**.
4. Con `marketingOptOutAt` no nulo, **ni el `mailto:` ni el WhatsApp** son
   clickeables.
4-bis. El `href` de WhatsApp sale de `whatsappHref()`, con el texto ya
   URL-encodeado por el helper — **grepeable**: no debe haber una plantilla de
   `https://wa.me/` en el diff.
4-ter. Ningún mensaje precargado contiene la plata gastada del cliente.
5. Sin scroll horizontal del `<body>` en ningún breakpoint.
6. El rail sigue entrando sin scroll con nueve ítems en ≥lg.

### Skills obligatorias
- `impeccable` + **`.claude/skills/impeccable/reference/craft-floor.md`** +
  **`.claude/skills/impeccable/reference/operate.md`**.
- `web-design-guidelines` — antes de cerrar el slice.
- `vercel-react-best-practices` — Server vs. Client Components.
- **NO correr `context.mjs` ni `concept-seed.mjs`.** El mundo visual está decidido:
  se hereda de `src/app/layout.tsx` y de `.impeccable/surfaces/`. Un agente que
  rerruea el seed produce una segunda identidad.

---

## T3A — Frontend: la baja pública y los textos legales

**Lane:** `frontend`. Agente: `frontend-react-craftsman` (segundo, en paralelo con T2A).

### Dueño exclusivo de
- `src/app/baja/[token]/page.tsx` y su `route.ts` para el POST (nuevos)
- `src/views/unsubscribe/**` (nuevo)
- `src/app/legal/privacidad/page.tsx`
- `src/app/legal/terminos/page.tsx`

### No toca
`src/views/admin/**` (es de T2A), `src/models/**`, `src/controllers/**`, y
**`src/views/storefront/checkout-form.tsx`** — el aviso de promos **se movió a la
Entrega B** (T5B), por §5.12.3. **Este slice no toca la vitrina.**

### Qué construir

**`/baja/[token]`** (§5.12.2), de nivel raíz, sin auth:
- **`GET`** → página con el nombre del local y un botón "Darme de baja". **NO da de
  baja con un GET**: los escáneres de link de los clientes de mail hacen GET de
  todo, y una baja por prefetch es una baja que el cliente no pidió.
- **`POST`** (RFC 8058 one-click) → llama `unsubscribe.actions.ts` y devuelve
  **200 en blanco**, que es lo que el estándar exige.
- **Sin tema de marca**: es una página de la **plataforma**, igual que `/legal/*`.
- Token inválido → la misma página genérica que un token válido ya dado de baja. No
  se distingue: es un endpoint público que recibe tokens.

**`/legal/privacidad`** (§5.12.3) — sección nueva **"El padrón del local"**: qué
guarda (nombre, teléfono, mail si lo dejó, cuántos pedidos y cuánto gastó, la fecha
del último), que es **por local** y no se comparte entre locales, que se usa para
promos si dejó mail, y cómo darse de baja. **Y enmendar la sección "Los emails"**,
que hoy dice que el mail se usa solo para el comprobante y el aviso de listo.

**`/legal/terminos`** — sección nueva: un cupón es una oferta **del local**, con sus
condiciones, su vencimiento y su tope de usos; el local puede pausarlo; **la
plataforma no lo financia ni garantiza que esté disponible**.

**El aviso del checkout NO va en este slice.** Va en T5B, Entrega B. El motivo
(§5.12.3) hay que entenderlo para no "arreglarlo": un texto legal adelantado es a
lo sumo **prematuro**, pero un **aviso de consentimiento** adelantado es una
**afirmación falsa a un cliente** — en la Entrega A no existe forma de mandar una
promo.

**Y la retención hay que escribirla con honestidad** (§5.12.5.1): el padrón se
conserva *"mientras el local use la plataforma"*, sin plazos inventados. La sección
de derechos que ya existe se **mantiene** (es un canal manual por mail, y es
cierto), y **no se agrega nada que suene a autoservicio de borrado**: ese camino no
existe en el producto.

### Copy: lo que NO se puede escribir
- **Nada que insinúe métricas, casos de éxito o cantidad de usuarios.**
  `PRODUCT.md`: *"No existe ningún dato de uso, testimonio, métrica de conversión,
  caso de éxito ni benchmark. Nada de eso puede inventarse ni insinuarse."*
- Nada que prometa que la baja es instantánea en todos los canales: es inmediata
  para las campañas nuestras, y así se dice.
- Español rioplatense. Nada de "usted".

### Criterios de aceptación
1. `GET /baja/<token>` **no** cambia `marketing_opt_out_at`.
2. `POST /baja/<token>` lo setea y devuelve 200 con body vacío.
3. Un token inexistente devuelve la misma respuesta visible que uno válido.
4. La baja es idempotente.
5. `/legal/privacidad` describe el padrón y la baja; `/legal/terminos` describe el
   cupón como oferta del local.
6. **`checkout-form.tsx` no aparece en el diff de este slice.**
7. `/legal/privacidad` **no promete un borrado autoservicio** y no inventa plazos de
   retención.
8. La página de baja no inyecta CSS de marca.

### Skills obligatorias
- `impeccable` + `reference/craft-floor.md`.
- `web-design-guidelines`.
- `vercel-react-best-practices`.

---

# ENTREGA B — Cupones y campañas

> **No arranca hasta que A esté integrada y verificada.** El segmento de campaña
> lee el padrón.

## T0B — Schema y contratos · **HILO PRINCIPAL, NO UN AGENTE**

**Lane:** `schema`. No se delega.

### T0B.1 — Migración `supabase/migrations/2026090____cupones.sql`

Según §5.7, §5.8, §5.11:

1. **`public.coupons`** con las columnas y **los cinco CHECK** de §5.7.1. Ojo:
   **dos contadores**, `reserved_count` y `redeemed_count`, y
   **`coupons_within_cap_check` sobre la SUMA**:
   `reserved_count + redeemed_count <= max_redemptions`. Más
   `coupons_shape_check`, `coupons_payment_methods_check` (no vacío, `<@` el enum
   cerrado), `coupons_window_check`, `coupons_code_check`.
   `unique (store_id, code)` **y `unique (store_id, id)`** (la segunda es para la
   FK compuesta).
2. **`public.coupon_redemptions`** de §5.7.2 — **el libro mayor de TRES estados**
   (`reserved | redeemed | released`), con `released_reason`, `redeemed_at`,
   `released_at`, `unique (order_id)`, la **FK compuesta
   `(store_id, coupon_id) → coupons(store_id, id) on delete restrict`**,
   `customer_phone_e164` denormalizado, y los índices — **dos de ellos parciales**
   `where status in ('reserved','redeemed')`, porque una reserva liberada no ocupa
   cupo ni consume la cuota de esa persona.

2-bis. **Los tres triggers del modelo de reserva** (§5.7.2.1 a §5.7.2.3), y son la
   parte más delicada de esta migración:

   - **`private.enforce_coupon_redemption()`** — `BEFORE INSERT ON
     coupon_redemptions FOR EACH ROW`. Toma **él mismo** el lock
     (`perform 1 from public.coupons where id = new.coupon_id for update`) y valida
     `status='active'`, ventana, y el tope. ⚠️ **La comparación del tope es
     ESTRICTAMENTE MENOR** (`reserved + redeemed < max_redemptions`), porque los
     contadores todavía no incluyen la fila que se está insertando. Con `<=` el
     cupón admite `max + 1` reservas y el CHECK las rechaza con un error crudo. **Es
     el bug más fácil de escribir de todo el feature.**
   - **`private.sync_coupon_counters()`** — `AFTER INSERT OR UPDATE OF status OR
     DELETE ON coupon_redemptions FOR EACH ROW`. **Recalcula los dos contadores
     desde el libro mayor**, nunca los incrementa. Mismo criterio y mismo comentario
     que `sync_store_transfer_payment`.
   - **`private.sync_coupon_reservation()`** — `AFTER UPDATE OF status ON orders FOR
     EACH ROW`. `delivered` → `redeemed`; `cancelled` **con `paid_at IS NULL`** →
     `released`. **NO va adentro de `enforce_order_rules`**: ése es un BEFORE que
     valida, éste un AFTER que proyecta, y mezclarlos haría que un fallo de
     escritura del libro mayor aborte una transición legítima. ⚠️ Un error acá
     **aborta la transición del pedido**: nada externo en el cuerpo.

   **`expire_pending_orders` NO se toca.** Verificado: hace
   `set status = 'cancelled'`, así que el predicado
   `cancelled AND paid_at IS NULL` cubre el barrido de abandonados y la cancelación
   manual con **una** condición.
3. **`public.coupon_campaigns`** y **`public.campaign_recipients`** de §5.7.3,
   incluidos `chunk_index`, `stopped_reason` con su enum cerrado,
   `unique (campaign_id, email)` y el índice parcial `where status = 'queued'`.
4. **`orders`** += `discount_cents bigint not null default 0` y
   `coupon_code_snapshot text`. **Ningún grant nuevo**: `orders` ya tiene
   `revoke update from authenticated` + `grant update (status)`.
5. **El swap del CHECK del total** (§5.8.2). **Se dropea por INTROSPECCIÓN**
   (`pg_get_constraintdef(oid) like '%subtotal%delivery%'`), **no por nombre**
   (§7.3.4). Se agregan los **dos**:
   `total_cents = subtotal_cents - discount_cents + delivery_fee_cents` y
   `discount_cents <= subtotal_cents`. **Entra sin backfill**: toda fila tiene
   `discount_cents = 0`.
6. **`private.enforce_order_rules` — redefinición COMPLETA.** `create or replace`
   reemplaza el cuerpo entero: hay que **re-declarar** inmutables, transiciones,
   "online impago no confirma", las guardas de `on_the_way` y la validación del
   repartidor, **más** `discount_cents` y `coupon_code_snapshot` en la lista de
   inmutables.
7. **`public.create_order` — redefinición COMPLETA** con el bloque de cupón de
   §5.9.2, **después del `return` temprano de idempotencia**. `for update` sobre la
   fila del cupón (redundante con el trigger a propósito: es lo que convierte al
   perdedor de la carrera en un `DomainError` legible en vez de un `23514` crudo).
   **Inserta una fila `status = 'reserved'` en `coupon_redemptions` y NO toca los
   contadores**: los mantiene el trigger. Aritmética entera:
   `floor(subtotal * percent / 100)`, tope, y clamp a `subtotal`. **`coalesce((p_order ->> 'discount_cents')::bigint, 0)` — es
   lo que permite un solo deploy (§7.2) y sin eso todo pedido en la ventana de
   deploy falla.** Marcador de error estable por cada rechazo, para que la capa de
   modelos lo traduzca a `DomainError`.
8. (ya cubierto en 2-bis: los tres triggers del modelo de reserva.)
9. **`public.store_dashboard` — redefinición completa** + `discountCents`.
10. **`public.courier_queue` — redefinición completa** + la clave `discountCents`.
11. **Verificar `public.store_couriers`** (§7.3.8). Sus métricas salen de
    `total_cents`, que ya es correcto — **mirarlo, no asumirlo.**
12. **`store_pending_changes`** (§5.11.3): CHECK de `kind` += `'coupon'` **con
    drop-por-introspección**; columna `subject_id bigint` nullable; y
    **`store_pending_changes_live_idx` SE DROPEA Y SE RECREA** como
    `(store_id, kind, subject_id) where consumed_at is null`. §7.3.9: un
    `create index if not exists` con el mismo nombre y otra definición **no hace
    nada y no avisa**.
13. **RLS + grants de §5.11.2** para las cuatro tablas nuevas: `revoke all from
    anon, authenticated`, `grant ... to service_role`, **cero policies**.
14. **RPCs**: `campaign_segment_preview`, `enqueue_campaign`,
    `claim_campaign_recipients`, `settle_campaign_recipient`, `coupon_detail`
    (§5.11.4). Cada una con su `revoke execute from public, anon` + grant
    explícito, y las de `authenticated` con `is_store_owner()` **en el cuerpo**.
15. **`cleanup_old_records` — redefinición completa con LOS CINCO borrados**
    (§5.12.5). Los cuatro que ya tiene **no son opcionales**.
16. **`stores_slug_not_reserved_check`** += `'promos'`, `'ventas'`, `'sales'`.
17. **`cron.schedule('app-campaigns', '*/5 * * * *', ...)`** con
    `private.invoke_app_cron('/api/cron/campaigns')`. **pg_cron, no `vercel.json`**:
    en Hobby una entrada más frecuente que diaria **hace fallar el deploy**.

### T0B.2 — Contratos en `src/models/types.ts`
Todo §5.1: `Coupon`, `CouponState`, `CouponAppliedQuote`, `CampaignSegment`,
`CampaignPreview` (con `daysNeeded`, `lastSendDate`, `fitsBeforeExpiry`),
`CouponCampaign`, `CampaignStatus` (con `'stopped'`), `CouponChangeKind`,
`CouponRedemptionRow`, `CouponStats`, `CouponDetail`.
**Y los tres tipos que cambian de forma**: `Order` += 2 campos, `OrderPublicView`
+= 2 claves del `Pick`, `PricedCart`/`PriceQuote` += el descuento.
`RateLimitBucket` += los seis baldes de B.

### T0B.3 — `src/lib/coupon.ts` y `src/lib/money.ts`
Los escribe el **hilo principal** porque son el contrato que T1B, T2B, T4B y T5B
consumen a la vez, y ninguno puede ser dueño de un archivo que los otros tres
importan.
- `money.ts` += **`percentOfCentsDown(cents, percent)`**. `Math.floor`, no `ceil`.
  **`scaleUpInt()` NO sirve**: redondea para arriba, que está bien para un ETA y
  mal para un descuento.
- `coupon.ts` — módulo **PURO, sin `server-only`** (igual que `delivery.ts`, y por
  el mismo motivo): `couponState()`, `describeDiscount()`, `worstCaseCents()`,
  **`requiresConfirmation(current, next)`** (§5.11.3 — ojo: los `null` van del lado
  que **escala**), `campaignDaysNeeded()`, `CAMPAIGN_DAILY_BUDGET = 15`.

### T0B.4 — Regenerar tipos
`npm run db:reset && npm run db:types`.

---

## T1B — Backend: cupones, campañas y el segundo factor

**Lane:** `backend`. Agente: `senior-backend-engineer`.

### Dueño exclusivo de
- `src/models/coupon.model.ts`, `src/models/campaign.model.ts` (nuevos)
- `src/models/schemas/coupon.schema.ts` (nuevo)
- `src/controllers/marketing.controller.ts`, `marketing.actions.ts` (nuevos)
- `src/lib/rate-limit-policy.ts` — los seis baldes de B

### No toca
**`order.model.ts` ni `order.schema.ts` ni `checkout.controller.ts` ni
`api/orders/route.ts` — todos de T2B.** Tampoco `types.ts`, `lib/coupon.ts`,
`lib/money.ts` (T0B), ni `src/views/**`, ni `src/emails/**` (T3B).

### Qué construir

**`coupon.model.ts`** — admin client + `.eq('store_id', storeId)` **explícito** en
toda escritura:
- `listCoupons(storeId)`, `getCouponDetail(storeId, couponId)` (vía RPC
  `coupon_detail`, por el corte de `max_rows`). Los tres agregados cuentan **solo
  `redeemed`** (§5.14.5); los últimos 20 canjes vienen **con su `status`**, para que
  la lista marque los liberados.
- `createCouponDraft(storeId, input)` → nace **`status = 'draft'`**.
- `updateCoupon(storeId, couponId, input)`.
- `setCouponStatus(storeId, couponId, status)`.
- `deleteUnusedCoupon(storeId, couponId)` — condicionado a que el cupón **no tenga
  NINGUNA fila en el libro mayor**, `released` incluidas (§5.14.6): los liberados
  cuentan para prohibir el borrado, porque son el rastro de que el cupón estuvo en la
  calle. Si el `RESTRICT` la rechaza, traducir a
  `DomainError('Este cupón ya se usó: se puede pausar, no borrar.')`.
- `validateCouponForCart(...)` — la validación de **cotización** (§5.9.1), que
  devuelve `CouponAppliedQuote` y **nunca tira**: un cupón inválido no puede dejar
  el carrito sin precio.
- **Generador de código**: 8 caracteres, alfabeto sin confundibles, **CSPRNG**
  (`node:crypto`), **nunca `Math.random()`** (§5.7.1).

**`campaign.model.ts`**:
- `previewSegment(storeId, segment, couponId)` → `CampaignPreview` con los cuatro
  conteos **y** `daysNeeded` / `lastSendDate` / `fitsBeforeExpiry` (§5.10.3.1).
- `enqueueCampaign(...)` — vía RPC. Congela destinatarios y asigna `chunk_index` de
  **15**. Valida cada dirección con `z.email()` **al encolar**; las inválidas nacen
  `skipped`.
- `claimCampaignRecipients(budget)` / `settleCampaignRecipient(...)` — `service_role`.
- `listCampaigns(storeId)`.

**`marketing.actions.ts`** (`'use server'`, primera línea, **solo async**):
- `createCouponDraftAction`, `updateCouponAction`, `setCouponStatusAction`,
  `deleteCouponAction`, `requestCouponActivationAction`,
  `confirmCouponChangeAction`, `previewCampaignAction`, `sendCampaignAction`,
  `requestCampaignQuotaAction`.
- **Todas** con `requireStoreMembership(storeId, { role: 'owner' })`.
- **El segundo factor** (§5.11.3): reusar `store_pending_changes` y
  `startPendingChange` / `claim_store_pending_change` tal cual, con
  `kind: 'coupon'` y **`subject_id = couponId`**. La query de invalidación del
  pendiente anterior va scopeada por `subject_id` — **`.is('subject_id', null)`
  para los kinds viejos, nunca `.eq(null)`**.
- `requiresConfirmation()` de `lib/coupon.ts` decide si el cambio pide código. **La
  Server Action es la autoridad**; que la UI lo muestre antes es una cortesía.
- **`sendCampaignAction` RECHAZA** si `!fitsBeforeExpiry`, con el `DomainError` de
  §5.10.3.1 que nombra las **tres** salidas.
- `humanizeRetryAfter()` se **duplica** en este archivo: un `.actions.ts` solo
  puede exportar funciones async. Ya está triplicado en el repo por lo mismo.

**Baldes** en `rate-limit-policy.ts`, con los números y el `onError` de §5.13:
`coupon_create:store` 20/1h open · `coupon_change:store` 10/1h **deny** ·
`coupon_change:store:day` 20/24h **deny** · `campaign_send:store` 3/24h **deny** ·
`campaign_quota:store` 1/2min open · `campaign_quota:store:day` 5/24h open.
Comentario explicando **por qué** los de código van fail-closed: Auth y Resend son
servicios aparte y siguen mandando mail con nuestra base caída.

### Criterios de aceptación (spec del `test-engineer`)

**Solo con base real (`tests/db/`):**
1. **La carrera del último uso.** N requests en paralelo con
   `max_redemptions = 1` → **una** reserva, `reserved_count = 1`, y los demás con
   "Ese cupón ya se agotó". Es el caso HackerOne #1717650 de §3.2.
2. **`coupons_within_cap_check` no se puede violar ni con `service_role`**: un
   `update` directo a `reserved_count = max_redemptions + 1` → `23514`.
2-bis. **El off-by-one del trigger** (§5.7.2.2): con `max_redemptions = 1` y una
   reserva viva, un segundo insert **falla**; con `max_redemptions = 2`, entra. Es
   el caso que distingue `<` de `<=` y **tiene que existir**.
2-ter. **El ciclo completo**: reservar → `(1, 0)`; pedido a `delivered` → `(0, 1)`;
   otro pedido cancelado sin pagar → su fila queda `released` y `reserved_count`
   baja. **Los contadores siempre igualan el `count(*)` del libro mayor.**
2-quater. **`refunded` NO libera**, y **cancelar después de pagado tampoco**
   (§5.7.2.3). Un pedido pagado que nunca llega a `delivered` **queda `reserved` y
   ocupa cupo**, que es lo correcto.
2-quinquies. **Liberar libera cupo de verdad**: con `max_redemptions = 1`, un pedido
   abandonado y cancelado permite que **otro** cliente use el cupón.
2-sexies. **`redeemed_count` es monótono**: ningún camino lo baja.
2-septies. **`expire_pending_orders` libera sin haber sido modificada**: correrla
   sobre un pedido con cupón abandonado deja la fila en `released` con
   `released_reason = 'expired'`.
3. **Idempotencia:** el mismo `idempotencyKey` dos veces con el mismo cupón → **un**
   pedido y **un** canje. El bloque del cupón está después del `return` temprano.
4. `unique (order_id)` en `coupon_redemptions`: un segundo canje del mismo pedido →
   `23505`.
5. **Un cupón de otra tienda no se canjea**: la FK compuesta lo rechaza.
6. **Un `draft` no canjea nunca**: `enforce_coupon_redemption` levanta, para
   `service_role` incluido. Ídem `paused`, vencido y agotado.
7. Un cupón con **cualquier** fila en el libro mayor (una `released` incluida) **no
   se puede borrar** → `23503`.
8. El tope por teléfono cuenta contra `customer_phone_e164` **solo sobre `reserved`
   y `redeemed`** (el índice es parcial): una reserva liberada **no** consumió la
   cuota de esa persona, así que puede volver a intentar.
9. `payment_methods = '{}'` → rechazado por el CHECK. `payment_methods` con un
   valor fuera del enum → rechazado.
10. Un cupón restringido a `online` usado con `payment_method = 'in_store'` →
    rechazado dentro de `create_order`.
11. Las cuatro tablas nuevas: `select` con la publishable key → denegado, para
    `anon` y `authenticated`.
12. `coupon_detail` / `campaign_segment_preview` con otro `store_id` → `42501`; con
    `service_role` → fallan (no hay `auth.uid()`).
13. `claim_campaign_recipients` con dos llamadas concurrentes → **ningún
    destinatario reclamado dos veces** (`for update skip locked`).
14. El presupuesto: con 15 ya mandados hoy, la siguiente llamada devuelve cero.
15. `claim_store_pending_change` con `kind = 'coupon'` funciona **sin haber tocado
    la función**; a los 5 intentos devuelve cero filas.
16. Activar el cupón A y después el B **no invalida el código de A** (es el bug que
    `subject_id` arregla).

**Sin base:**
17. `percentOfCentsDown(12400, 15) === 1860`. Nunca float, nunca `ceil`.
18. El clamp: un cupón fijo mayor que el subtotal deja `discount = subtotal`.
19. **Paridad de la aritmética TS ↔ SQL** sobre una tabla de casos borde.
20. `requiresConfirmation`: **poner un `null` donde había un límite cuenta como
    escalar**. Un caso por cada campo de la lista de §5.11.3.
21. `campaignDaysNeeded(142, 15) === 10`.

### Skills obligatorias
- `supabase-postgres-best-practices` — **antes** de la primera query.
- `supabase` — RPC, RLS, cliente de sesión vs. admin.
- `vercel-react-best-practices`.
- `context7` — `supabase-js` y Zod v4 (`z.email()`, no `z.string().email()`; los
  errores son `error.issues`).

---

## T2B — Backend: el descuento en el camino del pedido

**Lane:** `backend`. Agente: `senior-backend-engineer` (segundo). **Es el slice más
delicado de las dos entregas.**

### Dueño exclusivo de
- `src/models/order.model.ts`
- `src/models/schemas/order.schema.ts`
- `src/controllers/checkout.controller.ts`
- `src/app/api/orders/route.ts`
- `src/services/payments/mercadopago.adapter.ts`

### No toca
`coupon.model.ts` ni `campaign.model.ts` (T1B — **los importa, no los edita**),
`types.ts`, `lib/coupon.ts`, `lib/money.ts`, nada de `src/views/**`.

### Qué construir

1. **`order.schema.ts`** — `createOrderSchema` += `couponCode` opcional,
   normalizado a mayúsculas, **`.strict()` intacto**.
2. **`order.model.ts` — los cuatro puntos de §5.14.3, y ninguno es opcional:**
   - `toOrder()` mapea `discountCents` y `couponCodeSnapshot`. **Si falta, el dato
     existe en la fila y nunca llega a la vista, sin ningún error.**
   - `toOrderPublicView()` idem.
   - `priceCart` / el quote devuelven el término del descuento.
   - `createOrder` pasa `coupon_code` y `discount_cents` a la RPC, y traduce **cada
     marcador de rechazo** del cupón a su `DomainError` con el texto **exacto** de
     §5.9.4. Nunca llega el mensaje crudo de Postgres al browser.
   - **Los mínimos, según §5.9.3.1**: mínimo del pedido y mínimo de envío sobre el
     subtotal **SIN** descuento; envío gratis **CON** descuento.
3. **`checkout.controller.ts`** — `priceCartForStore` recibe `couponCode` y
   `paymentMethod` y devuelve `coupon` en el `PriceQuote`. `sendReceiptEmail` pasa
   `discountCents` y `couponCode`. Y **`createCheckoutForOrder`**: si
   `discountCents > 0`, **un solo item** con `totalCents` (§5.8.4); si es 0, **no
   cambia nada**.
4. **`mercadopago.adapter.ts`** — la cota defensiva pasa de
   `totalCents < itemsTotal` a **`totalCents !== itemsTotal`**.
5. **`api/orders/route.ts`** — el balde `coupon_check:ip` **solo cuando el código NO
   EXISTE** (§5.13), no en cada cotización con cupón. Motivo verificado: la
   cotización **no tiene debounce** (`use-priced-cart.ts:99-178` dispara con cada
   cambio de `lines` y solo cancela con `AbortController`), así que cobrar cada
   intento **rate-limitearía al cliente de su propio checkout** a los 30 toques del
   `+`. Un cupón real —incluso vencido o pausado— no consume nada; la enumeración
   *es* preguntar por códigos que no existen.

### Criterios de aceptación
1. **El cliente manda el código, nunca el monto.** Un body con `discountCents` →
   **400 que nombra la clave** (`.strict()`).
2. Un cupón inválido en la cotización → **la cotización responde igual**, con
   `discountCents = 0` y `coupon.status = 'rejected'`.
3. El total del pedido creado satisface
   `total = subtotal − discount + delivery_fee`; si no, `23514`.
4. Un cupón fijo mayor que el subtotal → `discount = subtotal`, **nunca** un total
   negativo ni menor que el envío.
5. Los mínimos: un carrito de $10.000 con cupón de $3.000 y mínimo de envío de
   $9.000 **puede** pedir envío; con envío gratis desde $8.000, **no** lo consigue.
6. Con descuento, la preferencia de MP lleva **un** item cuyo precio es
   `totalCents`. Sin descuento, el detalle por línea de siempre.
7. `toOrder` y `toOrderPublicView` devuelven las dos claves nuevas — **grepeable**.
8. `coupon_check:ip` **no** se consume en una cotización sin cupón, **ni con un
   cupón que existe** (aunque esté vencido, pausado o no aplique). Solo con un
   código inexistente. **Es el criterio que evita rate-limitear a un cliente que
   está comprando.**
9. Ningún mensaje de constraint de Postgres llega al browser.

### Skills obligatorias
`supabase-postgres-best-practices`, `supabase`, `vercel-react-best-practices`,
`context7` (Mercado Pago `mercadopago` 3.4 y Zod v4).

---

## T3B — Backend: el mail de campaña, el cron y la vía comercial

**Lane:** `backend`. Agente: `senior-backend-engineer` (tercero).

### Dueño exclusivo de
- `src/emails/store-coupon-campaign.tsx` (nueva, la novena)
- `src/emails/store-campaign-quota-request.tsx` (nueva, la décima)
- `src/emails/order-receipt.tsx` — **solo** la línea de descuento
- `src/services/notifications/email/**` (`email.port.ts`, `campaign.tsx` nuevo,
  `payment-change.tsx` para `CHANGE_LABELS`)
- `src/app/api/cron/campaigns/route.ts` (nuevo)
- `src/lib/env.server.ts` — las dos variables nuevas

### No toca
`src/models/**`, `src/controllers/**`, `src/views/**`, `src/emails/*` que no sean
los tres nombrados.

### Qué construir

1. **`email.port.ts`** — `EmailVars` += `discountCents` y `couponCode`.
2. **`order-receipt.tsx`** — la línea de descuento en el desglose que ya existe,
   **solo si `discountCents > 0`**. §5.14.4: *sin esto el cliente recibe un mail
   donde los números no suman.*
3. **`payment-change.tsx`** — `CHANGE_LABELS` += `coupon: 'un cupón de descuento'`.
   **Cero plantillas nuevas de código**: el mecanismo ya está parametrizado por
   `kind`, y así hereda gratis que **tira en vez de degradar**.
   ⚠️ **Revisar el copy** de `store-payment-change-code` y `-notice`: si está
   escrito para pagos ("los cobros", "tu cuenta"), **generalizarlo**, no forkear la
   plantilla (§5.11.3).
4. **`campaign.tsx`** — el envío por `/emails/batch`:
   - Chunk de **15** (§5.10.3), no de 100.
   - **Clave de idempotencia
     `campaign/{campaignId}/{chunkIndex}/{sha256(ids ordenados).slice(0,16)}`.** El
     sufijo de contenido no es opcional: sin él, una baja entre dos ticks cambia el
     payload con la misma clave y **ese chunk devuelve 409 para siempre**.
   - Los headers `List-Unsubscribe` y `List-Unsubscribe-Post`, **por destinatario,
     con su token**. Resend **no** los inyecta en `/emails`.
   - Remitente: `RESEND_CAMPAIGN_FROM_EMAIL`, con **fallback a
     `RESEND_FROM_EMAIL` + `log.warn`** (§5.10.5). Degrada, no tira.
   - Sin key → `skipped`, nunca tira.
   - **Nunca** `add-suppression` de Resend: la lista es de cuenta y **también aplica
     a `/emails`**, así que suprimir a alguien lo dejaría sin comprobante de su
     pedido, en silencio (§3.4, §6.3).
5. **`/api/cron/campaigns`** — `GET`, `CRON_SECRET` en **tiempo constante**, igual
   que los otros cuatro. Reclama con presupuesto, verifica el estado del cupón
   **antes de cada chunk**, y **corta la campaña** a `stopped` con su
   `stopped_reason` (§5.10.3.1). 3 intentos → `failed`.
6. **La vía comercial** — `store-campaign-quota-request.tsx` con los seis datos de
   §5.10.6, a `SALES_EMAIL`. Degrada, no tira.
7. **`env.server.ts`** — `RESEND_CAMPAIGN_FROM_EMAIL` y `SALES_EMAIL`, **las dos
   opcionales**.

### Criterios de aceptación
1. **Ninguna fila en `notifications`** por una campaña: esa tabla exige `order_id`.
2. La clave de idempotencia cambia cuando cambia la membresía del chunk, y **no**
   cambia en un reintento con la misma membresía.
3. Cada mail lleva `List-Unsubscribe` con **su** token.
4. Sin `RESEND_CAMPAIGN_FROM_EMAIL` → sale del remitente de siempre **y loguea**.
5. Sin `RESEND_API_KEY` → la campaña queda `failed`, **ningún pedido se rompe**. En
   cambio el código de 6 dígitos **tira**.
6. El cron es idempotente: dos ticks solapados no mandan a nadie dos veces.
7. El presupuesto no se pasa de 15/día (ventana **UTC**, no la del local).
8. Un cupón vencido a mitad de drenaje → campaña `stopped`, resto `skipped`,
   **ningún mail con un código muerto**.
9. `order-receipt` con descuento: subtotal − descuento + envío = total.
10. Ningún body de respuesta de Resend en los logs.

### Skills obligatorias
- `context7` — **obligatorio** para Resend (batch, idempotencia, headers) y
  `@react-email/components` v1.
- `supabase` — las RPC del claim.
- `vercel-react-best-practices`.

---

## T4B — Frontend: la tab de Cupones

**Lane:** `frontend`. Agente: `frontend-react-craftsman`.

### Dueño exclusivo de
- `src/app/admin/(app)/clientes/cupones/page.tsx` (nuevo)
- `src/views/admin/clientes/cupones/**` (nuevo)

### No toca
`src/views/admin/clientes/*` de nivel superior (T2A), `shell.tsx` (T2A),
`src/models/**`, `src/controllers/**`, ningún otro `src/views/**`.

### Qué construir

Modo **Operate**. `resolveAdminSession()` + **`role === 'owner'`** en la page.
Dos secciones apiladas con `PanelHeading`, **no tabs anidadas** (misma decisión y
mismo motivo que el brief de la bandeja de programados).

1. **Cupones** — lista: código, nombre, el descuento en palabras
   (`describeDiscount()`), `StatusPill` con `couponState()` derivado, vigencia, y
   **la columna "Usos" con el CUPO OCUPADO** = `reserved + redeemed` sobre
   `max_redemptions` (*"7 / 50"*). Es el número que decide si al próximo cliente le
   va a andar el cupón, que es la pregunta operativa (§5.7.2.4). `StatusPill` de aviso si está restringido a un medio que
   el local **hoy no cobra** (§5.9.4). Acciones: pausar/activar, duplicar, borrar
   (solo con 0 canjes), **"Mandar por mail"**.
2. **Campañas** — el log, solo lectura: cupón, segmento en palabras, cuándo,
   resultado. `stopped` se muestra **distinto de `failed`**, con el motivo
   traducido a una frase.
3. **La hoja del cupón** (`vaul`) con los campos y el orden de §5.6, el botón
   **"Generar"** del código, y **el peor caso en pesos calculado en vivo**
   (`worstCaseCents()`) arriba del botón de guardar.
4. **Los dos tiempos** (§5.6): "Guardar borrador" (gratis, ilimitado) y "Activar"
   (pide el código). Al pie, el aviso que se actualiza mientras el dueño tipea:
   *"Este cambio se aplica al instante"* / *"Este cambio pide un código por mail"*,
   desde `requiresConfirmation()`. **"Pausar" nunca lo pide.**
5. **El paso del código** — reusar el diálogo de confirmación que ya existe en
   `/admin/pagos` si es reusable **sin editarlo**; si hay que tocarlo, **reportar y
   parar** (no es tu archivo).
6. **Los métodos de pago** — tres checkboxes, los que el local no puede cobrar
   **deshabilitados con el motivo inline y link a `/admin/pagos`**. Etiquetas
   exactas de §5.9.4: "Mercado Pago" · "Transferencia" · **"Pago al recibir"**.
   **Nunca "efectivo"**: el dominio no sabe con qué se paga.
7. **La hoja de detalle del cupón** (§5.7.2.4 y §5.14.5):
   - **El desglose de la reserva**, en una línea:
     *"12 canjes · 2 reservados · quedan 36 de 50"*. **"Reservados" con un helper al
     lado** — *"pedidos con el cupón que todavía no se entregaron"* —, porque el
     dueño va a comparar ese número con los pedidos que contó y tiene que entender
     la diferencia.
   - **Los tres agregados** en otra línea de texto
     (*"43 canjes · $64.000 descontados · $312.000 facturados"*). **Cuentan solo
     `redeemed`**: "facturación generada" sobre un pedido que todavía puede morir es
     un número falso.
   - **Los últimos 20 canjes** con link al pedido y el total real al lado
     (*"7 de 43"*). **Los `released` se muestran con un `StatusPill` y su motivo** —
     son diagnóstico, van en la fila y **no** en el titular.
   - **Nada de tarjetas de métrica ni de la plantilla de métrica-héroe.** Texto.
8. **La hoja de campaña** — segmento, asunto, mensaje, y el **preview con la cuenta
   completa de §5.6**, incluidos días y fecha del último mail contra el vencimiento
   del cupón. La oferta comercial aparece **solo cuando `daysNeeded > 1`**.

### Piso de calidad
Los mismos no-negociables de T2A: **prohibido el kicker**, nada de métrica-héroe,
nada de `Panel` en `Panel`, nada de emoji como ícono, 44px, `.tabular` solo para
medición, todos los estados, mobile-first, cero fetching en views.

### Criterios de aceptación
0. **El tercer mensaje de WhatsApp del padrón** (§5.5.1): el botón de contacto de
   `/admin/clientes` gana un menú con los cupones `active` del local, y el elegido
   entra en el texto precargado. ⚠️ **La fila del padrón es de T2A.** Este slice
   aporta **solo** el componente del menú de cupones, en `views/admin/clientes/cupones/`,
   y T2A lo monta. Si hace falta editar un archivo de T2A: **parar y reportar.**
   Es el único camino por el que un cupón llega a un cliente **sin gastar cupo de
   mail**, y a 15/día es el que más se va a usar.
1. Un `staff` no llega a la page ni ve la tab.
2. El peor caso se recalcula al tipear y dice *"sin tope"* cuando falta
   `maxDiscountCents` en un porcentaje.
3. Un método que el local no cobra está **deshabilitado**, no oculto, con motivo.
4. Un cupón con **cualquier** fila en el libro mayor (una `released` incluida) **no
   ofrece borrar**.
4-bis. La columna "Usos" muestra `reserved + redeemed`, no solo los canjes; y la
   hoja explica la diferencia.
5. El aviso de "pide código" aparece **antes** de guardar, no después.
6. `stopped` y `failed` se ven distinto.
7. El preview de campaña muestra días y última fecha; cuando no entra antes del
   vencimiento, el error nombra las **tres** salidas.
8. Sin scroll horizontal del `<body>` en ningún breakpoint.

### Skills obligatorias
`impeccable` + `reference/craft-floor.md` + **`reference/operate.md`**;
`web-design-guidelines`; `vercel-react-best-practices`. **No correr `context.mjs`
ni `concept-seed.mjs`.**

---

## T5B — Frontend: el cupón en el checkout y en el seguimiento

**Lane:** `frontend`. Agente: `frontend-react-craftsman` (segundo).

### Dueño exclusivo de
- `src/views/storefront/checkout-form.tsx`
- `src/views/storefront/order-tracking.tsx`
- `src/views/storefront/use-priced-cart.ts`
- **`src/lib/cart.tsx`**

### No toca
`src/views/admin/**` (T4B, T6B), `src/models/**`, `src/controllers/**`,
`src/app/api/**`.

> **Ya no hay conflicto con la Entrega A.** El aviso de promos se movió de T3A a
> este slice (§5.12.3), así que **`checkout-form.tsx` tiene un solo dueño en todo el
> pipeline** y A y B no comparten ningún archivo.

### Qué construir

1. **El campo de cupón** en el checkout: input + "Aplicar". El código viaja en la
   misma cotización que ya se re-dispara con cada cambio de carrito **y de método**.
2. **La línea del resumen**, solo si hay descuento, entre subtotal y envío, con el
   código como etiqueta y el signo menos. `.tabular`.
3. **Cuando el cupón pasa a `rejected`** (§5.9.4, punto 3): la línea **queda
   visible, tachada, con el motivo al lado**. **Nunca desaparece en silencio.** Un
   total que sube sin explicación es lo peor que puede pasar en un checkout.
4. **El total siempre sale del servidor.** La vista **nunca** resta un descuento
   que calculó ella.
5. **`order-tracking.tsx`** — la misma línea en el resumen, desde
   `OrderPublicView`.
6. **`use-priced-cart.ts`** — el `couponCode` viaja en el quote. **Sin agregar
   debounce**: el `AbortController` que ya está es el mecanismo, y el balde de
   `coupon_check:ip` se cobra solo en el fallo justamente para no necesitarlo.

7. **`cart.tsx` — el envelope sube a `v: 2` y la `idempotencyKey` se descarta**
   (§5.9.1). Es el punto más fácil de olvidar del feature y el modo de falla es
   silencioso:

   > El cliente confirma sin cupón → el pedido se crea → **la respuesta se pierde**
   > (mala señal, el caso normal de este producto) → aplica el cupón y reconfirma →
   > el `return` temprano de idempotencia le devuelve **el pedido sin descuento**,
   > con un 200 y sin un solo error. Pagó de más y nadie se enteró.

   - `discardIdempotencyKey()` en **aplicar, cambiar y quitar** el cupón. Es la
     misma regla que ya está en `addLine` (:226), `removeLine` (:243),
     `setQuantity` (:251) y `clear` (:264): *"el carrito cambió, el intento de
     compra en curso es otro pedido ahora"*. **Un cupón cambia la plata.**
   - Envelope `{ v: 2, lines, couponCode }` en `burger-shop.cart.<slug>`.
   - ⚠️ **Leer un envelope `v: 1` no puede tirar ni vaciar el carrito**: se promueve
     en el lugar con `couponCode: null`. Alguien con el carrito armado desde antes
     del deploy no pierde el pedido.

8. **El aviso de promos al lado del campo de email** (§5.12.3 — se movió acá desde
   la Entrega A, porque es un **consentimiento** y en A no existía forma de mandar
   una promo). Copy cerrado, **sin checkbox**:

   > *"Si dejás tu email, además del comprobante el local puede mandarte promos. Te
   > podés dar de baja desde cualquier mail."*

### Criterios de aceptación
1. La vista **no calcula** el descuento: lo muestra.
2. Cambiar de método de pago con un cupón restringido → la línea se tacha **con el
   motivo**, el total sube, y nada desaparece.
3. Un código inválido **no** deja el carrito sin precio.
4. `/pedido/[token]` con descuento: los números cierran.
5. Sin descuento, ninguna línea nueva.
6. Mobile: el campo y la línea entran sin scroll horizontal, targets de 44px.
7. **Aplicar, cambiar o quitar el cupón descarta la `idempotencyKey`** — el test que
   importa: confirmar sin cupón, aplicar cupón, reconfirmar → **pedido nuevo con
   descuento**, no el viejo sin descuento.
8. Un carrito guardado con envelope `v: 1` se lee sin errores y **sin perder
   líneas**.
9. El aviso de promos está junto al campo de email, **sin checkbox**.

### Skills obligatorias
`impeccable` + `reference/craft-floor.md`; `web-design-guidelines`;
`vercel-react-best-practices`. **La vitrina hereda el mundo visual ya decidido.**

---

## T6B — Frontend: el descuento en las superficies operativas

**Lane:** `frontend`. Agente: `frontend-react-craftsman` (tercero). Slice chico.

### Dueño exclusivo de
- `src/views/admin/pedidos/history-list.tsx`
- `src/views/admin/kds/**`
- `src/views/courier/**`

### No toca
`src/views/admin/clientes/**` (T2A, T4B), `src/views/storefront/**` (T5B),
`src/views/admin/pedidos/scheduled-tray.tsx` ni `date-filter.tsx`.

### Qué construir

**La misma línea de descuento de §5.14.4**, en el desglose de importes que ya
existe en cada superficie, **solo si `discountCents > 0`**. No hay panel nuevo, no
hay tarjeta nueva.

1. **`history-list.tsx`** — en el desglose de la fila expandida.
2. **El KDS** — **no es opcional**: un pedido `in_store` se cobra en el mostrador,
   y quien cobra tiene que ver **por qué** el total no es el subtotal. Sin eso, el
   encargado cobra bien y no puede explicarlo, que es media regresión al flujo que
   vinimos a reemplazar.
3. **El portal del repartidor** — por lo mismo: cobra en la puerta. El dato llega
   por la clave `discountCents` que T0B agregó a `courier_queue`.

### Criterios de aceptación
1. Con descuento, las tres superficies muestran la línea y los números cierran.
2. Sin descuento, ninguna de las tres cambia en nada.
3. El código del cupón se muestra como etiqueta de la línea.
4. El repartidor ve el total **con** descuento (que ya es `totalCents`).

### Skills obligatorias
`impeccable` + `reference/craft-floor.md` + **`reference/operate.md`**;
`web-design-guidelines`.

---

## T7B — Briefs de superficie · **HILO PRINCIPAL**

Escribir en `.impeccable/surfaces/` los briefs de las superficies nuevas, con el
formato de los que ya están (frontmatter + alcance/modo, audiencia y trabajo,
selected direction, estados, accesibilidad, primitivas):

- `src-views-admin-clientes-directory-table-tsx.md` — incluye el WhatsApp
  precargado y sus tres mensajes (§5.5.1), que es la mitad del valor del padrón.
- `src-views-admin-clientes-cupones-coupon-sheet-tsx.md` — incluye los dos tiempos
  (borrador gratis / activar con código) y el desglose de la reserva.
- `src-views-admin-clientes-cupones-campaign-sheet-tsx.md` — incluye el preview con
  días y fecha del último mail contra el vencimiento, y la oferta comercial.

Se escriben **antes** de T2A y T4B, no después: son el input de esos agentes.

---

## Grafo de dependencias

```
ENTREGA A
  T0A (schema + contratos)  ──┬──► T1A (backend)
                              ├──► T2A (padrón)     ◄── T7B brief
                              └──► T3A (baja + legal + aviso checkout)
  T1A ──► T2A   (la page necesita el controller)
  [T2A ∥ T3A]   — archivos disjuntos, corren en paralelo
                  (y desde el movimiento del aviso a la Entrega B, T3A ya no
                   toca la vitrina: A no comparte ningún archivo con B)

  ── integrar y verificar A ──

ENTREGA B
  T0B (schema + contratos + lib/coupon.ts + lib/money.ts)
    ├──► T1B (cupones, campañas, 2º factor)
    ├──► T2B (order.model, checkout, MP)          ← el más delicado
    └──► T3B (mail, cron, ventas)
  T1B ──► T4B (tab de Cupones)                    ◄── T7B briefs
  T4B ──► T2A (solo el menú de cupones del WhatsApp: T4B lo entrega,
               T2A lo monta — si hay que editar un archivo de T2A, PARAR)
  T2B ──► T5B (checkout + seguimiento + cart.tsx)
  T0B ──► T6B (KDS, pedidos, repartidor)
  [T1B ∥ T2B ∥ T3B]  — disjuntos
  [T4B ∥ T5B ∥ T6B]  — disjuntos

  ── integrar, code-reviewer + test-engineer en paralelo ──
```

## Lo que ningún slice hace, en ninguna de las dos entregas

- **Escribir o editar `supabase/migrations/**`.** Es de T0A / T0B.
- **Correr `npm run db:reset`** o cualquier cosa que toque la base.
- **Correr `npm install`.** No hace falta ninguna dependencia nueva.
- **Escribir en `tests/**`.** Es del `test-engineer`.
- **Editar `src/models/types.ts`**, `src/lib/coupon.ts` o `src/lib/money.ts`. Son
  contratos del hilo principal. Si un slice necesita un campo que no está: **para y
  lo reporta.**
- **Correr `context.mjs` o `concept-seed.mjs`** de `impeccable`. El mundo visual
  está decidido y se hereda.
- **Tocar `private.order_is_billable`** (§5.4, Q6: es otra conversación).
- **Agregar `add-suppression` de Resend** para la baja de marketing. Es la trampa
  de §3.4 y deja al cliente sin el comprobante de su pedido.
- **Tocar `expire_pending_orders`, el cron de reconciliación ni `vercel.json`.** El
  modelo de reserva no los necesita: `expire_pending_orders` ya deja los pedidos en
  `cancelled`, y de ahí en adelante el trigger hace el resto (§5.7.2.3). Un slice que
  se encuentre editándolos se equivocó de camino.
- **Incrementar `reserved_count` o `redeemed_count` a mano, desde ningún lado.** Los
  mantiene `sync_coupon_counters()` recalculando desde el libro mayor. Un
  `update coupons set reserved_count = reserved_count + 1` en cualquier archivo es un
  bug, no una optimización.
- **Agregar debounce a la cotización.** El balde se cobra solo en el fallo
  justamente para no necesitarlo (§5.13), y el `AbortController` que ya está es el
  mecanismo.
- **Armar una URL de `wa.me` a mano.** Existe `whatsappHref()` (§5.5.1).
- **Registrar los WhatsApp mandados.** No se puede saber si salieron, y un registro
  que miente es peor que ninguno.
