# Subdominio por local — arquitectura

**Run**: `docs/pipelines/2026-08-29-subdominio-por-local/`
**Estado**: propuesta. Requiere aprobación del dueño del producto antes de repartir.
**Dominio real**: `comandapp.ar`
**Revisión 2** — incorpora el cambio de alcance: **el flujo local de subdominios
queda fuera**, y la decisión de capa se reabrió y se volvió a tomar (§4.A).

---

## 1. Problema y contexto

Hoy el cliente navega a `comandapp.ar/la-birra`. Se quiere que navegue a
`la-birra.comandapp.ar`, con la URL **enmascarada**: rewrite interno, no
redirect — el browser sigue mostrando `la-birra.comandapp.ar/carrito` mientras
Next sirve el árbol `/[store]/carrito`.

Premisas ya decididas (CLAUDE.md, "Próxima iteración: subdominio por local").
**No se reabren:**

- **Los paneles viven en el apex**: `comandapp.ar/admin` y
  `comandapp.ar/backoffice`. Los subdominios de tienda sirven **solo tráfico
  anónimo**. El motivo es que un error de scoping de cookie a `.comandapp.ar`
  deje de ser posible, no que esté prohibido.
- **El path-based tiene que seguir funcionando**: los preview deployments no
  quedan cubiertos por el dominio wildcard.
- **Es rewrite, nunca redirect.** La URL va enmascarada.
- **No va en `src/proxy.ts`.** El proxy sigue haciendo solo lo que hace hoy.

**Alcance recortado por el dueño del producto**: en local se sigue usando el
acceso path-based (`localhost:3000/[slug]`) tal como funciona hoy. No hay hosts
locales, ni `/etc/hosts`, ni flujo de desarrollo con subdominios. Eso simplifica
el diseño (§5.6) y **tiene una consecuencia que hay que aceptar a ojos
abiertos** (§2.6).

---

## 2. Challenge / pushback

El pedido está bien planteado. Pero el encuadre "el rewrite son 15 líneas, el
plan vale por lo demás" **subestima cuánto es "lo demás"**, y hay cinco cosas
que si se ignoran hacen que el subdominio se despliegue roto o —peor— roto en
silencio.

### 2.1 Los links internos de la vitrina están todos hardcodeados a `/${slug}`

Diez lugares construyen `href={`/${store.slug}/...`}`:

```
src/app/[store]/checkout/page.tsx:21
src/views/storefront/store-chrome.tsx:32
src/views/storefront/store-dock.tsx:273,284
src/views/storefront/product-card.tsx:120,245
src/views/storefront/product-detail.tsx:148
src/views/storefront/cart-view.tsx:61
src/views/storefront/checkout-form.tsx:140
src/views/storefront/my-orders.tsx:131
```

En `la-birra.comandapp.ar`, un `href="/la-birra/carrito"` navega a
`la-birra.comandapp.ar/la-birra/carrito`, el rewrite lo convierte en
`/la-birra/la-birra/carrito` y **eso no matchea ninguna ruta: 404**. Es la
vitrina entera inutilizable apenas se toca algo. Este es el trabajo grueso del
cambio, no el rewrite.

### 2.2 La versión ingenua rompe el vaciado del carrito, y eso toca plata

`clearResolvedOrderCart(storeSlug)` (`src/lib/cart.tsx:311`) lo llama el
seguimiento en `/pedido/[token]`. Vacía el carrito **y descarta la clave de
idempotencia**. Su propio comentario dice por qué: *"a partir de ahí un carrito
viejo con esa clave sería un pedido fantasma si se reintentara"*.

`localStorage` es **por origen**. Si el checkout ocurre en
`la-birra.comandapp.ar` y el link de seguimiento apunta a
`comandapp.ar/pedido/<token>` —que es lo que sale hoy de
`NEXT_PUBLIC_SITE_URL`— entonces esa función corre en un origen **donde nunca
se escribió nada**: no vacía nada, no descarta ninguna clave, y no tira ningún
error. El carrito y la clave de idempotencia quedan vivos en el subdominio.

Consecuencia: el cliente vuelve a la carta con el carrito viejo cargado y la
misma `idempotencyKey`. Ese es exactamente el escenario que el índice único
`orders(store_id, idempotency_key)` fue puesto a atajar, así que no se cobra
dos veces — pero el síntoma para el cliente es "hice un pedido nuevo y me
devolvió el viejo", sin ningún mensaje. **Es una regresión silenciosa y es de
las caras.** Por eso el seguimiento va en el subdominio de la tienda (§5.1),
no en el apex.

### 2.3 La vista previa de marca fija el path-based en el apex para siempre

`src/views/admin/apariencia/brand-preview.tsx:108` embebe
`src={`/${storeSlug}?preview=brand`}` — un `<iframe>` **mismo origen** contra
el apex. Lo permite el carve-out de `previewFrameHeaders()` en
`next.config.ts`, que emite `frame-ancestors 'self'` solo con
`?preview=brand` puesto.

O sea: **`comandapp.ar/la-birra` no puede 404ear**. Y si el iframe apuntara al
subdominio pasaría a ser cross-origin y el `'self'` lo bloquearía — sin ningún
error visible en la app, que es el modo de falla que ese mismo comentario en
`next.config.ts` ya documenta. Cualquier decisión sobre "qué pasa con
`comandapp.ar/[slug]`" (§4.D) tiene que exceptuar `?preview=brand`
explícitamente.

### 2.4 La ventana para hacer esto barato se cierra en el lanzamiento

Verificado con el MCP de Supabase contra el proyecto linkeado:
`list_migrations` devuelve `[]` y `select ... from public.stores` responde
`42P01: relation "public.stores" does not exist`. **El proyecto hosted está
vacío: cero migraciones, cero tiendas, cero pedidos.**

Hoy este cambio no tiene costo de migración de datos, no tiene legado de SEO, y
no hay un solo `localStorage` de cliente que se pierda al cambiar de origen.
Cada uno de esos costos aparece el día del lanzamiento y no vuelve a bajar.
**Recomendación explícita: esto se hace ahora o se pospone mucho.** Un cambio de
origen con clientes reales encima cuesta carritos abandonados y "mis pedidos"
vacíos para todo el mundo, de una.

### 2.5 Una corrección al razonamiento original (no a la decisión)

El brief inicial decía que el proxy "corre después del cache y costaría una
invocación por request". La decisión de no meter el rewrite ahí es correcta,
pero ese motivo no se sostiene tal cual:

1. En el orden de routing de Next 16 —verificado en la doc que trae el propio
   repo, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md:87-98`—
   el orden es: headers → redirects → **proxy** → `beforeFiles` rewrites →
   archivos estáticos → `afterFiles` → rutas dinámicas → `fallback`. El proxy
   corre **antes** del rewrite, no después.
2. El `matcher` de `src/proxy.ts` **ya matchea** `/`, `/carrito`, `/checkout` y
   `/producto/*`. Mover el rewrite fuera del proxy **no ahorra la invocación**:
   el proxy se sigue invocando igual.

La decisión se mantiene, por razones que sí son verificables (§4.A). Queda
registrado para que nadie "optimice" después basándose en una premisa falsa.

### 2.6 Sacar el flujo local tiene un precio, y hay que nombrarlo

Con el alcance recortado, **el rewrite por host no se puede ejercitar en ningún
entorno que no sea producción**:

- en local el host es `localhost`, que no matchea el patrón;
- en preview el host es `*.vercel.app`, que tampoco (§5.7).

O sea que la primera vez que este código corre de verdad es en producción, con
el wildcard ya asociado. Eso es aceptable —y probablemente correcto, porque el
flujo local con subdominios tiene su propio costo de mantenimiento— pero
**cambia dónde vive la confianza**:

1. Los tests de T9 dejan de ser "una red más" y pasan a ser **la única
   verificación previa**. Por eso los criterios de T3 se escriben contra el
   objeto de configuración exportado y no contra un servidor levantado: son
   deterministas y corren en CI.
2. El despliegue necesita un **smoke test manual en producción** documentado
   (§7, checklist), hecho antes de anunciar el cambio a ningún local.
3. Si más adelante se quiere verificación pre-producción real, la vía
   documentada de Vercel es el **Preview Deployment Suffix** (reemplaza el
   sufijo `vercel.app` por un dominio propio), que exige nameservers en Vercel
   y certificado wildcard. Fuera de alcance hoy; queda anotado.

---

## 3. Hallazgos de la investigación

### 3.1 Estado real del repo (leído, no recordado)

| Qué | Realidad |
|---|---|
| Rutas bajo `/[store]` | Exactamente cuatro formas: `/`, `/carrito`, `/checkout`, `/producto/[id]` (+ `error`, `loading`, `not-found`) |
| Rutas de cliente **fuera** de `/[store]` | `/pedido/[token]`, `/mis-pedidos`, `/legal/*`, `/` (landing) |
| Otras rutas del apex | `/admin/*`, `/backoffice/*`, `/repartidor/*`, `/api/*` |
| **`src/app/page.tsx` existe** | Sí — una landing real en `/`. Es el hecho decisivo de §4.A |
| `NEXT_PUBLIC_SITE_URL` | 9 usos de runtime, mezclando concerns de apex y de tienda (§3.2) |
| `{{ .SiteURL }}` del magic link | `supabase/templates/magic-link.html` — sale del `site_url` del proyecto de Auth, o sea el apex. Ya es correcto |
| Cookies | `@supabase/ssr` 0.12.5. Soporta `cookieOptions.domain` (opt-in) — el repo **nunca** lo pasa, así que quedan host-only |
| `RESERVED_SLUGS` | 41 entradas, en `src/models/schemas/platform.schema.ts:27`, espejadas en el CHECK `stores_slug_not_reserved_check` |
| Regex de slug | `^[a-z0-9]+(-[a-z0-9]+)*$`, `min(2).max(60)` |
| `vercel.json` | Existe: `regions: ["gru1"]` + los 4 crons |
| `@vercel/config` | **No instalado.** Sería una dependencia nueva |
| Metadata | `metadataBase` no existe. No hay `sitemap.ts` ni `robots.ts` |
| Proyecto hosted | Vacío (§2.4) |

### 3.2 Mapa completo de URLs absolutas

Barrido de `NEXT_PUBLIC_SITE_URL`, `headers()`/`host` y `VERCEL_URL`. No hay
un solo uso de `VERCEL_URL`. Los usos de `headers()` son para IP y user-agent
de auditoría, no para construir URLs.

**Tienen que apuntar al APEX** (`comandapp.ar`):

| Sitio | Qué construye | Por qué apex |
|---|---|---|
| `src/controllers/admin.actions.ts:127` | `emailRedirectTo` del magic link | El panel vive en el apex. Es la premisa de seguridad |
| `src/models/courier.model.ts:81` | `/admin/acceso/confirm` de la invitación al repartidor | ídem |
| `src/models/platform.model.ts:343` | `/admin/acceso/confirm` de la invitación al dueño | ídem |
| `src/app/admin/(app)/pagos/page.tsx:12` | URL de webhook que se le muestra al dueño para pegar en MP | Server-to-server; estable e independiente del wildcard |
| `src/services/payments/mercadopago.adapter.ts:198` | `notification_url` | ídem, y deja el webhook fuera del hostname del tenant, que es lo que permite tratarlo aparte en el firewall |
| `src/services/notifications/email/owner-invite.tsx:66`, `courier-invite.tsx:83` | prop `siteUrl` del mail (arma `/admin/acceso`) | El panel vive en el apex |
| `supabase/templates/magic-link.html` (`{{ .SiteURL }}`) | link del magic link | Lo resuelve Auth con el `site_url` del proyecto |

**Tienen que apuntar al SUBDOMINIO de la tienda** (`<slug>.comandapp.ar`):

| Sitio | Qué construye | Por qué subdominio |
|---|---|---|
| `src/controllers/checkout.controller.ts:65` | `trackingUrl` del comprobante por mail | §2.2 + coherencia de marca |
| `src/controllers/checkout.controller.ts:110` | `trackingUrl` de la confirmación por WhatsApp | ídem |
| `src/controllers/kitchen.controller.ts:58` | `trackingUrl` de "pedido listo" | ídem |
| `src/controllers/kitchen.controller.ts:108` | `trackingUrl` de "salió tu pedido" | ídem |
| `src/services/payments/mercadopago.adapter.ts:176` | `back_urls` de Checkout Pro | **Crítico**: es el regreso del cliente después de pagar, y ahí corre `clearResolvedOrderCart`. Si vuelve al apex, no vacía nada (§2.2) |

### 3.3 Qué está verificado, y con qué fuente

- **`has: [{ type: 'host', value: ... }]` con named capture groups existe en
  Next y se interpola en `destination`.** Doc del repo,
  `.../01-next-config-js/rewrites.md:245-248` y ejemplo en 311-322.
- **`beforeFiles` puede ganarle a un archivo de página.** Comentario textual de
  la doc, líneas 55-57: *"These rewrites are checked after headers/redirects and
  **before all files including `_next/public` files which allows overriding page
  files**"*, y el orden de las líneas 94-95 lo confirma. **Este es el hecho que
  decide §4.A.**
- **La contracara: `beforeFiles` corre antes de resolver `_next/static`.** Un
  `source: '/:path*'` a secas se lleva puestos los chunks de Turbopack y
  **React nunca hidrata**. Es el mismo modo de falla que `allowedDevOrigins` ya
  documenta en `next.config.ts`. `/_next/image` no está nombrado en ese orden
  (no documentado): se trata como matcheable y se excluye igual.
- **Next le saca el puerto al Host antes de matchear.** Verificado en el código,
  no en la doc:
  `node_modules/next/dist/shared/lib/router/utils/prepare-destination.js:84-90`
  hace `host.split(':', 1)[0].toLowerCase()`. Con el alcance recortado esto ya
  no hace falta para desarrollo, pero sí explica por qué el regex del host **no
  lleva puerto** y por qué no hay que contemplar mayúsculas.
- **Los `rewrites` de `vercel.json` corren DESPUÉS del filesystem, sin
  excepción y sin fase configurable.** Textual, en
  <https://vercel.com/docs/project-configuration/vercel-json>: *"The `source`
  property should **NOT** be a file because precedence is given to the
  filesystem prior to rewrites being applied."* O sea que
  `source: "/"` **nunca dispara** mientras exista `src/app/page.tsx`. Esto
  descarta `vercel.json` de forma dura, no por preferencia. (El único con fases
  explícitas es el `routes` legacy, cuyas entradas previas al primer `handle`
  sí corren antes del filesystem — pero `handle` está marcado como *deprecated*
  en la doc.)
- **Vercel recomienda explícitamente routing nativo del framework para este
  caso.** Textual, en <https://vercel.com/docs/routing/rewrites>: *"For
  **same-application rewrites**, always prefer your framework's native routing
  capabilities: **Next.js**: Next.js rewrites […]. Use `vercel.json` rewrites
  for same-application routing only when your framework doesn't provide native
  routing features."* Y más fuerte todavía, en
  <https://vercel.com/kb/guide/why-is-my-deployed-project-giving-404>: *"With
  Next.js on Vercel, routing belongs in `next.config.js` and should replace
  `vercel.json` routing entirely. […] Using both creates conflicts where the
  `vercel.json` rules override or interfere with the framework's own routing
  manifest."*
- **`vercel.ts` con `@vercel/config` existe** (versión **0.7.0**, primera
  publicación 2025-11-12, import `@vercel/config/v1`), documentado en
  <https://vercel.com/docs/project-configuration/vercel-ts>, con helpers
  `routes.rewrite()` / `routes.redirect()` y condiciones `has` de tipo `host`.
  **No está instalado en este repo**, **es mutuamente excluyente con
  `vercel.json`** (*"Use only one configuration file: `vercel.ts` or
  `vercel.json`"*, sin codemod), **no ofrece control de fase** (`handle` no
  aparece en sus tipos) y su estado GA/beta **no está documentado**.
- **`has: { type: 'host' }` con named groups también es válido en
  `vercel.json`** (confirmado contra el JSON schema vivo de
  `openapi.vercel.sh/vercel.json`). No rescata la opción: `has` decide *si* un
  rewrite matchea, no lo mueve delante del filesystem.
- **Vercel recomienda `proxy.ts` para subdominios multi-tenant.** Ver §4.A: es
  evidencia en contra de la premisa recibida y se trata como tal, no se
  esconde.
- **En Vercel el rewrite se resuelve en la capa de routing, sin invocar
  función.** Build Output API: `routes` con fases y matcher `has`; el middleware
  es una entrada de ruta **aparte** (`middlewarePath`)
  (<https://vercel.com/docs/build-output-api/configuration>). Con el matiz de
  §2.5: la decisión de routing no cuesta invocación, pero el proxy corre antes
  igual.
- **`/.well-known` está reservado y no se puede reescribir ni redirigir** en
  Vercel (misma página de rewrites). No afecta hoy, pero es una restricción a
  recordar si algún día hace falta ACME o `apple-app-site-association`.

### 3.4 Infraestructura (confirmado en docs de Vercel)

- **El SSL wildcard exige nameservers de Vercel, sin excepción.** *"If using
  your custom domain as a wildcard domain, you must use the nameservers method
  for verification"*
  (<https://vercel.com/docs/domains/working-with-domains/add-a-domain>). El
  motivo es técnico: un wildcard solo admite el challenge DNS-01 y Vercel
  necesita controlar el DNS para responderlo
  (<https://vercel.com/kb/guide/why-use-domain-nameservers-method-wildcard-domains>).
  **No hay camino documentado con DNS externo.** La única salida es subir un
  certificado propio, y eso es solo Enterprise.
- **Los preview deployments no quedan cubiertos.** Los dominios custom se
  asignan por entorno; un wildcard agregado como dominio de producción sirve
  producción. Las preview URLs siguen siendo
  `<proyecto>-<hash>-<scope>.vercel.app`, así que **el rewrite host-gated a
  `comandapp.ar` nunca dispara ahí** y el fallback path-based funciona solo.
- **Vercel recomienda anotar el apex compartido en la Public Suffix List**
  justo por el problema de cookies que motivó poner el panel en el apex
  (<https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains>).
  Defensa en profundidad, opcional.
- **Mercado Pago**: HTTPS obligatorio en `back_urls` y `notification_url` desde
  el 2025-03-29 (una preferencia con HTTP devuelve 400), y `back_urls` no
  admite `localhost` ni `127.0.0.1`. **No hay** requisito documentado de que
  `back_urls` y `notification_url` compartan dominio, ni allowlist de dominios:
  subdominio para `back_urls` + apex para `notification_url` es legal. Trampa
  registrada: el `notification_url` del panel de MP y el de la preferencia son
  dos configs independientes.

### 3.5 Supabase Auth: allowlist de redirect

La allowlist **sí** soporta wildcards (`*` y `**`), y la propia doc recomienda
URLs exactas en producción. Confirmado vía `search_docs`.

El punto importante es el inverso: **no hay que agregar ningún wildcard para
`*.comandapp.ar`, y eso es una decisión de seguridad, no de prolijidad.** Ningún
subdominio de tienda tiene superficie de auth — es la premisa entera. Si se
agregara `https://*.comandapp.ar/**`, cualquiera que consiga dar de alta una
tienda obtiene un destino de redirect válido para el flujo OAuth del backoffice,
capaz de recibir un `code` de PKCE. Eso deshace exactamente lo que la decisión
"el panel va en el apex" vino a cerrar.

Además, hoy `additional_redirect_urls` solo hace falta para OAuth: el magic
link de `/admin` no pasa por ahí (arma su propio link con `{{ .SiteURL }}`),
como ya dice el comentario de `supabase/config.toml:159`.

---

## 4. Opciones y trade-offs

### 4.A Dónde vive el mapeo host → path — **decisión reabierta y re-tomada**

El argumento original ("`vercel.json` no aplica en `next dev`") se cayó con el
recorte de alcance. La decisión se rehizo desde cero y **el resultado no cambia,
pero el motivo sí, y ahora es más fuerte**: es una restricción técnica, no una
comodidad de desarrollo.

**El hecho decisivo: `src/app/page.tsx` existe.** El home de una tienda,
`la-birra.comandapp.ar/`, tiene que servir `/[store]` — o sea que el rewrite de
`/` **tiene que ganarle a un archivo de página que existe**. Si no gana, cada
local sirve la landing de la plataforma en su propia home: el peor 200 posible,
porque no falla, miente.

| | Pros | Contras |
|---|---|---|
| **`next.config.ts` `beforeFiles`** ← **recomendado** | **Es la única capa que documenta poder pisar un archivo de página**: *"before all files […] which allows overriding page files"*. Vercel recomienda explícitamente el routing nativo del framework para rewrites de misma aplicación. Comparte constante con el helper `notReserved` que ya vive en ese archivo para los headers. Es TypeScript: vitest lo importa y testea la tabla real, y el test de cobertura puede leer el filesystem de `src/app/[store]/` | `beforeFiles` corre antes de `_next/static`: un catch-all mata la hidratación (se mitiga con la allowlist explícita, 4.B). No lee `.env` (ya resuelto: el gating es por host). No puede consultar la base → `custom_domain` va a necesitar el proxy |
| `vercel.json` `rewrites` | El archivo ya existe. Routing de plataforma puro | **No documenta una fase previa al filesystem**: el `rewrites` de `vercel.json` es el mecanismo de misma-aplicación y la doc no le da control de fase (el único con fases explícitas es el `routes` legacy, con `handle: "filesystem"`). Sin esa fase, `source: "/"` no dispara y se cae el home de toda tienda. Además: **la lista de slugs reservados pasaría de 3 fuentes de verdad a 4** (schema TS, migración SQL, `next.config.ts` para headers, y ahora `vercel.json`), en dos sintaxis distintas. Y va contra la recomendación explícita de Vercel para este caso |
| `vercel.ts` + `@vercel/config` | Tipado y con helpers. Más lindo que JSON | **No resuelve el punto decisivo**: es la misma capa de plataforma con otra sintaxis. Y cuesta: **dependencia nueva** (no instalada) + **es mutuamente excluyente con `vercel.json`**, así que hay que migrar `regions` y los **4 crons que hoy funcionan** — tocar el disparador del outbox, de la conciliación de pagos y del auto-listo para ganar tipado en un rewrite es riesgo mal colocado |
| `src/proxy.ts` + `NextResponse.rewrite` | **Es lo que Vercel recomienda para multi-tenant por subdominio**, con un ejemplo documentado para el caso `pathname === '/'`. Dinámico: el día de `custom_domain` es el único camino, o sea un mecanismo en vez de dos. Puede leer `process.env`. Y **no cuesta invocaciones extra**: el matcher ya matchea esas rutas (§2.5) | Descartado por premisa recibida. Contras propias: (a) **no se puede testear como dato en CI** — es código por request, y con el flujo local afuera esa es justo la verificación que no tenemos (§2.6); (b) **blast radius**: hoy ese archivo tiene un solo trabajo y su propio comentario documenta el miedo a que un error de cold start *"se caiga el proxy para **todo** el sitio"* — meterle parsing de host sube esa apuesta; (c) duplicaría la constante de slugs reservados que ya vive en `next.config.ts` |

**Recomendada: `next.config.ts` `beforeFiles`.** Gana por poder pisar
`src/app/page.tsx`, por ser lo que Vercel recomienda para este tipo de rewrite,
por cohesión con la constante de slugs reservados que ese archivo ya tiene, y
por ser testeable con la suite que ya existe. `proxy.ts` se queda haciendo solo
lo que hace hoy.

> ### ⚠ Evidencia encontrada CONTRA la premisa recibida — se reporta, no se esconde
>
> Se pidió verificar la decisión y decirlo con la cita si algo resultaba falso.
> Resultó esto: **la guía de multi-tenant de Vercel recomienda el proxy, no el
> `next.config.ts`**, y trae un ejemplo para exactamente nuestro caso del
> path raíz
> (<https://vercel.com/docs/platforms/multi-tenant-platforms/middleware-and-routing>):
>
> ```ts
> if (pathname === '/') {
>   const url = request.nextUrl.clone()
>   url.pathname = `/tenant/${tenantId}`
>   return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
> }
> ```
>
> Y el motivo original para descartarlo —el costo de invocación— **es falso en
> este repo** (§2.5): el matcher del proxy ya matchea `/`, `/carrito`,
> `/checkout` y `/producto/*`, así que no se ahorra ninguna invocación.
>
> **La recomendación igual se mantiene en `next.config.ts`**, ahora como una
> divergencia deliberada y con motivos propios, no por desconocimiento: es la
> única forma **testeable como dato en CI**, y con el flujo local fuera de
> alcance (§2.6) esa es la única verificación previa a producción que queda. A
> eso se suma el blast radius de `src/proxy.ts` y la constante compartida de
> slugs reservados.
>
> **Es una decisión que el dueño del producto debería confirmar** (pregunta 6 de
> §7), porque el día de `stores.custom_domain` la lógica se muda al proxy igual
> y van a convivir dos mecanismos. Si se prefiere un solo mecanismo desde el
> día uno, la contrapartida a aceptar es perder la verificación en CI y ampliar
> el blast radius del proxy — no es gratis, pero es defendible.
>
> Nota adicional del mismo doc, que aplique el mecanismo que aplique: *"Tenant
> headers must come from the proxy, never from the client."* Si algún día se
> propaga el tenant por header, hay que **borrar** el header entrante en cada
> request.

> **Nota sobre `vercel.ts`**: no es una mala tecnología, es una decisión mal
> acoplada a esta. Si en algún momento se quiere tipar la configuración de
> plataforma (crons, regiones, headers de CDN), es un cambio con su propio plan
> y su propia verificación de los 4 crons — no un efecto secundario de un
> rewrite.

> **Camino futuro, fuera de alcance**: `stores.custom_domain` (`burgerx.com.ar`
> apuntando a la app) sí necesita `proxy.ts`, porque el mapeo dominio → slug es
> una consulta a la base. Ese día el rewrite estático se queda para
> `*.comandapp.ar` y el proxy agrega el caso dinámico, con cache.

### 4.B Forma del `source` del rewrite

| | Pros | Contras |
|---|---|---|
| **Allowlist explícita de 4 rutas** ← **recomendado** | Imposible que se lleve puesto `/_next/*`, `/api/*`, `/pedido/*`, `/legal/*` ni `/mis-pedidos`. Cada entrada se lee y se entiende | Agregar una ruta nueva bajo `/[store]` sin agregarla acá la deja 404 en el subdominio |
| Catch-all con lookahead negativo | Una sola entrada; una ruta nueva funciona sola | Un regex largo y frágil. Olvidarse una exclusión rompe la hidratación entera sin un error en la app. El modo de falla es peor y menos diagnosticable |

**Recomendada: allowlist explícita**, con un test que compare la tabla de
rewrites contra el contenido real de `src/app/[store]/`. Con el alcance
recortado ese test importa más que antes: es la única verificación previa a
producción (§2.6).

### 4.C De dónde sale el prefijo de los links internos

| | Pros | Contras |
|---|---|---|
| **Derivado del `Host` del request** ← **recomendado** | Se autocorrige: funciona en subdominio, en apex path-based, en preview deployments, **en local sin ninguna configuración** y **dentro del iframe de vista previa** (§2.3). Un solo camino para todos los entornos, sin variable de entorno | Obliga a leer `headers()` en el layout de `/[store]`. Costo real: nulo — esa ruta ya es dinámica de punta a punta (usa el cliente de Supabase con cookies) |
| Variable de entorno de modo | Trivial de leer | Se equivoca justo en el iframe de vista previa, que corre path-based en el apex mientras el modo global dice "subdominio". Rompería §2.3 |

**Recomendada: derivar del Host** para los links internos. Para las URLs
absolutas de salida (mails, WhatsApp, `back_urls`) **no sirve**, porque el cron
de auto-listo y el webhook de MP no tienen request host: esas van por env
(§5.2).

### 4.D Qué pasa con `comandapp.ar/[slug]` (pregunta 7)

| | Pros | Contras |
|---|---|---|
| **308 al subdominio, con dos excepciones** ← **recomendado** | Un solo origen canónico: sin contenido duplicado y sin `localStorage` partido en dos. Un link viejo o pegado a mano sigue funcionando | Una redirección más en el camino de un link compartido |
| Seguir sirviendo las dos | Cero trabajo | Contenido duplicado real, y peor: dos orígenes con dos carritos distintos para la misma tienda. El cliente que entra por un link path-based no ve el carrito que armó en el subdominio |
| 404 | Máxima limpieza | **Rompe la vista previa de marca** (§2.3) y cualquier link viejo |

**Recomendada: 308**, con dos excepciones, las dos obligatorias:

1. **`?preview=brand`** — el iframe de `/admin/apariencia` (§2.3).
2. **Host distinto del apex** — la condición `has` matchea `comandapp.ar`
   exacto, así que en `*.vercel.app` y en `localhost` no dispara nunca y el
   path-based sigue vivo tal cual (preguntas 5 y 6).

308 y no 301: es permanente y **preserva el método**, cosa que 301 no garantiza.

---

## 5. Arquitectura recomendada

### 5.1 El mapeo de hosts

```
comandapp.ar                     apex — paneles, legal, landing, /api/*, webhooks, crons
                                        y el path-based de vitrina (308 → subdominio)
<slug>.comandapp.ar              tenant — SOLO tráfico anónimo de esa tienda
*.vercel.app                     preview — path-based puro, sin rewrite ni redirect
localhost:3000                   desarrollo — path-based puro, EXACTAMENTE como hoy
```

Qué sirve el host de tenant:

```
la-birra.comandapp.ar/                    →  rewrite  →  /la-birra
la-birra.comandapp.ar/carrito             →  rewrite  →  /la-birra/carrito
la-birra.comandapp.ar/checkout            →  rewrite  →  /la-birra/checkout
la-birra.comandapp.ar/producto/42         →  rewrite  →  /la-birra/producto/42

la-birra.comandapp.ar/pedido/<token>      →  sin rewrite, sirve la ruta del apex
la-birra.comandapp.ar/mis-pedidos         →  sin rewrite, ídem
la-birra.comandapp.ar/legal/*             →  sin rewrite, ídem
la-birra.comandapp.ar/_next/*             →  sin rewrite (no matchea la allowlist)
la-birra.comandapp.ar/api/*               →  sin rewrite

la-birra.comandapp.ar/admin/*             →  308 → https://comandapp.ar/admin/*
la-birra.comandapp.ar/backoffice/*        →  308 → https://comandapp.ar/backoffice/*
la-birra.comandapp.ar/repartidor/*        →  308 → https://comandapp.ar/repartidor/*
```

Que `/pedido/*` y `/mis-pedidos` **no** se reescriban y se sirvan igual desde
el host del tenant es deliberado, y es lo que resuelve §2.2: el seguimiento
corre en el mismo origen donde se armó el carrito, así que
`clearResolvedOrderCart` encuentra lo que tiene que borrar.

Efecto secundario, y es una mejora: "mis pedidos" pasa a ser **por tienda**
(cada subdominio tiene su `localStorage`). Es más coherente con "marca propia,
nunca marketplace" que la lista global de hoy, donde el cliente de La Birra ve
pedidos de otro local en la misma pantalla.

El 308 de `/admin` al apex desde un host de tenant es defensa en profundidad:
la premisa dice "los subdominios sirven solo tráfico anónimo", y esto lo hace
cierto en vez de convencional.

### 5.2 La autoridad de URLs: un módulo nuevo

Hoy `NEXT_PUBLIC_SITE_URL` cumple dos roles a la vez y por eso el barrido de
§3.2 es tan largo. Se separan en `src/lib/urls.ts` (módulo puro, sin
`server-only`, usable de los dos lados):

```
apexUrl(path)                 → origen del apex + path
storeUrl(slug, path)          → origen de la tienda + path, según el modo
parseStoreHost(host)          → slug | null, para el Host entrante
storeBasePath(slug, host)     → '' | `/${slug}` para los <Link> internos
```

`NEXT_PUBLIC_SITE_URL` **no se renombra** (tocaría todos los `.env`, el
`config.toml` y seis tests) pero su contrato se estrecha en el comentario del
schema: **es el origen del apex, siempre**.

Se agrega **una** variable: `NEXT_PUBLIC_STORE_HOST_MODE` con valores
`subdomain | path` y **default `path`**. El default es el seguro: en local y en
preview nadie la setea y todo sigue path-based, que es exactamente lo que pide
el alcance recortado.

**Trampa que hay que respetar** (la misma que `remotePatterns` ya sufrió en este
repo): `next.config.ts` se evalúa **antes** de que Next cargue los `.env`. Por
eso el rewrite y el redirect **no leen ninguna variable de entorno**: son
puramente condicionados por `has: { type: 'host' }`. En preview y en localhost
el host nunca matchea `comandapp.ar`, así que son inertes solos.
`NEXT_PUBLIC_STORE_HOST_MODE` la lee **solo** `src/lib/urls.ts`, que sí es
código de app y sí ve los `.env` inlineados.

Rollback: no depende de una variable. Es el instant rollback de Vercel al
deployment anterior, o desasociar el dominio wildcard, lo que deja el rewrite
sin tráfico que matchear.

### 5.3 Flujo de datos

Nada de esto toca `models/` en su relación con Postgres, ni el cálculo de
precios, ni la máquina de estados. Es una capa de presentación de URLs. En
términos de MVC:

- **models/**: sin cambios de query. `courier.model.ts` y `platform.model.ts`
  cambian una concatenación de string por `apexUrl()`.
- **controllers/**: `checkout.controller.ts` y `kitchen.controller.ts` cambian
  `${SITE_URL}/pedido/${token}` por `storeUrl(slug, '/pedido/' + token)`.
  `kitchen.controller.ts` ya tiene el slug: `getOrderWithStoreById` devuelve
  `{ order, store }`.
- **services/**: `mercadopago.adapter.ts` parte sus dos URLs: `back_urls` a
  `storeUrl`, `notification_url` a `apexUrl`. **Necesita el slug**, que hoy no
  recibe: `PaymentProvider.createCheckout` gana un campo `storeSlug`. Es un
  cambio de contrato del port de pagos y va declarado en las tareas.
- **views/**: consumen `basePath` por contexto. Cero fetching, como siempre.
- **app/**: `[store]/layout.tsx` resuelve el `basePath` desde `headers()` y lo
  provee; `pedido/[token]/page.tsx` chequea coherencia de host.

### 5.4 Coherencia host ↔ pedido

`otra-tienda.comandapp.ar/pedido/<token-de-la-birra>` hoy renderizaría el tema
de La Birra bajo el host de otra tienda **y escribiría en el `localStorage` del
origen equivocado**. Se resuelve en `pedido/[token]/page.tsx`: si el host es de
tenant y su slug no coincide con `order.storeSlug`, `permanentRedirect` al
origen correcto. Barato y cierra el caso.

### 5.5 Qué va en Postgres

Solo una cosa: **extender `RESERVED_SLUGS`**, porque un slug ahora es un
hostname. La migración es del hilo principal (T1); acá va el contenido.

La lista actual de 41 cubre bien las colisiones de *path*. Lo que le falta son
los nombres que se van a necesitar como **subdominios reales de
`comandapp.ar`** una vez que el DNS esté en Vercel. El riesgo no es teórico: si
un local registra el slug `mail` y después hace falta `mail.comandapp.ar` para
Resend, hay un conflicto entre un registro DNS y un tenant vivo, y desenredarlo
implica renombrar la tienda de un cliente.

Categorías a agregar (la lista fina la fija el hilo principal al escribir la
migración):

- **Correo e infraestructura de entrega** — `mail`, `email`, `smtp`, `imap`,
  `pop`, `mx`, `webmail`, `autoconfig`, `autodiscover`, `bounces`, `track`,
  `link`, `links`, `send`. Son los que más duelen: el magic link es la única
  puerta a `/admin` y Resend necesita registros en esta misma zona.
- **DNS y red** — `ns`, `ns1`, `ns2`, `dns`, `ftp`, `vpn`, `gateway`, `proxy`.
- **Entornos** — `staging`, `stage`, `dev`, `test`, `qa`, `demo`, `beta`,
  `preview`, `sandbox`, `local`, `internal`.
- **CDN y assets** — `cdn`, `img`, `media`, `files`, `download`, `downloads`,
  `web`, `www2`.
- **Identidad y pagos** — `id`, `sso`, `oauth`, `callback`, `account`,
  `accounts`, `cuenta`, `pay`, `pago`, `pagos`, `billing`, `facturacion`,
  `webhook`, `webhooks`.
- **Observabilidad** — `metrics`, `monitor`, `logs`, `grafana`, `ci`, `git`.
- **Marca y proveedores** — `comandapp` (un `comandapp.comandapp.ar` de un
  tercero es phishing servido por nosotros), `vercel`, `supabase`, `resend`,
  `mercadopago`, `mp`.
- **Superficie de cliente** — `m`, `mobile`, `soporte`, `ayuda`, `contacto`.

**Lo que NO hace falta agregar**, verificado:

- El regex de slug ya produce labels DNS válidos: minúsculas, alfanumérico y
  guiones, **sin guion inicial ni final y sin `--` consecutivos** (la forma
  `^[a-z0-9]+(-[a-z0-9]+)*$` lo impide), y `max(60)` está por debajo del límite
  de 63 caracteres por label. De paso, `--` imposible significa que un slug
  nunca puede empezar con `xn--` (punycode), lo que cierra una clase entera de
  homógrafos.
- `www`, `admin`, `api`, `backoffice`, `_next`, `assets`, `static`, `storage`,
  `auth`, `app` **ya están**.

Nota de diseño: se mantiene el CHECK con `not in (...)` en vez de mover la
lista a una tabla. Una tabla sería una **tercera** fuente de verdad y
necesitaría RLS y grants propios; un CHECK no se puede esquivar por ningún
camino y no tiene superficie de API. Se paga con una migración de swap de
constraint cada vez que se agrega uno, que es el precio que CLAUDE.md ya decidió
pagar.

**Riesgo de la migración**: `add constraint` valida contra las filas
existentes. En hosted no hay filas (§2.4) y el seed local usa `la-birra`, que no
colisiona. Reversible: la migración inversa es el CHECK anterior.

### 5.6 Desarrollo local: explícitamente sin cambios

**Fuera de alcance por decisión del dueño del producto.** En local se sigue
usando `localhost:3000/[slug]`, tal cual funciona hoy.

Lo que eso implica concretamente, y que hay que respetar al implementar:

- **`allowedDevOrigins` no se toca.** No hay hosts locales nuevos, así que no
  hace falta `'*.localhost'`.
- **No se agrega ningún script de npm** ni variante de `next dev`.
- **`NEXT_PUBLIC_STORE_HOST_MODE` no se setea en local**, y por eso su default
  es `path` (§5.2). El desarrollador no tiene que saber que la variable existe.
- **El regex de host del rewrite cubre solo `comandapp.ar`.** Sin variante
  `.localhost`. En local el rewrite y el 308 son inertes.
- No se documenta ningún flujo local nuevo en CLAUDE.md — lo que sí se
  documenta es que **el subdominio no se prueba en local, a propósito**, para
  que nadie lo lea como un bug y "lo arregle".
- Mercado Pago sigue sin poder probarse de punta a punta en local, igual que
  hoy: `back_urls` rechaza `localhost` y exige HTTPS. No es una regresión de
  este cambio.

La consecuencia —que el rewrite solo se ejercita en producción— está tratada en
§2.6, y es lo que hace obligatorio el checklist de smoke de §7.

### 5.7 Preview deployments (pregunta 6)

No requieren trabajo, solo verificación. El rewrite y el redirect están
condicionados por `has: host`, y en `<proyecto>-<hash>-<scope>.vercel.app` ese
host no matchea `comandapp.ar`. O sea que en preview:

- no hay rewrite: `/[store]` se sirve path-based como hoy;
- no hay 308: `comandapp.ar/[slug]` no aplica porque el host es otro;
- `NEXT_PUBLIC_STORE_HOST_MODE` se deja **sin setear** (o en `path`) en el
  entorno Preview del proyecto de Vercel, y los mails de un preview siguen
  apuntando a URLs path-based que resuelven.

Es una precondición de configuración del proyecto, no código, y va con un test
que la prueba (T3 evalúa la tabla contra un host de preview).

### 5.8 Slug inexistente (pregunta 8)

`noexiste.comandapp.ar/` → rewrite → `/noexiste` → `src/app/[store]/layout.tsx`
llama a `getStoreBySlug` → `notFound()` → se renderiza
`src/app/[store]/not-found.tsx`. **Ya es el 404 de la app y no hace falta
código nuevo.** Lo único que hay que garantizar es que el request llegue: eso
depende del dominio wildcard estando asociado al proyecto (precondición P2), y
está en el checklist de smoke.

El caso `noexiste.comandapp.ar/pedido/<token>` lo cubre §5.4.

---

## 6. Cross-cutting

### Seguridad y aislamiento multi-tenant

- **Ninguna superficie de auth en hosts de tenant.** El 308 de
  `/admin|/backoffice|/repartidor` al apex lo hace explícito en vez de
  implícito.
- **Nada de wildcard en la allowlist de redirect de Supabase** (§3.5). Es la
  regla más importante de este documento en términos de blast radius.
- **Las cookies siguen host-only**, y eso pasa a ser una invariante escrita y
  testeada, no una propiedad accidental de la librería: `@supabase/ssr` 0.12.5
  **sí soporta** `cookieOptions.domain`; lo único que nos salva es que el repo
  no lo pasa. El test correcto no es un grep: se corre el proxy con un request
  falso y se afirma que ningún `Set-Cookie` trae el atributo `Domain=`.
- **Un slug ahora es un hostname.** Cualquier cambio futuro al regex de
  `slugSchema` es un cambio de superficie DNS. Va anotado en el schema.
- Vercel recomienda anotar `comandapp.ar` en la **Public Suffix List** para que
  el browser impida por sí mismo una cookie con `Domain=comandapp.ar`. Defensa
  en profundidad; opcional, y en la práctica irreversible.
- `frame-ancestors 'none'` global se mantiene. El carve-out de
  `previewFrameHeaders()` es path-based y con `?preview=brand`: en un host de
  tenant esas `source` no matchean, y **está bien que no matcheen** porque el
  iframe vive en el apex. Que nadie lo "arregle" agregando formas de
  subdominio: eso volvería embebible la vitrina del tenant.

### Invariantes de plata y estado

Ninguna cambia. El único punto de contacto es §2.2: el vaciado del carrito y el
descarte de la clave de idempotencia dependen del origen, y el diseño los
mantiene en el mismo. Eso hay que probarlo, no asumirlo.

### Modos de falla y rollback

| Falla | Síntoma | Mitigación |
|---|---|---|
| Rewrite catch-all se lleva `/_next/*` | La app no hidrata; se lee como "diseño roto en mobile" | Allowlist explícita (4.B) + test de que `/_next/static/...` no matchea |
| El rewrite de `/` no gana contra `src/app/page.tsx` | **Cada tienda sirve la landing de la plataforma en su home.** Un 200 que miente | `beforeFiles` (§4.A) + criterio de aceptación explícito en T3 |
| Un link interno queda con `/${slug}` | 404 en el subdominio | Test de barrido sobre `src/views/storefront/**` |
| `back_urls` al apex | Carrito y clave de idempotencia no se descartan (§2.2) | Test del adapter de MP sobre el host de `back_urls` |
| Wildcard SSL sin nameservers en Vercel | El subdominio no resuelve o da error de cert | Precondición P2, bloqueante duro |
| Mover el DNS a Vercel sin recrear los registros de Resend | **El magic link deja de salir y nadie entra a `/admin`** | Precondición P1 |

**Rollback**: instant rollback de Vercel al deployment anterior. El wildcard
puede quedar asociado sin daño: sin el código, un subdominio simplemente no
tiene rewrite y cae en `/` (la landing). Para cortar de raíz, se desasocia
`*.comandapp.ar`.

### Revalidación de cache

Nada que revalidar. `/[store]/*` ya es dinámica de punta a punta (usa el cliente
de Supabase con cookies), así que leer `headers()` en el layout no cambia su
estrategia de render. No hay `fetch` cacheado ni `use cache` en juego.

### Observabilidad

Con el rewrite solo ejercitable en producción (§2.6), esto sube de "lindo" a
"necesario": agregar el host a los contextos de log de la vitrina y del
seguimiento (`log.error(...)` ya acepta contexto). Sin eso, un reporte de "no me
anda el carrito" no se puede atribuir a un host. Es una línea por call site.

### Metadata y SEO

- **`metadataBase` no existe hoy** y con dos orígenes posibles pasa a importar:
  sin él, cualquier URL relativa en `openGraph`/`icons` se resuelve contra un
  origen que Next infiere, y en el subdominio va a inferir mal. Se setea en
  `generateMetadata` de `[store]/layout.tsx` (origen de la tienda) y en
  `pedido/[token]`.
- **Contenido duplicado**: lo resuelve el 308 de §4.D. No hace falta `canonical`
  además, y ponerlo sin necesidad es una fuente más de desincronización.
- **`sitemap.ts` / `robots.ts` quedan explícitamente fuera de alcance.** No
  existen hoy, así que agregarlos no es "mantener" nada: es una feature nueva y,
  encima, una que tendría que ser host-aware (leer `headers()`) para no servir
  el mismo sitemap en 200 hosts. Se anota como trabajo posterior con su plan.

### Relación con el plan hermano de rate limiting

El diseño de hosts **sí** cambia cosas para
`docs/pipelines/2026-08-29-rate-limiting/`, y conviene que lo sepan:

1. Después de este cambio el tráfico queda **partido por host**: clientes
   anónimos en `*.comandapp.ar`, paneles/webhooks/crons en `comandapp.ar`. Eso
   permite reglas de firewall con blast radius acotado en vez de una global.
2. **`host` sí es un tipo de condición del WAF de Vercel** ("Request
   hostname"), igual que `environment` (preview/production). Se puede *scopear*
   una regla a un host.
3. **Pero la clave de conteo del rate limit no puede ser el host**: los valores
   documentados son `ip` (default), `ja4` y `header:<name>`; en Hobby/Pro solo
   IP y JA4. Un bucket por tienda con reglas del WAF chocaría además contra el
   límite de reglas del plan. Si se quiere un bucket por tienda —lo natural para
   el abuso de `/_next/image`, porque las fotos son por local— el camino
   documentado es el SDK `@vercel/firewall` con un `rateLimitKey` compuesto
   (`${slug}:${ip}`), que se puede armar desde el código porque el slug ya está
   resuelto.
4. Los contadores del rate limit de Vercel se llevan **por región**. Con
   `regions: ["gru1"]` hoy es una sola región, así que no muerde — pero es una
   premisa que se rompe sola el día que se agregue otra.

---

## 7. Preguntas abiertas, precondiciones y checklist

**Precondiciones operativas (no son tareas de código, y bloquean el deploy a
producción):**

- **P1 — Secuencia del DNS.** Mover los nameservers de `comandapp.ar` a Vercel
  es obligatorio para el wildcard (§3.4) y **se lleva puesta toda la zona**. Los
  registros de Resend (SPF, DKIM, y el CNAME/MX del subdominio de envío) viven
  en esa misma zona. Si no se recrean en Vercel **antes** de cambiar los NS, el
  magic link deja de salir y nadie puede entrar a `/admin`, con un síntoma que
  no menciona el DNS en ningún lado. Orden: inventariar la zona actual →
  recrear todo en Vercel → cambiar NS → verificar entrega real de Resend →
  recién ahí asociar el wildcard.
- **P2 — `*.comandapp.ar` asociado al proyecto de Vercel** con nameservers de
  Vercel, y el apex + `www` también.
- **P3 — `.ar`**: confirmar con NIC.ar las reglas vigentes del segundo nivel
  `.ar` directo y el requisito de CUIT/CUIL.
- **P4 — Variables de entorno del proyecto**: `NEXT_PUBLIC_SITE_URL` =
  `https://comandapp.ar` y `NEXT_PUBLIC_STORE_HOST_MODE` = `subdomain` **solo en
  Production**. En Preview, sin setear.
- **P5 — Supabase Auth (dashboard del proyecto hosted)**: `Site URL` =
  `https://comandapp.ar`; `Redirect URLs` con
  `https://comandapp.ar/backoffice/auth/callback` **exacto**. **Sin wildcard de
  `*.comandapp.ar`** (§3.5).
- **P6 — Google Cloud Console**: el redirect URI autorizado sigue siendo el
  callback del **proyecto de Supabase**, no el de la app, así que no cambia.
  Verificar igual antes del deploy.

**Checklist de smoke en producción (obligatorio, porque el rewrite no se puede
ejercitar antes — §2.6). Se hace antes de anunciarle el cambio a ningún local:**

1. `https://la-birra.comandapp.ar/` sirve la carta de La Birra, **no** la
   landing de la plataforma, y con certificado válido.
2. Navegar carta → producto → carrito → checkout sin salir del subdominio y sin
   un solo 404.
3. Ver la fuente: los `href` internos no contienen el slug.
4. `https://comandapp.ar/la-birra` responde 308 a
   `https://la-birra.comandapp.ar/`.
5. `https://comandapp.ar/admin/apariencia` muestra la vista previa de marca
   dentro del iframe, y navegar adentro del iframe sigue funcionando.
6. `https://noexiste.comandapp.ar/` devuelve el 404 **de la app**.
7. `https://la-birra.comandapp.ar/admin` responde 308 al apex.
8. Un pedido real de prueba: el mail y el WhatsApp llevan al subdominio, el pago
   vuelve al subdominio, y **el carrito queda vacío después**.
9. Un magic link real llega y entra a `comandapp.ar/admin`.

**Preguntas para el dueño del producto:**

1. **¿Se hace ahora?** §2.4: el costo sube mucho después del lanzamiento. Si la
   respuesta es "después", conviene saberlo ya porque cambia la prioridad.
2. **"Mis pedidos" pasa a ser por tienda** (§5.1). Es más coherente con "marca
   propia", pero es un cambio de comportamiento observable. ¿Se acepta?
3. **¿Se quiere `www.comandapp.ar`?** Está en `RESERVED_SLUGS`, pero hay que
   decidir si redirige al apex o no existe.
4. **Public Suffix List**: ¿se pide la inclusión de `comandapp.ar`? Defensa en
   profundidad real y en la práctica irreversible.
5. **§2.6**: ¿se acepta que la primera ejecución real del rewrite sea en
   producción, cubierta por tests de configuración y el checklist de arriba?
6. **§4.A**: Vercel recomienda `proxy.ts` para este caso, y el motivo original
   para descartarlo resultó falso. La recomendación sigue siendo
   `next.config.ts` por testeabilidad en CI y blast radius. ¿Se confirma la
   divergencia, sabiendo que con `custom_domain` van a convivir dos
   mecanismos?

**Supuestos declarados:**

- El proyecto de Supabase hosted está vacío porque todavía no se desplegó nada,
  no porque el MCP esté apuntando a otro proyecto. Si en realidad hay un
  proyecto de producción distinto, §2.4 se cae y hay que rehacer esa sección.
- El slug de la tienda es estable. Renombrar un slug ya rompía links; con
  subdominios rompe además un hostname. No hay hoy UI de renombre y este plan no
  la agrega.
- No hay tests de `next.config.ts` hoy: los tests de routing de T9 son
  infraestructura nueva para el `test-engineer`.
