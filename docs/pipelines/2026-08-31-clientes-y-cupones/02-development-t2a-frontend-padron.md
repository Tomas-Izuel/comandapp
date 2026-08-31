# T2A — Frontend: `/admin/clientes` (el padrón)

Agente: `frontend-react-craftsman`. Rama: `feat/clientes-y-cupones`.

## Archivos nuevos

- `src/app/admin/(app)/clientes/layout.tsx` — `PageFrame title="Clientes" width="table"` + `ClientesTabs`. No resuelve sesión.
- `src/app/admin/(app)/clientes/page.tsx` — `resolveAdminSession()` + gate `role === 'owner'`, llama al controller, renderiza `CustomerDirectoryView`.
- `src/views/admin/clientes/clientes-tabs.tsx` — sub-nav "Padrón" / "Cupones", calco de `views/admin/ajustes/settings-tabs.tsx`. La tab "Cupones" apunta a `/admin/clientes/cupones`, que todavía no tiene `page.tsx` (lo agrega T4B) — es un link muerto hasta que ese slice se integre, esperado.
- `src/views/admin/clientes/customer-directory.tsx` — orquesta: línea de tres números, `SearchField` (filtro cliente-side por nombre/teléfono), cabecera de columnas, lista de `CustomerRow`, y monta `CustomerSheet`. Los tres estados (vacío real, sin resultados de búsqueda, con contenido) están acá.
- `src/views/admin/clientes/customer-row.tsx` — una fila del padrón, con `IdentityCell`/`ContactCell`/`ContactIconButton` como sub-componentes locales.
- `src/views/admin/clientes/customer-sheet.tsx` — hoja de detalle (`vaul`, `direction="right"`, mismo patrón que `catalogo/product-drawer.tsx`): primera compra, gastado, pedidos, cancelados, nota editable, toggle de baja de promos.
- `src/views/admin/clientes/format.ts` — `relativeLastOrderLabel()` y `firstToken()`, puros y locales a esta carpeta (no tocan `src/lib/dates.ts`, que no es de este slice).
- `src/views/admin/clientes/whatsapp-message.ts` — `buildCustomerWhatsappMessage()`, los dos mensajes de la Entrega A.

## Archivo modificado

- `src/views/admin/shell.tsx` — sumé `{ href: '/admin/clientes', label: 'Clientes', icon: Users, ownerOnly: true }` entre "Métricas" y "Apariencia", y corregí las tres menciones a "siete secciones" → "nueve secciones" (ya eran ocho antes de este cambio, no siete; el comentario venía desactualizado).

## Contratos consumidos

- `StoreCustomer` / `CustomerDirectory` de `src/models/types.ts`, tal cual (no los redefiní).
- `getCustomerDirectoryForStore(storeId: number): Promise<CustomerDirectory>` de `@/controllers/customers.controller` — el agente de backend (T1A) lo escribió en paralelo con exactamente ese nombre y esa firma; no hizo falta reportar ninguna divergencia.
- `updateCustomerNotesAction(storeId, customerId, notes)` y `setCustomerOptOutAction(storeId, customerId, optedOut)` de `@/controllers/customers.actions`, ambas devolviendo `ActionResult<void>`.
- `whatsappHref(phoneE164, text?)` de `src/lib/whatsapp.ts` — se usa tal cual, sin armar ningún `https://wa.me/` a mano (grep limpio, ver criterios de aceptación abajo).
- `resolveAdminSession()` de `@/controllers/admin.controller` (no `resolveStaffSession()`: esa función agrega el listado de repartidores, que no hace falta acá — el precedente de `repartidores/page.tsx` que cita la tarea es sobre el *patrón* de gate por rol, no sobre qué función de sesión usar).
- `Panel`, `SearchField`, `StatusPill`, `Price` de `src/views/shared/surfaces.tsx` / `money.tsx`; `EmptyState` de `states.tsx`; `PageFrame` de `views/admin/page-frame.tsx`.

## Decisiones no obvias

**Layout dueño único de `PageFrame`, `page.tsx` no anida otro.** La tarea describía "page.tsx... `PageFrame width='table'`", pero el precedente real del repo (`ajustes/layout.tsx` + sus tres `page.tsx`, ninguno con `PageFrame` propio) deja claro que `PageFrame` se instancia UNA sola vez por árbol de página — es la pieza que existe justamente para que nadie reinvente padding/ancho por página (ver su propio comentario). Puse el único `PageFrame` en `clientes/layout.tsx` con `width="table"` (mismo criterio que pedía la arquitectura para el Padrón, y Cupones —T4B— también es una lista densa, así que comparte el mismo ancho). `page.tsx` del Padrón no renderiza `PageFrame`; solo llama al controller y pasa props a la vista. Lo dejo explícito acá por si la revisión lo mira contra la letra literal de la tarea.

**Filas duplicadas (mobile / `lg:grid`) en vez de `display:contents`.** Quería una sola grilla de 6 columnas que se reacomodara en mobile con `display:contents` en el `<button>` de identidad, pero ese truco tiene bugs de accesibilidad conocidos en Safari (un botón con `display:contents` puede perder el foco de teclado). Opté por renderizar el contenido dos veces (`lg:hidden` / `hidden lg:grid`), cada rama con su propio `<button>` de nombre acotado — accesible, sin nombres accesibles gigantes, y sin controles duplicados en el árbol de accesibilidad en ningún viewport porque `hidden` saca la rama inactiva del DOM renderizado.

**Ningún `<button>` contiene un `<a>`.** Mismo patrón que `catalogo/product-row.tsx`: el `<button onClick>` de la fila cubre solo nombre + teléfono (`IdentityCell`); los dos botones de contacto (WhatsApp, mail) son hermanos, nunca hijos de ese botón — anidar un `<a>` dentro de un `<button>` rompe el modelo de contenido de HTML.

**El aviso de cancelados vive en la celda de identidad, no en Contacto.** Con solo seis columnas y la de Contacto ya ocupada por dos botones de 44px + el `StatusPill` de "Sin promos", meter ahí también el aviso de cancelados la apretaba. Lo puse como una tercera línea (un `StatusPill` chico) debajo del teléfono en `IdentityCell` — se ve en las dos variantes (mobile y `lg`) sin competir por espacio con los botones de contacto.

**`ContactIconButton` deshabilitado, no ausente, para "Sin mail"/"Sin promos".** El botón de mail sin `email` cargado también se muestra apagado (con `aria-label` que dice "no dejó mail"), mismo criterio que pide el brief para la baja de promos: el dueño tiene que VER que el canal no está disponible, no adivinarlo por un hueco en la fila.

**Hoja de detalle: `selectedId`/`sheetOpen` separados.** Calcado de `drawer.product`/`drawer.open` en `catalogo/category-list.tsx`: al cerrar la hoja, solo cambia `sheetOpen`; `selectedId` (y por lo tanto el cliente que la hoja muestra) se mantiene durante la animación de salida de `vaul`, así no se ve un panel vacío a mitad de la transición. `CustomerSheet` deriva `notesDraft` con el patrón "ajustar estado durante el render" (no `useEffect`) para resetear el borrador de la nota solo cuando cambia de cliente — el lint de `react-hooks/set-state-in-effect` marcó la primera versión con `useEffect` como error, y este es el arreglo que React recomienda para exactamente este caso.

**No toqué `src/lib/dates.ts`.** Hacía falta un "hace 3 días" para "Última compra" y no existe ningún helper de fecha relativa en el repo. Como ese archivo no es de este slice (y otro agente podría estar tocándolo en paralelo), escribí `relativeLastOrderLabel()` local a `views/admin/clientes/format.ts` en vez de sumar un helper genérico a un archivo compartido.

**Sin menú de cupones.** `buildCustomerWhatsappMessage()` solo implementa los dos mensajes sin cupón (reactivación si `daysSinceLastOrder >= 30`, default en cualquier otro caso). El botón de WhatsApp es un link directo, sin dropdown — T4B lo va a envolver en un menú de cupones activos cuando ese slice se integre; no dejé ningún hueco de UI a medio armar para eso, para no incentivar que alguien lo complete mal.

## Comportamiento visible para el test engineer (spec)

- **Gate de acceso** (criterio de aceptación 3): sin sesión → redirect a `/admin/acceso`. Con sesión de `role: 'staff'` → redirect a `/admin`. El ítem "Clientes" del rail (`AdminShell`) no se renderiza para `role: 'staff'` (`ownerOnly: true` en `NAV_ITEMS`, filtrado por `visibleNavItems`).
- **Estado vacío real**: `directory.customers.length === 0` → `EmptyState` con título "Todavía no tenés clientes" y la descripción textual del brief.
- **Búsqueda**: `SearchField` filtra en cliente por substring de `displayName` (case-insensitive) o por dígitos de `phoneE164`. Sin resultados → `EmptyState` "Ningún cliente coincide" citando la query.
- **La tabla**: ordenada por `totalSpentCents` desc (orden que ya trae `CustomerDirectory`, no se reordena en el cliente). Columnas visibles en `lg` (`≥1024px`): Cliente, Gastado, Pedidos, Ticket prom., Última compra, Contacto. Debajo de `lg` colapsa a fila apilada: nombre + teléfono + gastado arriba, pedidos/ticket/última compra como una línea de contexto, contacto abajo.
- **Cancelados**: `StatusPill` tono `warning` con el conteo, visible únicamente si `cancelledOrdersCount >= 2`.
- **Baja de promos** (`marketingOptOutAt !== null`): `StatusPill` "Sin promos" en la celda de contacto; los botones de WhatsApp y mail quedan `disabled` (no clickeables, sin `href`) — verificable por `aria-disabled`/atributo `disabled` real del elemento `<button>`, no solo estilo.
- **WhatsApp**: `href` sale de `whatsappHref(phoneE164, text)`, `target="_blank"`, `rel="noreferrer"`. El texto precargado nunca incluye `totalSpentCents` ni ningún monto. Con `daysSinceLastOrder >= 30` el mensaje incluye el link de la tienda (`storeUrl(slug, '/')`); si no, es el saludo default.
- **Mail**: `href="mailto:<email>"` solo si `customer.email` no es `null` y el cliente no está dado de baja; si no, botón deshabilitado con `aria-label` que explica por qué ("no dejó mail" o "se dio de baja de promos").
- **Hoja de detalle**: se abre al tocar el nombre/teléfono de una fila (no un click en cualquier parte de la fila — ver decisión de accesibilidad arriba). Muestra primera compra (o "Nunca compró"), gastado, pedidos, cancelados. La nota es un `<textarea>` controlado; el botón "Guardar nota" está deshabilitado si no hay cambios o mientras guarda (`Loader2` girando), y en error muestra un `toast.error` con el mensaje del servidor sin cerrar la hoja. El toggle de promos es un checkbox con etiqueta "Recibe promociones"; cambiarlo llama a `setCustomerOptOutAction` y muestra `toast.success`/`toast.error` según corresponda; queda `disabled` mientras esa transición está en curso.
- **Revalidación**: tanto guardar la nota como cambiar la baja llaman a `onChanged` → `router.refresh()` en el padre, que vuelve a traer `CustomerDirectory` completo (la Server Action ya hace `revalidatePath('/admin/clientes')` del lado del servidor).

## Verificado

- `npm run typecheck` — verde.
- `npm run lint` — verde (una vuelta: el hook de `react-hooks/set-state-in-effect` marcó el primer intento del reset de la nota con `useEffect`; se corrigió al patrón "ajustar estado durante el render").
- El hook de `impeccable` corrió después de cada edición de UI y no reportó hallazgos mecánicos en ningún archivo.
- Grep de criterios de aceptación:
  - `grep -n "@supabase" src/app/admin/(app)/clientes/*.tsx` → sin resultados.
  - `grep -rn "@supabase\|createClient\|fetch(" src/views/admin/clientes/` → sin resultados (cero data fetching en las views).
  - `grep -rn "wa.me" src/views/admin/clientes/` → solo aparece dentro de un comentario, nunca en una plantilla de string.
  - `grep -n "totalSpentCents" src/views/admin/clientes/whatsapp-message.ts` → solo en el comentario que explica que NO se usa.

## No verificado a mano (estado al cierre de la primera vuelta)

- No corrí `npm run dev` ni miré la pantalla real en la primera entrega. **Ya
  verificado en la vuelta de corrección post-revisión** (ver sección de
  arriba): rail de nueve ítems sin scroll, cero scroll horizontal del `body`,
  y el layout apilado en mobile — los tres quedaron confirmados en browser
  real con sesión de dueño.
- Sigue sin correrse contra datos reales de `daysSinceLastOrder >= 30` (el
  único cliente semilla, "Julia Segunda", compró hoy) ni contra un cliente
  con `marketingOptOutAt` seteado (necesita `db:reset -- --orders` o un
  `UPDATE` manual); la lógica de esas dos ramas se revisó por lectura, no por
  click real. Queda para el reviewer o el test engineer con datos que las
  disparen.

## Corrección post-revisión: título del documento

El coordinador verificó en el browser con sesión de dueño real y encontró
`document.title === 'Pedidos'` en `/admin/clientes` — el tab del browser
mentía. Causa: `src/app/layout.tsx` (raíz) declara `title: 'Pedidos'` como
default de toda la app, y ninguna `page.tsx`/`layout.tsx` de `/admin/clientes`
declaraba su propia `metadata` para pisarlo.

**Arreglo**: agregué `export const metadata: Metadata = { title: 'Clientes —
Panel del local' }` a `src/app/admin/(app)/clientes/page.tsx`. El sufijo
"— Panel del local" es el único precedente real de metadata propia dentro de
`/admin` en todo el repo (`src/app/admin/acceso/page.tsx`: `'Pedir acceso —
Panel del local'`); lo repetí en vez de inventar un formato nuevo.

**Lo que encontré al verificar y que corrige la premisa del pedido**: el
coordinador pidió "mirá cómo lo declaran las otras secciones del panel
(`repartidores`, `pagos`, `ajustes`)", pero ninguna de las tres declara
metadata propia — confirmado por grep (`grep -rln "metadata" src/app/admin/`
solo devuelve `admin/acceso/page.tsx`) y por browser real: con la misma
sesión de dueño, `/admin/repartidores`, `/admin/pagos` y `/admin/ajustes`
también muestran `document.title === 'Pedidos'` hoy. No es un bug exclusivo
de este slice, es un hueco panel-wide preexistente. Lo dejo señalado para el
coordinador/reviewer — no toqué esos archivos (no son míos, y una corrección
panel-wide probablemente merece resolverse en `(app)/layout.tsx` con un
`title.template`, una decisión de arquitectura que excede este slice).

**Verificado en browser real** (sesión de dueño vía magic link administrativo,
`npm run dev` propio en :3000, `chrome-in-claude`):
- `/admin/clientes` → `document.title === 'Clientes — Panel del local'`, tanto
  entrando desde el confirm de acceso como navegando directo.
- `npm run typecheck` y `npm run lint` siguen en verde (un warning preexistente
  en `tests/db/store-customers.test.ts`, ajeno a este cambio).
- **Layout mobile, lo único que había quedado sin verificar**: con la ventana en
  500×785 (el mínimo que el tooling de browser pudo forzar, igual muy por
  debajo del breakpoint `lg` de 1024px), la fila de Julia Segunda muestra
  nombre + teléfono + $49.000,00 arriba, "2 pedidos · Prom. $ 24.500 · Hoy"
  como línea de contexto debajo, y los dos botones de contacto en su propia
  fila al pie — exactamente el criterio de aceptación de mobile. Sin scroll
  horizontal del `body` (`scrollWidth === innerWidth`, confirmado por JS).

## Follow-ups / cross-lane

- T4B tiene que envolver el botón de WhatsApp en un menú de cupones activos cuando exista `active` en el local — el punto de extensión es `buildCustomerWhatsappMessage()` (agregar un tercer caso) y el `href` en `customer-row.tsx` (agregar el trigger de un dropdown en vez de un link directo cuando haya cupones). No dejé la UI de menú a medio construir a propósito.
- Si en algún momento hace falta un helper de fecha relativa genérico ("hace N días") en otro lugar del panel, vale la pena promoverlo desde `views/admin/clientes/format.ts` a `src/lib/dates.ts` en vez de duplicarlo — hoy es local porque ese archivo no era de este slice.
