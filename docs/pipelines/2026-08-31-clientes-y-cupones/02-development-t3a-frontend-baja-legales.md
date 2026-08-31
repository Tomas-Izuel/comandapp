# T3A — Frontend: la baja pública y los textos legales

Agente: `frontend-react-craftsman`. Rama `feat/clientes-y-cupones`. Corrió en
paralelo con el agente de `/admin/clientes` (T2A) — cero archivos compartidos.

## Qué se construyó

### `/baja/[token]` (nueva, nivel raíz, sin auth)

- `src/app/baja/[token]/page.tsx` — Server Component. Llama a
  `getUnsubscribeTargetAction(token)` (de `@/controllers/unsubscribe.actions`,
  escrito por el agente de backend en paralelo) y colapsa el resultado a
  `{ storeName } | null` antes de pasarlo a la vista. **No** distingue "token
  inválido" de "ya estaba dado de baja" ni de "balde `unsubscribe:ip`
  agotado": los tres se pasan como `null` — la vista los muestra idénticos, a
  propósito (criterio de aceptación #3).
- `src/app/baja/[token]/one-click/route.ts` — el `POST` de RFC 8058
  (one-click, `List-Unsubscribe-Post`), en un **path propio**, distinto de
  `/baja/[token]`. Llama a `confirmUnsubscribeAction(token)` y devuelve
  **siempre** `200` con body vacío (`new NextResponse(null, {status: 200})`).
  Como `confirmUnsubscribeAction` pasa por `toActionResult` y nunca tira, no
  hay rama de error que manejar — es lo mismo que exige el estándar y lo mismo
  que evita que el endpoint sirva de oráculo de qué tokens existen. También
  exporta `GET`, que redirige (307) a `/baja/[token]` sin dar de baja a nadie
  — el RFC exige que la URI del one-click sea navegable, y un GET que diera de
  baja violaría el requisito central del slice.

  **Por qué en un path separado, y no en `/baja/[token]` como se armó
  originalmente:** un `page.tsx` y un `route.ts` en el mismo path atienden la
  misma URL sin forma de que Next decida cuál gana — es un error de
  *arranque* (`Conflicting route and page at /baja/[token]`), no de
  compilación, así que ni `typecheck` ni `lint` lo detectan y tumbaba **toda**
  la app con 500 en cualquier ruta. Lo encontró el coordinador levantando
  `npm run dev`; el fix (separar el one-click a su propio path y dejar
  `/baja/[token]` como página sola) fue una propuesta del coordinador que
  evalué y apliqué tal cual — es la única forma de resolver el choque
  RFC-8058-vs-router sin sacrificar ni el Server Component de la página ni el
  contrato de "GET nunca da de baja".

  **Consecuencia para quien escriba el mail de campaña en la Entrega B
  (T5B):** la URL del CUERPO del mail (el link que ve la persona) sigue
  siendo `/baja/{token}`. La URL del header `List-Unsubscribe` (junto con
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) tiene que ser
  `/baja/{token}/one-click`, **no** la misma que el cuerpo. Si se invierten,
  el botón de one-click de Gmail/Outlook deja de funcionar sin ningún error
  visible — queda documentado también como comentario en el propio
  `route.ts`.
  **No** es la ruta que usa el botón humano de la página (ver abajo).
- `src/views/unsubscribe/unsubscribe-view.tsx` — Server Component
  presentacional puro (props, cero fetch). Sin tema de marca: usa
  `bg-background`/`text-foreground` (los tokens neutros de shadcn, los mismos
  que `/admin` y `/legal`), nunca `buildThemeCss`. Reutiliza `SiteFooter` de
  `src/views/shared/site-footer.tsx` para los links legales — ya es
  plataforma, no vitrina, así que no hace falta un footer nuevo.
- `src/views/unsubscribe/unsubscribe-button.tsx` — Client Component, único
  tramo interactivo. `useTransition` + `confirmUnsubscribeAction` (mismo
  patrón que `RequestCourierLinkForm`), con tres estados: reposo (nombre del
  local + botón), error (banda `role="alert"`) y confirmado (`CircleCheck` +
  copy final). Llama a la Server Action **directo**, no al `route.ts`: ese
  archivo es para el `POST` automático de los clientes de mail sin JS, acá hay
  una persona tocando un botón.

### `/legal/privacidad`

Sección nueva **"El padrón del local"** (entre "Quién ve tus datos" y "Qué
guardamos en tu navegador"): qué guarda cada local (nombre, teléfono, mail
opcional, cantidad de pedidos, gasto total, fecha del último), que es **por
local** y no se comparte, que el mail habilita promos, cómo funciona la baja
(inmediata para los envíos de la plataforma, no para el WhatsApp manual del
local), y la retención escrita con honestidad: *"mientras el local use la
plataforma"*, sin plazo inventado.

Sección **"Los emails"** enmendada: agregada una frase que reconoce que el
local puede usar el mail para promos, con referencia cruzada a la sección
nueva.

Sección **"Tus derechos"** — **sin tocar**, tal como pedía el plan: sigue
siendo el canal manual por mail (Ley 25.326), que es cierto y se mantiene. No
se agregó nada que sugiera autoservicio de borrado — no existe ese camino de
producto (00-architecture.md §5.12.5.1).

Comentario de archivo actualizado para dejar por escrito el porqué de la
sección nueva y la restricción de copy, así el próximo que la toque no
"complete" un plazo o un borrado que no está.

### `/legal/terminos`

Sección nueva **"Cupones y promociones"** (entre "Precios y disponibilidad" y
"Cancelaciones, reclamos y devoluciones"): un cupón es oferta **del local**,
con sus condiciones/vencimiento/tope, el local lo puede pausar, y la
plataforma no lo financia ni garantiza su disponibilidad. Describe una
capacidad que llega en la Entrega B — a propósito, es "prematuro" pero no
falso, que es la asimetría que el plan pide respetar (a diferencia del aviso
de consentimiento del checkout, que si se adelantara sería una afirmación
falsa).

Fecha de "Última actualización" de ambas páginas legales llevada a 31 de
agosto de 2026.

## Contratos consumidos (no autorados por mí)

- `getUnsubscribeTargetAction(token): Promise<ActionResult<UnsubscribeTarget>>`
- `confirmUnsubscribeAction(token): Promise<ActionResult<void>>`
- `UnsubscribeTarget = { storeName: string; alreadyOptedOut: boolean }` (en
  `src/models/types.ts`)

Ambas viven en `src/controllers/unsubscribe.actions.ts`, propiedad del agente
de backend en paralelo. Nota para quien audite: ese archivo mezcla una lectura
(`getUnsubscribeTargetAction`) y una escritura (`confirmUnsubscribeAction`) en
un mismo `.actions.ts`, lo que en el resto del repo normalmente se separaría
en `.controller.ts` (lecturas) + `.actions.ts` (acciones) — no es algo que yo
haya decidido ni que me corresponda tocar (no soy dueño de `controllers/`), lo
dejo señalado como posible observación de revisión, no como bug de mi slice.

Recibí una corrección de contrato a mitad de tarea (el campo pasó de
`displayName` —nombre del cliente— a `storeName` —nombre del local—, y el tipo
se movió de `customer.model.ts` a `types.ts`) y ya estaba resuelta en el
archivo cuando llegué a usarla; mi código consume la forma final
(`storeName`, importado indirectamente vía la firma de la acción, sin
necesidad de importar el tipo desde `models/` en la page).

## Comportamiento visible / spec para el test engineer

- `GET /baja/<token-válido-no-usado>` → muestra el nombre del local y un botón
  "Darme de baja". **No** cambia `marketing_opt_out_at`.
- `GET /baja/<token-inválido>` y `GET /baja/<token-ya-dado-de-baja>` → **la
  misma pantalla genérica** ("Nada pendiente en este link"), sin nombre de
  local, sin botón de acción.
- Click en "Darme de baja" → llama a `confirmUnsubscribeAction`, muestra
  spinner mientras está pendiente (`disabled` en el botón), y al resolver
  reemplaza el contenido por la confirmación ("Listo, ya estás afuera") sin
  navegar. Si la acción devuelve `ok: false` (ej. rate limit), muestra el
  mensaje de error en `role="alert"` y el botón vuelve a estar disponible
  (no se pierde el estado "reposo").
- `POST /baja/<token>` (sin pasar por el botón, ej. `curl -X POST`) → siempre
  `200` con body vacío, sea el token válido, inválido, o ya usado.
- Accesibilidad: un solo `<h1>` por estado renderizado; los tres íconos
  decorativos (`BellOff`, `MailX`, `CircleCheck`) llevan `aria-hidden`; el
  botón usa `<button>` real (vía `Button` de shadcn) con `disabled` durante
  `pending`, altura `h-11` (44px, piso táctil); el error usa `role="alert"`
  para que un lector de pantalla lo anuncie sin polling.
- `/legal/privacidad` y `/legal/terminos` son estáticas (`export default
  function`, sin `'use client'`, sin data fetching): cualquier test de
  contenido puede renderizarlas directo, sin mocks de Supabase.

## Qué NO toqué (y por qué)

- `src/views/storefront/checkout-form.tsx` — no aparece en el diff. El aviso
  de consentimiento junto al campo de email va en la Entrega B (T5B): en la
  Entrega A no existe ninguna forma de mandar una promo, así que agregarlo
  ahora sería decirle al cliente algo falso.
- `src/views/admin/**`, `src/models/**`, `src/controllers/**`,
  `supabase/migrations/**`, `tests/**` — fuera de mi lane.

## Verificación

- `npx next typegen` (necesario para que `PageProps<'/baja/[token]'>` y
  `RouteContext<'/baja/[token]'>` existan — la ruta es nueva, `.next/types`
  no la tenía) — regenerado en verde.
- `npm run typecheck` — verde.
- `npm run lint` — verde.
- Hook de `impeccable` corrido tras cada edición de UI: sin hallazgos
  mecánicos en los cuatro archivos de vista/página.
- **`npm run dev` levantado y probado de verdad** (después del bloqueante de
  arranque, ver arriba). Con un token real (`select unsubscribe_token from
  store_customers ...`, restaurado a `marketing_opt_out_at = null` al
  terminar):
  - `GET /la-birra`, `/legal/privacidad`, `/legal/terminos`, `/mis-pedidos` →
    `200`, sin el 500 global que causaba el choque de rutas.
  - `GET /baja/<token-válido-sin-baja>` → `200`, muestra "Darte de baja de La
    Birra Burgers".
  - `GET /baja/<token-inválido>` → `200`, muestra "Nada pendiente en este
    link" (misma pantalla que un token ya dado de baja).
  - `GET /baja/<token>/one-click` → `307` a `/baja/<token>`, **sin** tocar
    `marketing_opt_out_at` (verificado contra Postgres antes y después).
  - `POST /baja/<token>/one-click` → `200`, body de 0 bytes, `marketing_opt_out_at`
    pasa a tener timestamp.
  - Segundo `POST /baja/<token>/one-click` (mismo token, ya dado de baja) →
    `200`, body de 0 bytes, sin error — confirma la idempotencia.
  - `GET /baja/<token>` después de la baja → `200`, ahora muestra la pantalla
    genérica, no el nombre del local — confirma que el estado "ya dado de
    baja" es indistinguible de "token inválido" también en runtime, no solo
    en el código.

## Follow-ups / no cerrado

- Ninguno del lado de este slice. Si el auditor de arquitectura quiere separar
  `unsubscribe.actions.ts` en lectura/escritura, es un cambio en
  `controllers/`, fuera de mi propiedad.
