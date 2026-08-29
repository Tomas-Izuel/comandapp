# T6 — El 429 que ve la persona

**Lane**: `frontend` · **Agente**: `frontend-react-craftsman` · **Estado**: hecho

## Qué se tocó (y qué no)

De los 6 archivos listados como propiedad exclusiva, se **editaron 2**:

- `src/views/storefront/checkout-form.tsx`
- `src/views/admin/shared/confirm-with-code.tsx`

Los otros 4 se auditaron y se dejaron **sin cambios**, a propósito:

- `src/views/admin/acceso/request-link-form.tsx` — por diseño explícito del
  plan: el magic link devuelve siempre el mismo mensaje, exista el email o no,
  esté limitado o no. Cualquier estado visible de "límite alcanzado" lo
  convierte en oráculo de qué emails tienen panel en qué local. Verificado
  contra `requestMagicLinkAction` (`src/controllers/admin.actions.ts`): el
  camino de rate limit hace `log.warn(...)` y devuelve `{ ok: true, data:
  undefined }` — la misma respuesta que el caso feliz. El componente ya
  muestra siempre "Si `<email>` está en el staff de un local, te llegó un link
  nuevo" sin ninguna rama nueva que abrir.
- `src/views/courier/request-link-form.tsx` — mismo mecanismo y misma acción
  (`requestMagicLinkAction(email, 'courier')`), mismo motivo.
- `src/views/backoffice/store-detail.tsx` — no tiene ningún formulario propio.
  El único punto donde se muestra el resultado de una Server Action
  rate-limitable relacionado con esta vista es `resendOwnerInviteAction`, pero
  quien lo llama y lo muestra es `src/views/backoffice/copy-login-link.tsx`
  (fuera de mi propiedad, no listado en el brief). Ese componente ya muestra
  `result.error` tal cual en un `toast.error(...)` cuando `!result.ok` —
  cumple el criterio "mensaje del `ActionResult` tal cual" sin que yo lo toque.
  Si el reviewer quiere que ese archivo también quede bajo este slice, es un
  cross-lane a resolver con el hilo principal, no algo que yo debía tocar bajo
  "NADA MÁS".

`src/views/admin/repartidores/invite-courier-form.tsx` se auditó también:
ya muestra `errors.root.message` (viene de `result.error` de
`inviteCourierAction`) tal cual, con `role="alert"`, sin copy propio. No
necesitaba cambios — es exactamente el patrón que pide el punto 2 del brief.

## Cambios hechos

### 1. `checkout-form.tsx` — el 429 de `POST /api/orders`

El manejo de error de `handleSubmit` ya era genérico (`!res.ok` → `setFormError(body.error)`)
y ya cumplía, sin cambios, tres de los cuatro requisitos duros del punto 1 del
brief:

- **El carrito no se toca.** El código nunca llama `clear()` en la rama de
  error; solo se vacía al ver el pedido pagado (`clearResolvedOrderCart`, en
  `lib/cart.tsx`, fuera de mi lane).
- **La `idempotencyKey` no se regenera.** `ensureIdempotencyKey()` devuelve la
  misma clave mientras el carrito no cambie (`idempotencyKeyRef` en
  `lib/cart.tsx`); un reintento del mismo submit la reusa tal cual, que es lo
  que la idempotencia del backend (`orders(store_id, idempotency_key)` único)
  necesita para no duplicar el pedido.
- **El botón queda habilitado.** `setSubmitting(false)` corre en la rama de
  error antes del `return`, y `disabled` del botón depende de `submitting`
  (entre otras condiciones ya `true`/`false` independientes del error).

Lo único que faltaba: el mensaje no tenía `aria-live` explícito. El `Alert` de
shadcn ya trae `role="alert"` (que es, por spec, una región viva asertiva
implícita), pero agregué `aria-live="assertive"` explícito en el `Alert` que
envuelve `formError` porque, a diferencia de un mount fresco, un **segundo**
error en el mismo lugar (ej. dos 429 seguidos) actualiza el texto de un nodo
que ya estaba montado — ahí es donde un lector de pantalla puede no
re-anunciar sin el atributo explícito. Sin código nuevo de detección de
"es un 429 específicamente": el mismo camino de error genérico ya sirve al
429, porque el mensaje visible es el que arma `RateLimitError` en el backend
(`src/lib/errors.ts` → `toApiError`), no algo que este componente decida. No
inventé copy nuevo para el 429: se muestra `body.error` tal cual, como pide el
brief para los mensajes de origen `DomainError`/`RateLimitError`.

No leí el header `Retry-After` de la respuesta ni construí un countdown: el
mensaje que ya arma el backend para `order:phone`
(`"Estás mandando pedidos muy seguido. Esperá un minuto y probá de nuevo."`,
en `src/app/api/orders/route.ts`) ya dice qué hacer y da una noción de cuándo,
y agregar un segundo texto derivado del header hubiera sido copy propio
encima del que ya es interfaz.

### 2. `confirm-with-code.tsx` — paso `request-failed`

Mismo ajuste de accesibilidad, no de lógica: el mensaje de
`{ step: 'request-failed' }` (que puede venir de `payment_change:store`
excedido, vía `requestChange()` → `ConfirmWithCode`) ya se mostraba tal cual
con `role="alert"`, pero sin `aria-live`. A diferencia de `codeError` (que sí
lo tenía, unas líneas más abajo en el mismo archivo), este mensaje aparece
**dentro de un diálogo que ya está abierto** (el paso anterior, `requesting`,
ya lo tenía montado) — no hay remount del `Dialog` que dispare el anuncio
solo. Agregué `aria-live="assertive"` para que quede consistente con el
patrón que el propio archivo ya usaba en `codeErrorId`.

No toqué la lógica de `handleConfirm`/`handleResend`: ya muestran
`result.error` (o `result.fieldErrors?.code?.[0]`) tal cual, sin copy propio.

## Contratos consumidos, sin tocar

- `ActionResult<T>` (`src/models/types.ts`) — sin cambios, tal como pedía el
  brief.
- `RateLimitError` / `toApiError` (`src/lib/errors.ts`) — ya devuelven
  `{ error, field? }` + header `Retry-After` para status 429; consumido tal
  cual desde `checkout-form.tsx` vía `res.json()`, sin parsear el header (ver
  arriba, decisión de no construir countdown).
- `RATE_LIMIT_POLICY` / `RateLimitBucket` — no los importé ni los necesité:
  todo lo que el frontend hace es mostrar el mensaje que ya llega armado.

## Verificación

- `npm run typecheck` — limpio.
- `npm run lint` — limpio (los 6 warnings preexistentes son de
  `tests/**`, de otro agente, no de este slice).
- El hook de `impeccable` corrió tras cada edición: "No deterministic
  design-quality issues found" en ambos archivos. No hubo hallazgos que
  actuar.
- No hay entorno con Docker/Supabase local levantado en esta sesión, así que
  no pude ejercitar un 429 real de punta a punta contra `POST /api/orders`. La
  verificación fue por lectura del código real de
  `src/app/api/orders/route.ts` (ya con `enforceOrderRateLimits` +
  `RateLimitError` aplicado por el agente de T3, visto en el diff concurrente
  durante esta sesión) y de `src/lib/errors.ts` (`toApiError`), confirmando
  que la forma de la respuesta (`{ error }` + status 429 + header
  `Retry-After`) es la que `checkout-form.tsx` ya sabe consumir por el camino
  de error genérico.

## Spec para `test-engineer` — comportamiento visible a probar

1. **Checkout, 429 de `POST /api/orders`** (criterios 1 y 2 del brief):
   - Con un carrito no vacío y datos válidos, si el fetch a `/api/orders`
     responde `429` con `{ error: '<mensaje>' }`, el formulario muestra
     `<mensaje>` dentro de un elemento con `role="alert"` (buscar por
     `getByRole('alert')`, no por clase), **sin** desmontar el formulario ni
     vaciar ningún campo.
   - El botón de submit (`getByRole('button', { name: /ir a pagar|confirmar
     pedido/i })`) sigue **habilitado** después del 429 (no queda en estado
     "Confirmando…").
   - Un segundo submit inmediatamente después reutiliza el **mismo**
     `idempotencyKey` que el primero (se puede verificar interceptando el
     `body` de las dos llamadas a `fetch('/api/orders', ...)` y comparando
     `idempotencyKey`), y **no** se llama a ninguna función de vaciar el
     carrito entre medio.
   - Las líneas del carrito (`useCart().lines`) siguen iguales antes y
     después del 429.
2. **Magic link, `/admin/acceso` y `/repartidor`** (criterio 3): pedir el link
   para (a) un email inexistente, (b) un email real de staff/repartidor, y (c)
   un email que ya agotó el balde — comparar que las tres veces el componente
   termina en el mismo estado `sent` con el mismo texto
   ("Si `<email>` está en el staff de un local, te llegó un link nuevo...").
   No existe ninguna rama de UI que distinga el caso (c): si el test encuentra
   una, es una regresión de otro agente, no de este slice.
3. **Invitar repartidor / reenviar / código de pago**: forzar que la Server
   Action devuelva `{ ok: false, error: '<mensaje del backend>' }` (mockeando
   `inviteCourierAction`, `resendCourierInviteAction`,
   `confirmPendingChangeAction` o `resendPendingChangeCodeAction`) y verificar
   que el `<mensaje del backend>` aparece **tal cual**, en un nodo con
   `role="alert"`, sin texto agregado por el componente.
4. Cero data fetching en estos componentes: todos siguen recibiendo datos por
   props o disparando Server Actions / `fetch` solo en respuesta a un evento
   de usuario (submit, click), nunca en un efecto de carga.

## Deferidos / cross-lane

- `src/views/backoffice/copy-login-link.tsx` no está en mi lista de propiedad
  exclusiva pero es donde realmente se muestra el resultado de
  `resendOwnerInviteAction` (bucket `owner_invite:*`). Ya cumple el patrón
  pedido (mensaje tal cual, sin copy propio) — no requiere cambios, pero lo
  dejo anotado para que quede explícito que se revisó.
- No se agregó ningún primitivo nuevo a `src/views/shared/surfaces.tsx`: no
  hizo falta.
