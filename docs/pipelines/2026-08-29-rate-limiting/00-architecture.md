# Rate limiting — arquitectura

Pipeline: `2026-08-29-rate-limiting` · Etapa 00 (planificación) · **Propuesta, pendiente de aprobación**

---

## 1. Problema y contexto

### Lo que se pidió, textual

> "deberiamos tener un rate limiter para que alguien no pueda pedir por ejemplo una
> imagen 1000 veces, o pedir un mail 300 veces"

Dos vectores nombrados (imágenes, mail) y la expectativa de una defensa general.

### El contexto que condiciona todo

- **El grueso del tráfico es anónimo.** Catálogo, carrito, checkout y seguimiento no
  tienen sesión. No hay identidad con la cual keyear en el caso principal.
- **Mobile argentino = CGNAT.** El 90% de los pedidos entra desde un celular
  (`CLAUDE.md`). Muchos clientes reales comparten una IP pública. **Un límite por IP
  demasiado ajustado bloquea gente que está pagando.**
- **Multi-tenant.** Un local que vende mucho no puede quedar limitado por el volumen
  de otro. Los límites de negocio van por tienda, siempre.
- **Hobby en Vercel y Free en Supabase**, decidido por el dueño (*"después se puede
  subir, pero el QC del mes que viene es con solo 1 tienda"*). Esto **no es un detalle
  de presupuesto: cambia la arquitectura**, y buena parte de lo que abajo se decide sale
  de acá. Ver §5.7.
- **El QC es con una sola tienda.** Los límites *por tienda* importan menos hoy; los que
  protegen del abuso anónimo y del agotamiento de cuotas compartidas importan igual o más.
- **Falso positivo > falso negativo en el camino de compra.** Bloquear un pedido pago
  es plata perdida más un cliente enojado más una llamada al local. Esto ordena toda
  la calibración de abajo y se dice explícito acá para que nadie lo "optimice" después.
- **Los tres throttles que existen hoy son placebo en Vercel** y el propio código lo
  admite: son `Map` en memoria del proceso Node
  (`src/app/api/orders/route.ts:44`, `src/controllers/admin.actions.ts:68` y `:495`).
  Cada lambda tiene su memoria, se pierden en cada cold start y no se comparten entre
  instancias ni entre regiones. No hay que calibrarlos: hay que reemplazarlos.

---

## 2. Challenge / pushback

Cuatro cosas que hay que decir antes de diseñar nada.

### 2.1 Para el vector de imágenes, "rate limiter" es la herramienta equivocada

Pedir **la misma imagen** 1000 veces no cuesta 1000 transformaciones. Vercel factura
transformación solo en cache `MISS` y `STALE`, y la cache key es
`(projectId, url, w, q, Accept normalizado)`
([Image Optimization](https://vercel.com/docs/image-optimization),
[Limits and Pricing](https://vercel.com/docs/image-optimization/limits-and-pricing)).
En este repo, hoy:

```
widths    = deviceSizes(7) ∪ imageSizes(7)                    = 14
qualities = [75]        (default de Next 16; el config no lo declara)
formats   = ['image/webp'] (AVIF no está habilitado)
                                                     techo = 14 por URL de origen
```

O sea: **la misma foto pedida 1000 veces son como mucho 14 transformaciones y 986
cache hits.** Un rate limiter ahí ataca el ancho de banda, no el costo que preocupa.

**El agujero real es otro, y es de configuración, no de volumen.** `next.config.ts`
declara:

```
{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }
```

Verificado contra el matcher real de Next
(`node_modules/next/dist/shared/lib/match-remote-pattern.js`):

```js
if (pattern.search !== undefined) { if (pattern.search !== url.search) return false }
```

`search` **no está declarado**, así que **cualquier query string en la URL de origen
pasa**. Y `hostname: '*.supabase.co'` matchea **cualquier proyecto de Supabase del
mundo**. Combinando las dos cosas:

```
/_next/image?url=https://<proyecto-del-atacante>.supabase.co/storage/v1/object/public/x/a.jpg&w=1920&q=75
/_next/image?url=https://<nuestro-proyecto>.supabase.co/storage/v1/object/public/product-images/1/foo.jpg?v=1&w=1920&q=75
/_next/image?url=...&v=2   ... &v=1000
```

Cada una es una **cache key distinta** → un `MISS` → **una transformación facturada +
un cache write + Fast Data Transfer**, sin techo. Supabase Storage ignora los query
params desconocidos y devuelve 200, así que la segunda forma amplifica con **una sola
foto legítima nuestra**.

Esto se cierra en `next.config.ts` en cinco minutos y sin código de runtime. Un rate
limiter encima está bien como cinturón, pero **si solo se pone el limiter, el agujero
sigue abierto**: 1000 URLs distintas repartidas entre 50 IPs pasan cualquier límite
razonable, y cada una cuesta plata igual.

#### Y en Hobby no cuesta plata: apaga el producto

En Hobby el techo incluido es **5.000 transformaciones por mes**, y al excederlo *"new
images will fail to optimize and instead return a runtime error response with 402 status
code ... and show the `alt` text instead of the image"*, mientras que *"in most cases, if
you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have
passed before you can use the feature again"*
([Limits and Pricing](https://vercel.com/docs/image-optimization/limits-and-pricing),
[Hobby Plan](https://vercel.com/docs/plans/hobby)).

O sea: **cualquier anónimo, gratis, en un minuto, deja el catálogo de todas las tiendas
en texto alternativo hasta que dé la vuelta el mes.** En un producto cuya premisa
declarada es que *"la foto es el motor de venta"*, eso no es un sobrecosto: es el
producto apagado, sin forma de revertirlo con un deploy. Y no cae en el fallback lindo
que diseñamos (`PhotoFrame` sin foto = nombre en grande sobre el color de la marca):
un 402 sobre una foto que sí existe es una imagen rota.

**Peor todavía: no hace falta ningún atacante.** Con `minimumCacheTTL` en su default de
4 horas, cada variante viva se re-transforma hasta 6 veces por día (`STALE` se factura
igual que `MISS`). Con una sola tienda de 40 productos más el branding:

```
42 imágenes de origen × 14 anchos                        =    588 variantes
588 × 6 revalidaciones/día × 30 días                     = 105.840 transformaciones/mes
techo incluido en Hobby                                  =   5.000
```

**21× por encima del techo, con tráfico normal y cero atacantes.** Con
`minimumCacheTTL` en un año: **588 transformaciones, una sola vez, para siempre.**

Esto reordena las prioridades: en Hobby, `next.config.ts` no es una optimización de
costos, es **la diferencia entre que el catálogo se vea y que no se vea**. Es el P0 #1,
por encima de cualquier regla de firewall.

### 2.2 Hay algo peor que los dos vectores que nombró el dueño

**`/[store]` es 100% dinámico y no tiene ninguna cache.** Verificado contra el build:

```
.next/prerender-manifest.json  → estáticas: /, /_not-found, /favicon.ico, /mis-pedidos
.next/routes-manifest.json     → /[store], /[store]/carrito, /[store]/checkout,
                                 /[store]/producto/[id], /pedido/[token] → dinámicas
```

No hay `export const revalidate`, ni `dynamic`, ni `use cache` en ninguna page pública.
Cada visita a `/la-birra` es **una invocación de función + 3 round trips a Postgres**
(`getStoreBySlug`, `getMenu` → `categories` + `products`, `src/controllers/storefront.controller.ts`).
Es el camino más barato que tiene un atacante para quemar GB-hours de función y
apretar el pool de conexiones de Supabase — y además **amplifica hacia imágenes**,
porque cada render dispara N requests a `/_next/image`.

Es más grave que los dos vectores nombrados y hay que decirlo primero. La respuesta
correcta de fondo es **cachear el catálogo** (ISR / `use cache` con invalidación por
tag al editar el catálogo), no limitar. Acá se propone la regla de WAF como
contención inmediata y se deja el cacheo como plan aparte (§8).

### 2.3 El daño de "300 mails" no es la factura de Resend: es dejar sin `/admin` a todos los locales

`requestMagicLinkAction` (`src/controllers/admin.actions.ts:106`) es un Server Action
público que cualquiera puede llamar sin sesión, y es **el único camino a `/admin`**.
El magic link lo manda **Supabase Auth por SMTP**, no la app. Y ahí hay dos cuotas
compartidas por **todo el proyecto**, o sea por **todas las tiendas a la vez**:

- Al conectar SMTP propio, Supabase impone **30 mensajes/hora** por defecto en el
  proyecto hosted (ya documentado en `CLAUDE.md`; se sube en Rate Limits del
  dashboard).
- `/auth/v1/otp` tiene además un tope **project-wide de 30/hora**
  ([Auth Rate Limits](https://supabase.com/docs/guides/auth/rate-limits)).

Un anónimo que conoce **un** email de dueño y pide el link en loop agota la cuota
del proyecto y **ningún dueño de ningún local recibe su magic link durante esa hora**.
Eso no es spam: es un incidente de disponibilidad multi-tenant, disparable por
cualquiera, gratis. Es lo más urgente de todo el mail.

Y hay un agravante estructural, ya documentado en el propio código
(`admin.actions.ts:52-56`): como la llamada sale de un Server Action, **Supabase Auth
ve siempre la IP de Vercel**, nunca la del atacante. Su límite por IP se agota para
todos juntos y no frena a nadie en particular. Por eso el límite por email **tiene**
que vivir en nuestro lado.

### 2.4 Los caminos de mail con sesión no tienen ningún límite, y algunos llevan texto libre

Del inventario (§3.2): **invitación de repartidor, reenvío de invitación de dueño,
reenvío de invitación de repartidor y código de cambio de pagos (2 mails por llamada)
no tienen ni throttle, ni cooldown, ni dedupe efectivo.** La invitación de repartidor
además acepta `email` libre **y** `displayName` que va al cuerpo del mail: un dueño
(o una sesión robada de un dueño) es un motor de spam saliente desde **nuestro dominio
verificado en Resend**. El activo que se quema ahí no son centavos, es la reputación
del dominio — y si Resend nos suspende, se cae el magic link, el comprobante y el
"pedido listo" de todos los locales a la vez.

---

## 3. Hallazgos de la investigación

### 3.0 Método y estado de las herramientas

- **Supabase MCP**: conectado. `get_advisors(security)` devolvió **cero lints**;
  `list_extensions` confirma que `pg_cron` está disponible pero **no instalado**, y
  que `pgcrypto`/`uuid-ossp` sí lo están. No hace falta instalar nada.
- **Plan: Hobby en Vercel, Free en Supabase** (confirmado por el dueño). El repo no
  tiene `.vercel/project.json`, así que no se pudo correr `vercel firewall overview`:
  **se asume que hoy no hay ninguna regla de WAF configurada.** Todo §5.1 está escrito
  para Hobby: **3 reglas custom en total, de las cuales como mucho 1 puede ser de rate
  limit.**
- **Project ref de producción**: `xyjracoaufarsnhurhdc` →
  `xyjracoaufarsnhurhdc.supabase.co`. Se pinnea literal en `remotePatterns`.
- **Los crons de Vercel no sirven en Hobby**: están limitados a una vez por día y una
  expresión más frecuente **falla el deploy**, así que `vercel.json` (que declara tres
  crons sub-diarios) hoy no despliega. El hilo principal lo está resolviendo por
  **pg_cron + pg_net desde Supabase**. Este plan **no apoya nada en un cron de Vercel**
  y se apoya en ese mismo camino (§5.6).
- **Docs consultadas**: Vercel Image Optimization (cache key, facturación), Vercel WAF
  Rate Limiting (claves, ventanas, límites por plan), Supabase Auth Rate Limits, y el
  doc local de Next 16 (`node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`)
  más el matcher real de `remotePatterns`.

### 3.1 Cómo se resuelve esto en producción

El patrón establecido es **tres capas, no un middleware genérico**:

1. **Borde / WAF** — volumétrico, por IP o fingerprint, antes de que la request llegue
   a la función. Barato, sin código, y **Vercel no factura las requests bloqueadas**.
2. **Aplicación** — por entidad de negocio (email, teléfono, tienda, usuario). Es lo
   único que puede expresar "3 magic links por *este email* por hora". Necesita estado
   compartido.
3. **Proveedor** — las cuotas del propio Supabase Auth y de Resend, que ya existen y
   hoy están mal calibradas para producción.

Cada superficie cae en una sola capa, o en dos deliberadamente. Pegarle un middleware
genérico a todo es el antipatrón: mide lo que no cuesta y no mide lo que sí.

### 3.2 Inventario real de superficies (auditado, no de memoria)

**Imágenes** — un solo bucket, `product-images`, `public = true`, 5 MB,
MIME acotado a jpeg/png/webp/avif (`supabase/migrations/20260825120400_storage.sql`).
Branding reusa el mismo bucket. Las URLs se arman a mano
(`src/lib/storage.ts`, y duplicada en `src/models/catalog.model.ts:250` y
`src/views/admin/catalogo/image-upload.ts:10`). Cero transformaciones de Supabase:
todo el redimensionado pasa por `/_next/image`. La subida va **directo del browser a
Storage** con RLS (`is_store_member` sobre el primer segmento del path); el upload
**no setea `cacheControl`**, así que los objetos salen con el default de Supabase
(`max-age=3600`). Los nombres son UUID v4 con `upsert: false`, o sea **el contenido de
una URL nunca cambia**. `next.config.ts` no declara `qualities`, `minimumCacheTTL`,
`formats` ni `imageSizes` (defaults: `[75]`, `14400`, `['image/webp']`,
`[32,48,64,96,128,256,384]`).

**Mail** — nueve caminos. Los que importan para esto:

| # | Camino | Quién | Mecanismo | Límite hoy | Destino lo elige |
|---|---|---|---|---|---|
| 1 | `requestMagicLinkAction` | **anónimo** | Auth SMTP | 5/5min por (email+IP), **en memoria** | el atacante |
| 2 | `submitOrder` → `order_receipt` | **anónimo** | Resend API | 10/min IP + 5/5min teléfono, **en memoria**; dedupe por `orderId` | el atacante |
| 3 | `dispatchReadyNotification` | staff / cron | Resend API | dedupe por `orderId` | el cliente del pedido |
| 4 | `createStoreWithOwner` | platform admin | Resend API | **ninguno** | platform admin |
| 5 | `resendOwnerInvite` | platform admin | Resend API | **ninguno** | la base |
| 6 | `inviteCourier` | dueño | Resend API | **ninguno** | **el dueño (libre)** |
| 7 | `resendCourierInvite` | dueño | Resend API | **ninguno** | la base |
| 8 | `requestPayment*ChangeAction` (**2 mails c/u**) | dueño | Resend API | **ninguno** en el envío | `auth.users` |
| 9 | `requestPaymentSupportAction` | cualquier staff | Resend API | 1/2min por `storeId`, **en memoria** | fijo, cuerpo libre 2000 chars |

El dedupe que existe (`wasAlreadySent(orderId, template)` +
`idempotencyKey` de Resend) es **por pedido**, no por destinatario: cada pedido nuevo
es un mail nuevo. Los caminos 4-8 ni siquiera escriben en `notifications`
(`order_id` es `not null` y ahí no hay pedido), así que no dejan rastro consultable.

**Creación de pedidos** — `POST /api/orders`. Idempotente por
`orders(store_id, idempotency_key)`, pero **nada impide generar mil claves distintas**.
Cada pedido `online` crea una preferencia en Mercado Pago
(`resolveCheckoutUrl` → `createCheckout`), o sea una llamada saliente a MP por pedido.
Cada pedido `pickup` con `customerEmail` manda un comprobante por Resend, gratis para
el atacante. El límite actual es en memoria.

**Enumeración de `public_token`** — `GET /api/orders/[token]` (**sin ningún límite**) y
`POST /api/orders/lookup` (**sin ningún límite, hasta 50 tokens por request**). El
espacio es 31^24 ≈ 2^119: la enumeración no es una amenaza criptográfica. Lo que sí
es real es la **carga de base**: 50 lookups por request, sin tope de requests.
Ojo con la calibración: `/pedido/[token]` hace polling con backoff `[5s, 30s, 60s]`
más un `setInterval` de 30s (`src/views/storefront/order-tracking.tsx`), o sea que un
cliente legítimo esperando su hamburguesa pega bastante seguido.

**Login del backoffice y TOTP** — `signInWithPassword`, `mfa.challengeAndVerify` y
`mfa.enroll` corren **en el browser contra Supabase directo**
(`src/views/backoffice/login-form.tsx:72,117`, `mfa-challenge.tsx:36`). **Nunca pasan
por una función de Vercel, así que el WAF no los ve ni los puede limitar.** Su única
defensa son los límites de Supabase Auth (MFA challenge/verify 15/hora por IP,
verify 360/hora por IP) más el requisito de `aal2` en las RLS. `[auth.captcha]` está
**comentado**. No hay `resetPasswordForEmail` en el repo: el platform admin no tiene
recuperación por mail, así que ese vector no existe.

**Webhook de MP** — `POST /api/webhooks/mercadopago`. Valida `store_id` en el query,
`x-signature` y `x-request-id`, y **re-consulta el pago contra MP** antes de tocar
nada. Un request sin firma válida se descarta con 401 — pero `verifyWebhookSignature`
**lee `store_payment_credentials` de la base para obtener el secreto**, así que un
flood sin firma igual cuesta un round trip a Postgres por request.

**Crons** — los cuatro comparan `CRON_SECRET` en tiempo constante y responden 401.
Vercel Cron invoca con `GET` y `Authorization: Bearer <secret>`. Están bien.

**PostgREST / Data API** — el browser tiene la publishable key, así que cualquiera
puede martillar `<ref>.supabase.co/rest/v1/products?select=*` **sin pasar por nuestro
código ni por el WAF de Vercel**. Los grants acotan el daño a lectura del catálogo
público (`20260825120500_grants.sql`: `anon` solo `select` sobre stores, branding,
categories, products, option_groups, options; `revoke all` sobre pedidos, pagos,
notificaciones y plataforma) y todas las RPC de `public` tienen
`revoke execute from public, anon`. **Esto es un riesgo residual aceptado** y hay que
decirlo así: no tenemos forma de limitarlo sin meter un proxy delante de Supabase, lo
cual no vale la pena para datos de catálogo público de solo lectura.

### 3.3 Lo que el WAF de Vercel puede y no puede hacer

De [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting):

| Recurso | Hobby | Pro |
|---|---|---|
| Claves de conteo | **IP, JA4** | **IP, JA4** (header/UA solo Enterprise) |
| Algoritmo | fixed window | fixed window |
| Ventana | 10s – 10 min | 10s – 10 min |
| Reglas de rate limit | **1 por proyecto** | 40 |
| Reglas custom totales | **3** | 40 |

**Estamos en la columna de la izquierda.** Cuatro consecuencias que definen el diseño:

1. **En Pro no se puede keyear por header ni por cookie.** Todo límite "por email",
   "por teléfono", "por tienda" o "por usuario" es **estructuralmente imposible en el
   WAF**. Eso resuelve solo el reparto de capas: WAF = volumétrico por IP/JA4;
   aplicación = todo lo que sea por entidad de negocio.
2. **La ventana máxima es 10 minutos.** "5 magic links por hora" tampoco entra.
3. **Los contadores son por región.** Con N regiones sirviendo tráfico, el límite
   efectivo es ~N× el configurado. Hay que elegir números sabiendo eso — otra razón
   para que el WAF sea la red gruesa y no la precisión.
4. **En Hobby hay UNA sola regla de rate limit y 3 reglas custom en total.** Eso invierte
   el plan original: **el WAF deja de ser la primera línea y pasa a ser un tiro único,
   que hay que gastar donde la aplicación no puede llegar.** Todo lo demás baja a la
   capa de aplicación o se acepta explícitamente como riesgo (§5.7).

Lo que el WAF **sí** hace mejor que nosotros: corre **antes** de la función, así que
una request bloqueada no cuesta invocación, no cuesta Postgres y **Vercel no la
factura**. Para el flood volumétrico es estrictamente superior a cualquier cosa que
escribamos.

---

## 4. Opciones y trade-offs

La decisión difícil no es "¿WAF o app?" (eso ya lo resolvió §3.3), sino **dónde vive
el estado de los límites por entidad de negocio**.

### Opción A — Upstash Redis (Vercel Marketplace) + `@upstash/ratelimit`

- **A favor**: es la respuesta de manual; sliding window real; latencia sub-ms; el
  contador no toca la base transaccional; hay SDK hecho.
- **En contra**: un vendor nuevo, una integración nueva, dos secretos nuevos, una
  factura nueva y **una decisión de fail-open/fail-closed en cada llamada** cuando
  Redis no responde. Y el volumen que justificaría todo eso no existe: los caminos que
  hay que limitar (crear pedido, mandar mail, invitar) se cuentan por decenas o
  centenas por hora en todo el SaaS, no por miles por segundo. Es infraestructura
  operativa permanente para un problema de baja frecuencia.
- **Cuándo sería la respuesta correcta**: si hubiera que limitar el **camino de lectura
  caliente** (el catálogo). Ahí un round trip extra a Postgres por request sí sería
  inaceptable. Justamente por eso el catálogo queda **solo** en el WAF (§5.1).

### Opción B — Postgres como contador (RECOMENDADA)

Una tabla de baldes con incremento atómico vía `insert ... on conflict do update
... returning`, detrás de una RPC `security definer` que solo puede llamar
`service_role`.

- **A favor**:
  - **Ya está, es transaccional, y el repo ya tiene exactamente este patrón
    funcionando**: `store_pending_changes.attempts` + `public.claim_store_pending_change`
    (`20260828235210_store_pending_changes.sql`), cuyo comentario dice, textual: *"El
    limite de fuerza bruta vive ACA y no en memoria del proceso Node: el throttle en
    memoria del magic link se pierde en cada cold start y no lo comparten las
    instancias de Vercel. Un contador que se reinicia solo no es un limite."* El plan
    no inventa un patrón: **generaliza uno que ya se tomó como decisión en este repo.**
  - Cero infraestructura nueva, cero secretos nuevos, cero vendor nuevo.
  - La limpieza se cuelga de `public.cleanup_old_records`, que el cron diario
    `/api/cron/cleanup` **ya llama**. Ningún cron nuevo.
  - Cuenta bien entre regiones y entre instancias, que es exactamente lo que hoy falla.
- **En contra**:
  - Un round trip extra a Postgres en los caminos limitados. Aceptable: son caminos
    que ya hacen 3+ round trips y que terminan en una llamada a Mercado Pago o a
    Resend (decenas de ms), no lecturas calientes.
  - Ventana fija, no deslizante: en el borde de la ventana se puede colar hasta 2× el
    límite. Se acepta explícitamente — el orden de magnitud es lo que importa acá, y
    el WAF (que también es fixed window) ya tiene la misma propiedad.
  - Tabla de alta rotación → hay que dejarla chica y barrerla a diario.

### Opción C — Solo WAF, sin capa de aplicación

- **A favor**: cero código, cero schema, cero mantenimiento.
- **En contra**: **no puede expresar ninguno de los límites que importan.** Sin claves
  por header en Pro, "3 magic links por email" no existe. Y para taparlo habría que
  apretar el límite por IP hasta un nivel que en CGNAT móvil argentino bloquea
  clientes reales en el camino de compra — que es exactamente lo que no se puede
  hacer. **Rechazada.**

### Recomendación

**Opción B**, y en Hobby **con más razón todavía**: si el WAF solo da un tiro, el estado
compartido en Postgres deja de ser el complemento y pasa a ser **la defensa principal**.
Regla de reparto, reescrita para el plan real:

> **La aplicación (Postgres) es la defensa por defecto.** El WAF se reserva para la única
> superficie que la aplicación **no puede** defender a un costo aceptable. Lo que no
> entra en ninguna de las dos se acepta como riesgo, por escrito, con la condición que lo
> reabre (§5.7).

Y una consecuencia incómoda que hay que decir en voz alta: **bajo un flood, el propio
limitador de aplicación agrega carga a Supabase.** Rechazar una request cuesta un
`insert ... on conflict` en un Postgres compartido de free tier. Sigue siendo mucho más
barato que crear un pedido (que son varias queries más una llamada a Mercado Pago), pero
**no es gratis**, y por eso la superficie de mayor volumen —la vitrina— tiene que quedar
del lado del WAF, que corta antes de que la request exista para nosotros.

## 5. Arquitectura recomendada

```
                          ┌─────────────────────────────────────────┐
   internet ──────────────▶│  L1  Vercel WAF (reglas, sin código)    │
                          │  volumétrico por IP/JA4, pre-función     │
                          └───────────────┬─────────────────────────┘
                                          │ pasa
                          ┌───────────────▼─────────────────────────┐
   /_next/image ─────────▶│  L2  next.config.ts (config, sin código) │
                          │  remotePatterns.search + host + TTL      │
                          └─────────────────────────────────────────┘
                          ┌─────────────────────────────────────────┐
   Server Action /        │  L3  App: consumeRateLimit()             │
   route handler ────────▶│  por email / teléfono / tienda / usuario │
                          │  estado en Postgres, RPC service_role    │
                          └─────────────────────────────────────────┘
                          ┌─────────────────────────────────────────┐
   browser ──────────────▶│  L4  Supabase Auth (dashboard + config)  │
   (login backoffice)     │  cuotas propias + CAPTCHA. NO vemos esto.│
                          └─────────────────────────────────────────┘
```

### 5.1 L1 — Vercel WAF: un solo tiro, y va a la vitrina

**Hobby da 3 reglas custom en total, y como mucho 1 puede ser de rate limit.** Así que la
pregunta no es "qué reglas ponemos" sino **"cuál es LA superficie que solo el WAF puede
salvar"**.

#### La regla de rate limit va en la vitrina (`/[store]` y sus subrutas)

| | `RL-1 storefront-flood` |
|---|---|
| Condición | request de página de vitrina (ver nota de host abajo) |
| Acción | `rate_limit` **300 / 60s** por `ip`, respuesta **429** |
| Etapa | `log` → revisión en dashboard → `deny`/`429` en preview → producción |

**Por qué esta y no otra**, en tres pasos:

1. **Es la única superficie de alto volumen que la aplicación no puede defender barato.**
   Un límite ahí tendría que correr en la page o en `proxy.ts`, o sea **un round trip a
   Postgres en el camino de lectura más caliente del producto** — exactamente lo que §4
   descarta. `POST /api/orders`, las invitaciones y el magic link **sí** tienen respuesta
   en la aplicación, y encima una mejor (teléfono y email son claves de negocio mucho más
   precisas que una IP en CGNAT).
2. **Es donde el recurso más escaso del stack se agota primero.** `/[store]` es SSR puro:
   1 invocación + **3 round trips a un Postgres free tier de CPU compartida** por visita
   (§2.2). Vercel Hobby aguanta bastante más que Supabase Free. Un flood ahí no degrada
   la vitrina: **tira la base**, y con la base caída no hay pedidos, ni panel, ni
   seguimiento, ni QC.
3. **Es la de mayor amplificación por request del atacante.** Una request a `/la-birra`
   dispara 1 función + 3 queries y, desde un browser, ~20 requests más a `/_next/image`.
   Limitarla ahí adelante es lo único que corta las tres cosas de una.

**Runner-up y disparador para cambiar de opinión**: `/_next/image`. Quedó segundo
**porque T5 le saca el filo por configuración**: con `search: ''`, el hostname pinneado y
el TTL largo, el flood de imágenes deja de generar transformaciones (el vector que apaga
el producto, §2.1) y queda en ancho de banda y edge requests. **Si después de T5 el
dashboard muestra que las transformaciones igual se disparan, la regla se muda ahí** —
esa es la señal, y hay que mirarla en la primera semana.

#### Las otras dos reglas son `deny`, no consumen la cuota de rate limit

| # | Nombre | Condición | Acción | Por qué entra |
|---|---|---|---|---|
| D-1 | `webhook-unsigned` | `path pre /api/webhooks/mercadopago` **Y** `header[x-signature]` `nex` | **deny** | MP **siempre** manda `x-signature`. Sin esta regla, cada request sin firma cuesta un round trip a `store_payment_credentials` para buscar el secreto con el que validarla — carga a la base gratis para el atacante, y la base es el recurso escaso. Cero falso positivo posible. **No se limita por IP**: MP notifica desde un set chico de IPs y limitarlas puede tirar un pago real. |
| D-2 | `cron-unauthenticated` | `path pre /api/cron/` **Y** `header[authorization]` `nex` | **deny** | Cero falso positivo: el invocador legítimo (ahora **pg_net desde Supabase**, no Vercel Cron) siempre manda el `Authorization: Bearer`. Es la de menor valor marginal de las tres y **la primera que se cambia** si aparece algo mejor. |

#### Lo que NO entra, y qué lo cubre en su lugar

| Superficie | Regla que tenía en el plan Pro | Qué la cubre ahora |
|---|---|---|
| `/_next/image` cross-project + query string | R1 `deny` | **T5, `next.config.ts`.** Next devuelve 400 antes de transformar nada, así que la regla era defensa en profundidad contra una regresión del config — no vale un slot de 3. |
| `/_next/image` flood | R2 rate limit | **T5 (`minimumCacheTTL`) + DDoS automático de Vercel.** Riesgo residual: ancho de banda y edge requests. Aceptado, §5.7. |
| `POST /api/orders` | R5 rate limit | **L3, `order:phone`.** Mejor clave que la IP. |
| `POST /api/orders/lookup` | R6 rate limit | **L3, límite nuevo `lookup:ip` (ver §5.3).** Baja a la aplicación. |
| `GET /api/orders/[token]` | R7 rate limit | **Nada.** Riesgo residual aceptado, §5.7. |

**Procedimiento, no negociable** (skill `vercel:vercel-firewall`): cada regla se publica
primero en `--action log`, **el usuario** confirma en el dashboard filtrado por rule ID
que matchea solo lo que tiene que matchear, después pasa a `deny`/`rate_limit` con
condición `environment = preview`, y recién al final a producción.
**`vercel firewall publish --yes` lo corre el usuario, nunca un agente.**

**Nota de coordinación con el plan hermano de subdominios.** El WAF matchea `path` /
`raw_path` **antes** del rewrite. D-1 y D-2 son sobre `/api/*`, que no se reescribe:
siguen andando igual. **RL-1 es justamente la que se rompe**, porque hoy el slug está en
el path y mañana está en el host. Se define con `target_path` (post-rewrite) o con una
condición de `host`, y **no se escribe asumiendo que el slug viaja en el path**. Hay que
verificarlo contra el rewrite real cuando ese plan aterrice — y como es la **única** regla
de rate limit que tenemos, si se rompe nos quedamos sin ninguna y nadie se entera.

### 5.2 L2 — El vector de imágenes se cierra con configuración

Cuatro cambios en `next.config.ts`, ninguno de runtime:

1. **`search: ''` en cada `remotePattern`.** Mata la amplificación por query string:
   `?v=1..1000` deja de matchear y devuelve 400 sin transformar nada. Verificado
   contra el matcher de Next.
2. **`hostname: 'xyjracoaufarsnhurhdc.supabase.co'`**, literal, en vez de
   `*.supabase.co`. Cierra el abuso cross-project. **Sigue siendo un literal estático**,
   respetando el motivo por el que hoy no se deriva de `process.env` (ese archivo se
   evalúa antes de que Next cargue los `.env`, y derivarlo dejó `remotePatterns` vacío y
   rompió toda foto de producto — está documentado en el propio archivo). El ref no
   cambia: la región de Supabase es inmutable y el proyecto es fijo.
3. **`qualities: [75]` explícito.** Hoy funciona por default, pero declararlo es lo que
   la doc de Next 16 pide justamente porque *"unrestricted access could allow malicious
   actors to optimize more qualities than you intended"*. Que sea explícito lo hace
   auditable y lo protege de un cambio de default.
4. **`minimumCacheTTL: 31536000` (1 año). Este es el cambio decisivo de todo el plan.**
   Los paths son UUID v4 con `upsert: false`: **el contenido de una URL nunca cambia** —
   cambiar la foto crea una URL nueva. O sea que la advertencia estándar ("no hay forma
   de invalidar la cache, mantené el TTL bajo") **no aplica acá**. Con el default de 4h,
   la cuenta de §2.1 da **105.840 transformaciones/mes contra un techo de 5.000**, sin
   ningún atacante. Con un año: **588, una sola vez**. La propia guía de Vercel para
   bajar costos recomienda exactamente esto
   ([Managing Usage & Costs](https://vercel.com/docs/image-optimization/managing-image-optimization-costs)),
   junto con acotar `qualities`, `formats` y `remotePatterns` — o sea, los cuatro puntos
   de esta lista.

Complemento: setear `cacheControl: '31536000'` en el `upload` a Storage
(`src/views/admin/catalogo/image-upload.ts`), para que el objeto de origen también diga
lo que es. Con `minimumCacheTTL` ya alcanza (Next toma el mayor de los dos), pero
dejarlo coherente evita que el día que alguien baje el TTL vuelva el problema.

**Lo que NO se toca por ahora**: `formats` (habilitar AVIF duplicaría el techo por foto
de 14 a 28), y `deviceSizes`/`imageSizes`. Sobre esto último, el número honesto: hoy son
**14 anchos** (7 + 7 del default de `imageSizes`), o sea 14 variantes por foto. Con el
TTL arreglado eso son 588 transformaciones **una vez** para una tienda de 40 productos —
12% del cupo mensual de Hobby, perfectamente cómodo. **Recortar anchos es el próximo
dial si el dashboard muestra que hace falta, no ahora**: tocarlo cambia el `srcset` real
y puede degradar la foto en pantallas grandes, y no hay evidencia todavía de que sea
necesario. Se deja anotado como la primera perilla a girar.

**Presupuesto de Hobby, para poder mirarlo:**

| Recurso | Incluido Hobby | Estimado con 1 tienda, post-T5 |
|---|---|---|
| Image transformations | 5.000 / mes | ~600 una vez, después ~0 |
| Image cache writes | 100.000 / mes | ~600 una vez |
| Image cache reads | 300.000 / mes | solo lecturas desde la cache global; con tráfico concentrado en `gru1` la mayoría son hits en región y **no** se facturan |

### 5.3 L3 — Límites de negocio, en Postgres

**Un modelo nuevo, `src/models/rate-limit.model.ts`**, con una única función:

```
consumeRateLimit({ bucket, subject, limit, windowSeconds })
  → { allowed: boolean; remaining: number; retryAfterSeconds: number }
```

Habla con `public.consume_rate_limit(...)` vía `createAdminClient()`. Es un modelo, no
un controller: es acceso a Postgres y nada más.

**`subject` nunca viaja en claro.** Se guarda el HMAC-SHA256 del valor normalizado,
calculado en Node antes de llegar a Postgres, con el mismo mecanismo que ya usa
`store_pending_changes.code_hash` (`src/services/crypto/hmac.ts` +
`CREDENTIALS_ENCRYPTION_KEY`). Si se guardara el email o el teléfono crudo, la tabla
sería un índice buscable de todos los clientes del SaaS que cualquier dump expone —
y un contador de rate limit no es motivo para crear un registro de PII nuevo.

**Política declarada en un solo lugar**, `src/lib/rate-limit-policy.ts` (constantes, sin
runtime de red), para que los números no queden desparramados:

| Bucket | Clave | Límite | Ventana | Se aplica | Al exceder |
|---|---|---|---|---|---|
| `magic_link:email` | email normalizado | **2** | 15 min | `requestMagicLinkAction` | respuesta uniforme (ver abajo) |
| `magic_link:email:day` | email normalizado | **5** | 24 h | idem | idem |
| `magic_link:ip` | IP de `x-forwarded-for` | **10** | 15 min | idem | idem |
| **`magic_link:global`** | constante | **15** | 60 min | idem | idem |
| `lookup:ip` | IP | **20** | 60 s | `POST /api/orders/lookup` | 429 + `Retry-After` |
| `order:phone` | teléfono E.164 | **5** | 10 min | `POST /api/orders` | 429 + `Retry-After` |
| `order:store` | `store_id` | **300** | 10 min | idem | **solo log/alerta, NO bloquea** |
| `courier_invite:store` | `store_id` | **10** | 60 min | `inviteCourierAction`, `resendCourierInviteAction` | 429 con mensaje |
| `courier_invite:email` | `store_id` + email | **3** | 60 min | idem | 429 con mensaje |
| `owner_invite:store` | `store_id` | **5** | 60 min | `createStoreAction`, `resendOwnerInviteAction` | 429 con mensaje |
| `owner_invite:admin` | `user_id` del platform admin | **20** | 60 min | idem | 429 con mensaje |
| `payment_change:store` | `store_id` | **3** | 60 min | `requestPayment*ChangeAction`, `resendPendingChangeCodeAction` | 429 con mensaje |
| `support:store` | `store_id` | **1** | 2 min | `requestPaymentSupportAction` | 429 (ya existe, se muda a PG) |
| `support:store:day` | `store_id` | **10** | 24 h | idem | 429 con mensaje |

Notas de calibración, todas deliberadas:

- **`magic_link:global` es nuevo y es la pieza clave del free tier.** Supabase impone
  **30 mensajes/hora para todo el proyecto** al conectar SMTP propio, y esa cuota la
  comparten el magic link anónimo *y* las invitaciones que manda el backoffice. Sin un
  tope global, un anónimo con **dos** emails conocidos la agota solo —y con una sola
  tienda en QC, los emails que existen son básicamente dos: el dueño y el platform
  admin—. Con el balde global en 15/hora, **el endpoint anónimo no puede consumir más de
  la mitad de la cuota del proyecto**, y la otra mitad queda **reservada para los caminos
  autenticados**, que son los que nunca pueden fallar (dar de alta un local, invitar a un
  repartidor). Es un presupuesto, no un límite de abuso: la parte de la cuota compartida
  que el anónimo tiene permitido gastar.
- **Los números del magic link bajaron respecto del plan de Pro** (3/15min → 2/15min,
  10/día → 5/día). No es paranoia: es que en free tier la cuota de arriba es la mitad de
  chica y no se puede subir con la misma libertad (§5.4).
- **`lookup:ip` bajó del WAF a la aplicación** porque en Hobby no hay regla disponible.
  Es la única excepción a "no poner límites de aplicación en lecturas": el endpoint acepta
  50 tokens por request, así que una query de rate limit para evitar 50 lookups es un
  cambio favorable.
- **`order:store` no bloquea.** Un viernes a la noche un local exitoso puede sorprender,
  y **bloquear pedidos pagos es exactamente lo que no se puede hacer**. Sirve para
  detectar, no para frenar. La contención real de ese camino es `order:phone`, que es una
  clave de negocio precisa.
- **Todos los buckets de negocio llevan `store_id` en la clave**, así que el volumen de
  un local no puede consumir el presupuesto de otro. **Con una sola tienda en QC esto no
  se va a ejercitar en la práctica**, y hay que decirlo: el aislamiento multi-tenant va a
  estar *implementado y testeado* (T8) pero **no probado por la realidad** hasta que
  exista la tienda nº 2. Se deja igual porque agregarlo después significa migrar claves
  de baldes en vivo.
- `magic_link` va **por email primero, por IP después**. Por IP sola no alcanza (rota
  gratis) y por IP agresiva rompe CGNAT.

**Fail-open vs fail-closed**, decidido por superficie y no por default:

- **Fail-open** (si la RPC falla, se deja pasar y se loguea `error`) en `order:*` y
  `magic_link:*`. Una base con hipo no puede impedir que alguien compre ni que un dueño
  entre a su panel. El WAF queda como red.
- **Fail-closed** (si la RPC falla, se rechaza) en `payment_change:*`. Ese camino toca
  las credenciales de cobro; ante la duda, no.

### 5.4 L4 — Config de Supabase Auth en free tier (lo que el WAF no ve)

El login del backoffice y el TOTP van **del browser a Supabase directo**
(`login-form.tsx:72,117`, `mfa-challenge.tsx:36`), así que **ninguna regla nuestra los
toca** — ni siquiera en Pro. Tres cosas, todas de configuración:

1. **Intentar subir el límite de email del proyecto** (Authentication → Rate Limits). El
   default al conectar SMTP propio es **30 mensajes/hora para todo el proyecto**, y esa
   es la cuota que un anónimo puede agotar dejando sin `/admin` a todas las tiendas
   (§2.3). **No pude confirmar en la documentación si esa página es configurable en el
   plan Free** — la doc de custom SMTP dice que se ajusta "heading to the Rate Limits
   configuration page" pero no aclara gating por plan
   ([auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp),
   [rate-limits](https://supabase.com/docs/guides/auth/rate-limits)). **Hay que mirarlo
   en el dashboard, no asumirlo**, y el plan está diseñado para los dos casos:
   - **Si se puede subir**: llevarlo a ~150/hora (con un solo local, más que suficiente)
     y `magic_link:global` pasa a ser holgura, no restricción.
   - **Si NO se puede subir**: 30/hora es un techo duro, y entonces
     **`magic_link:global` es lo único que separa a un anónimo de dejar sin acceso a
     todos los paneles.** En ese escenario el balde global no es endurecimiento: es P0.

   `config.toml` sigue en `email_sent = 100` para el stack local. **Son dos
   configuraciones separadas y `config.toml` no afecta al hosted**, ya documentado en
   `CLAUDE.md`; este plan no cambia nada ahí.
2. **Prender CAPTCHA** (`[auth.captcha]`, Turnstile) para el login del backoffice. Es lo
   único que defiende una superficie que no pasa por Vercel. **Es gratis y no depende del
   plan de Supabase**, así que en free tier es la mejor relación defensa/costo de todo
   el plan.
3. **Mirar el límite de MFA challenge/verify** (15/hora **por IP**). Dos admins en la
   misma oficina comparten IP. No se toca a ciegas.

#### El free tier de Supabase contra el diseño de contadores

Verificado con el MCP y contra la doc de planes:

| Restricción del free tier | ¿Choca con el diseño? |
|---|---|
| **500 MB de base** | No. `rate_limits` con retención de 1 día son miles de filas (< 1 MB). Es la tabla más chica del schema. |
| **CPU compartida, instancia micro** | Es la razón por la que la regla de WAF va a la vitrina (§5.1) y por la que no se ponen límites de aplicación en el camino de lectura caliente. |
| **Techo de conexiones bajo** | El limitador agrega **una** query a caminos de baja frecuencia (crear pedido, mandar mail), no al catálogo. Aceptable. |
| **Proyectos pausados a los 7 días sin actividad** | No afecta la arquitectura, **sí afecta el QC**: si el proyecto se pausa entre pruebas hay que reactivarlo a mano. Vale saberlo antes de la demo. |
| **`pg_cron` disponible pero no instalado** (confirmado por MCP) | Es la dependencia de la retención (§5.6). Lo instala el hilo principal. |
| **50k MAU, 5 GB de egress** | Fuera de riesgo con una tienda. |

**Nada del diseño de contadores choca con el free tier.** El free tier de Supabase
aprieta en CPU y conexiones, no en almacenamiento — y este diseño gasta almacenamiento
(nada) donde el plan alternativo (Redis) gastaría un vendor.

### 5.5 Qué ve el cliente cuando choca un límite

`src/lib/errors.ts` ya distingue `DomainError` (mensaje = interfaz) de todo lo demás, y
`DomainError` ya acepta `status`. Se agrega una subclase mínima:

```
RateLimitError extends DomainError   // status 429, más retryAfterSeconds
```

- `toApiError` la reconoce y el route handler agrega **`Retry-After`** en segundos.
- `toActionResult` ya pasa el mensaje de un `DomainError` tal cual: no hay que tocarlo.
- **Los mensajes le dicen a la persona qué hacer**, nunca "Too many requests":
  - Pedido: *"Estás mandando pedidos muy seguido. Esperá un minuto y probá de nuevo."*
  - Invitación: *"Ya mandaste varias invitaciones en la última hora. Probá de nuevo más tarde."*
  - Código de pago: *"Pediste el código varias veces. Esperá unos minutos antes de pedir otro."*
- **Excepción deliberada: el magic link no dice que fue limitado.** Hoy devuelve
  `{ ok: true }` exista o no el email, para no ser un oráculo de quién tiene panel en
  qué local. Eso se mantiene: la respuesta al usuario es siempre *"Si el mail está
  registrado, te llega el link"*. El límite se ve en el log, no en la pantalla.

### 5.6 Postgres: qué se agrega (el hilo principal escribe la migración)

**Tabla `public.rate_limits`** — balde de ventana fija.

- `bucket text not null` — el identificador de la política.
- `subject text not null` — **HMAC-SHA256 en hex del valor**, nunca el valor.
- `window_start timestamptz not null` — inicio de la ventana, truncado en la RPC.
- `count int not null default 0 check (count >= 0)`.
- **PK compuesta `(bucket, subject, window_start)`** — es también el índice del
  `on conflict` y del lookup. No hace falta ningún índice más para el camino caliente.
- Índice btree en `window_start` **solo** para que el barrido diario no haga seq scan.
- `alter table ... enable row level security` y **sin ninguna policy**, más
  `revoke all from anon, authenticated` y `grant select, insert, update, delete to
  service_role`. Mismo criterio que `store_pending_changes` y
  `store_payment_credentials`: si el browser del staff pudiera leerla o escribirla, el
  límite sería decorativo. **El `grant` a `service_role` va explícito en la migración
  aunque `alter default privileges` debería cubrirlo** — es el bug bloqueante que
  documenta `20260825120500_grants.sql` y no se asume.

**RPC `public.consume_rate_limit(p_bucket text, p_subject text, p_window_seconds int,
p_limit int)`** — `security definer`, `set search_path = ''`, en `public` porque
PostgREST solo expone los schemas configurados.

- El incremento es **una sola sentencia**: `insert ... on conflict (bucket, subject,
  window_start) do update set count = rate_limits.count + 1 returning count`. Atómica
  por definición: no hay read-modify-write, no hay carrera, no hace falta lock
  explícito ni `for update`. Mismo razonamiento que el comentario de
  `claim_store_pending_change` sobre por qué el contador no puede vivir en la app.
- `window_start` se calcula **dentro de la función** (`to_timestamp(floor(extract(epoch
  from now()) / p_window_seconds) * p_window_seconds)`), no lo manda el cliente.
- Devuelve `(allowed boolean, count int, retry_after_seconds int)`.
- **`revoke execute on function ... from public, anon, authenticated` y `grant execute
  to service_role`.** Postgres le da EXECUTE a PUBLIC por default: una `security
  definer` en `public` sin revoke es un endpoint abierto, y acá sería uno que cualquiera
  puede usar para **quemarle los baldes a un local ajeno**.

**Retención** — `create or replace` de `public.cleanup_old_records` (última firma
vigente: `20260828235210_store_pending_changes.sql`) para que además borre
`rate_limits` con `window_start < now() - interval '1 day'`.

**El scheduler ya no es Vercel Cron.** En Hobby los crons están limitados a una vez por
día y una expresión más frecuente **falla el deploy**, así que `vercel.json` (tres crons
sub-diarios) hoy no despliega; el hilo principal está migrando todo a **pg_cron + pg_net**
desde Supabase. Este plan se apoya en ese camino y **no agrega ningún cron**. Detalle que
conviene aprovechar: **`cleanup_old_records()` es SQL puro**, así que pg_cron la llama
**directo, sin pg_net, sin HTTP y sin `CRON_SECRET`** — a diferencia del outbox o la
conciliación, que sí necesitan salir a la red. Una llamada diaria alcanza.

**Lo que NO se hace en Postgres**: nada de `pg_cron` (está disponible pero no
instalado, y el cron de Vercel ya existe), nada de particionado (el volumen esperado son
miles de filas por día, no millones), nada de `pgmq`.

---

### 5.7 Free tier: qué se degrada, qué se acepta, y qué se recupera al pasar a Pro

Esta sección existe para que el upgrade sea una **decisión informada** y no una sorpresa
un viernes a la noche.

#### Lo que se pierde por estar en Hobby

| Superficie | En Pro | En Hobby | Riesgo real hoy |
|---|---|---|---|
| `POST /api/orders` | rate limit por IP en el borde **+** `order:phone` en la app | **solo** `order:phone` | **Bajo.** El teléfono es mejor clave que la IP. Lo que se pierde es que un flood **llega hasta nuestra función y hasta Postgres** antes de ser rechazado: el rechazo cuesta 1 query en vez de 0. |
| `POST /api/orders/lookup` | rate limit en el borde | `lookup:ip` en la app | **Bajo**, misma lógica. |
| `GET /api/orders/[token]` | rate limit por IP en el borde | **nada** | **Aceptado.** Enumerar 31^24 no es viable, y limitarlo en la app le agregaría una query a un endpoint que el seguimiento **poletea cada 5-60 segundos** — el remedio sería peor. Queda expuesto a un flood de lectura; lo tapa el DDoS automático de Vercel, que está en todos los planes. |
| `/_next/image` | rate limit por IP + `deny` de orígenes ajenos | solo la config de T5 | **Bajo post-T5, ALTO si T5 no se hace.** Sin T5 el vector apaga el catálogo por 30 días (§2.1). Con T5, lo que queda es ancho de banda. |
| Ventanas > 10 min en el borde | no existen en ningún plan | — | Irrelevante: eso ya vive en la app. |
| Log Drains | disponibles | **no disponibles en Hobby** | **Medio.** Los `log.warn` de rate limit se ven solo en Runtime Logs, y Hobby guarda **1 hora** de logs (Pro guarda 1 día). O sea: **si el abuso pasa de madrugada, a la mañana no queda rastro.** Es la pérdida menos obvia de todas y la que más molesta para calibrar. |
| Spend Management | configurable | N/A | Irrelevante en Hobby: no hay gasto, hay corte. Lo cual es peor. |

#### Riesgos aceptados explícitamente, con su disparador

1. **`GET /api/orders/[token]` sin límite.** Se acepta. *Disparador para revisarlo*: que
   aparezcan 404 masivos en los logs (por eso T3 agrega ese contador).
2. **Un flood contra `/api/*` consume función + una query de Postgres por rechazo.** Se
   acepta. *Disparador*: latencia de la base o errores de conexión durante un pico.
3. **Fair use.** El plan Hobby está restringido a *"non-commercial, personal use only"*
   ([Hobby Plan](https://vercel.com/docs/plans/hobby)). Para el QC con una tienda de
   prueba no hay problema; **el día que un local real cobre plata por ahí, el proyecto
   está fuera de los términos** y Vercel puede pausarlo. **No es un tema de rate
   limiting, pero es el riesgo de disponibilidad más grande de esta lista y sería
   deshonesto no nombrarlo.**
4. **Al exceder un límite de Hobby no hay factura: hay corte, y dura hasta 30 días.** No
   se puede "pagar el exceso" para salir. Esto invierte la intuición de siempre: en
   Hobby, **prevenir es la única palanca**, porque no existe la de reaccionar.

#### Qué se recupera pasando a Pro (en orden de valor)

1. **40 reglas custom, 40 de rate limit** → entran las 8 reglas del diseño original
   (§5.1 lista cuáles y qué cubre a cada una mientras tanto). Migración: agregar reglas,
   cero código.
2. **Log Drains y 1 día de retención de logs** → se puede calibrar con datos en vez de
   con estimaciones. Para un limitador recién estrenado, esto vale más que varias reglas.
3. **Spend Management** → el modo de falla pasa de "el producto se apaga" a "me avisan".
4. **Fair use resuelto** para uso comercial.

**Nada de lo que se construye en este plan se tira al pasar a Pro.** La capa de
aplicación se queda tal cual (es la que expresa los límites por entidad de negocio, que
el WAF no puede en ningún plan), la config de imágenes se queda tal cual, y el WAF solo
gana reglas. **El upgrade es aditivo**, y ese fue un criterio de diseño, no una
casualidad.

---

## 6. Cuestiones transversales

**Seguridad y secretos.** No aparece ningún secreto nuevo. El HMAC del `subject` reusa
`CREDENTIALS_ENCRYPTION_KEY` por el mismo camino que `code_hash`. Los logs de rate
limit **no pueden llevar el email, el teléfono ni el `public_token`** — se loguea el
bucket, el `store_id` y el conteo, siguiendo la regla que ya está escrita en
`src/lib/log.ts`.

**Aislamiento multi-tenant.** Todo bucket de negocio lleva `store_id` en la clave. La
tabla no tiene policies y solo la toca `service_role`, así que un local no puede leer
ni consumir el balde de otro ni por PostgREST. El único recurso realmente compartido
entre tiendas es la cuota de email de Supabase Auth, y §5.4 + `magic_link:email` es
la defensa de eso.

**Invariantes de plata y de estado.** Este plan **no toca** el precio, ni la máquina de
estados, ni la idempotencia. `consumeRateLimit` corre **antes** de `createOrder`, nunca
en el medio de una transacción, y **no consume balde cuando la clave de idempotencia ya
existe** (si no, un reintento legítimo con mala señal gastaría cupo por un pedido que
ya está creado — sería castigar exactamente el caso que la idempotencia existe para
proteger).

**Modos de falla y rollback.** L1 y L2 se revierten sin deploy: una regla de WAF se
desactiva desde el dashboard o con `vercel firewall rules disable`, y el cambio de
`next.config.ts` es un revert de commit. L3 se apaga con una variable de entorno de
kill-switch (`RATE_LIMIT_ENABLED=false`) que hace que `consumeRateLimit` devuelva
`allowed: true` sin tocar la base: si algo se calibró mal un viernes a la noche, se
apaga en un redeploy sin revertir código. **Esto es obligatorio, no opcional**, y sale
directo de la regla de calibración: si el limitador puede costar ventas, tiene que
poder apagarse rápido.

**Seguridad de la migración.** Es puramente aditiva: una tabla nueva, una función
nueva, un `create or replace` de una función existente. Nada de `alter` sobre tablas con
datos, cero locks largos, cero backfill. Revertirla es `drop table` + `drop function` +
restaurar la firma anterior de `cleanup_old_records`. Se puede desplegar antes que el
código y no hace nada hasta que alguien la llame.

**Revalidación de cache.** Nada de este plan invalida cache. El único punto de contacto
es la recomendación de §2.2 (cachear el catálogo), que queda **fuera de alcance**
justamente porque exige diseñar la invalidación al editar el catálogo, y eso es un plan
propio.

**Observabilidad.** Cada rechazo emite `log.warn` con `{ bucket, storeId, count }` y
**sin PII**. El campo `bucket` es lo que hace la línea buscable en el drain de Vercel.
Para el WAF, el dashboard de Firewall filtrado por rule ID; con Observability Plus,
`vc metrics vercel.firewall_action.count --group-by waf_rule_id --group-by waf_action`.
Un pico de `order:phone` o de `magic_link:email` es la primera señal de que alguien
está sondeando.

---

## 7. Prioridades

Reordenadas por el free tier: en Hobby **no hay factura, hay corte**, así que lo que
apaga el producto sube al tope.

**P0 — apaga el producto o lo deja sin acceso, y es disparable hoy, gratis, por cualquiera**

1. **`next.config.ts`** (T5): `minimumCacheTTL`, `search: ''`, hostname
   `xyjracoaufarsnhurhdc.supabase.co`, `qualities` explícito. Con el TTL default el
   catálogo revienta el cupo **solo con tráfico normal** (105.840 vs 5.000, §2.1), y con
   el comodín + sin `search` cualquiera lo revienta a propósito en un minuto. El
   resultado es texto alternativo en lugar de fotos **hasta 30 días**. Es el cambio más
   barato y el de mayor impacto de todo el plan.
2. **`magic_link:*` incluido el balde global** (T4 + T0): un anónimo deja sin `/admin` a
   todas las tiendas agotando la cuota compartida de 30 mensajes/hora (§2.3, §5.4).
3. **`RL-1 storefront-flood` en el WAF** (T7): es lo único que protege al Postgres free
   tier de un flood contra la vitrina sin cache (§2.2, §5.1).

**P1 — endurecimiento con impacto real**

4. Reemplazar los tres `Map` en memoria por la capa de Postgres (pedidos, magic link,
   soporte). Hoy son placebo y dan una falsa sensación de cobertura.
5. Límites en los caminos de mail con sesión (invitaciones, código de pago): protegen la
   reputación del dominio de Resend, que es un activo compartido por todo el SaaS —
   y si Resend nos suspende, se cae el magic link, el comprobante y el "pedido listo"
   de todos los locales a la vez.
6. `D-1 webhook-unsigned` y `D-2 cron-unauthenticated` en el WAF.
7. **CAPTCHA en el login del backoffice.** Gratis, no depende del plan, y es la única
   defensa posible de una superficie que no pasa por Vercel.
8. `lookup:ip` y `order:phone` en la aplicación.

**P2 — deuda que este plan encontró pero no resuelve**

9. Cachear `/[store]` (ISR o `use cache` + invalidación por tag). Es la solución de fondo
   de §2.2 y **en free tier vale el doble**, porque saca de encima la carga del recurso
   más escaso. **Plan aparte**, se cruza con el de subdominios.
10. `product_images_staff_update` tiene `USING` pero **no `WITH CHECK`**
    (`20260825120400_storage.sql`): un miembro de la tienda A puede mover un objeto suyo
    a un path de la tienda B. No es rate limiting, es un bug de RLS que apareció en la
    auditoría. **Se reporta, no se arregla acá.**
11. Storage crece sin techo: no hay cuota por tienda ni recorte de huérfanos, y el
    `ImageField` de apariencia nunca borra el archivo reemplazado. En free tier el techo
    es **1 GB**, así que además de costo es un límite real. **Fuera de alcance**, reportado.

## 8. Fuera de alcance (explícito)

- Cachear el catálogo (P2-9). Es la respuesta correcta a §2.2, pero requiere diseñar la
  invalidación al editar catálogo/branding y toca el plan de subdominios.
- Upstash Redis o cualquier infraestructura nueva. Si algún día hay que limitar el
  camino de lectura caliente, se reabre esta decisión con ese dato.
- Bot management / managed rulesets de Vercel. No hay evidencia de tráfico de bots que
  lo justifique, y el prompt de la skill es claro sobre lo fácil que es sobre-bloquear
  con JA4 y user agent.
- Attack Mode. Es respuesta a incidente, no arquitectura, y su activación es del usuario.
- Rate limiting del Data API de Supabase (§3.2). **Riesgo residual aceptado**: son
  lecturas de catálogo público y no se puede limitar sin meter un proxy delante de
  Supabase.
- Arreglar los bugs de la auditoría (P2-10, P2-11) y el bug de la plantilla del magic
  link que ignora `emailRedirectTo` (el repartidor aterriza en `/admin`). **Reportados,
  no tocados.**

---

## 9. Supuestos y preguntas abiertas

**Resueltas desde la última revisión**: el plan (Hobby/Free, confirmado), el project ref
de Supabase (`xyjracoaufarsnhurhdc`), y el scheduler de la retención (pg_cron, no Vercel
Cron).

1. **¿La página de Rate Limits de Supabase Auth es configurable en el plan Free?** No lo
   pude confirmar en la documentación. **Es la única pregunta que cambia una prioridad**:
   si el techo de 30 mensajes/hora es inamovible, `magic_link:global` deja de ser
   endurecimiento y pasa a ser P0 puro (§5.4). Se resuelve mirando el dashboard.
2. **¿El WAF ve el query param `url` decodificado o percent-encoded?** Ya no bloquea
   nada crítico (la regla que dependía de esto no entró en las 3 de Hobby), pero hay que
   saberlo el día que se pase a Pro. Se resuelve empíricamente con una regla en `log`.
3. **¿Confirmamos que hoy no hay ninguna regla de WAF publicada?** Sin
   `.vercel/project.json` no se pudo verificar. `vercel link` + `vercel firewall overview`
   antes de tocar nada.
4. **¿Se acepta el kill-switch por env var (`RATE_LIMIT_ENABLED`)?** Es la única forma de
   apagar L3 rápido sin revertir código, y la regla de "falso positivo es peor" lo pide.
   En Hobby vale más todavía: con 1 hora de retención de logs, si algo se calibra mal hay
   que poder apagarlo antes de entender por qué.
5. **¿MFA 15/hora por IP molesta a los platform admins?** Si dos admins comparten
   oficina, comparten IP. Hay que mirarlo antes de tocarlo.
6. **¿Cuándo se sube a Pro?** No hace falta para el QC. §5.7 tiene la lista de lo que se
   recupera, en orden de valor, para que la decisión se tome con datos.
