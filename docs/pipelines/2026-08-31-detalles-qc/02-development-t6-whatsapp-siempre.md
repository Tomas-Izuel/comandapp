# T6 — WhatsApp siempre presente en las dos pantallas de pedidos

Agente: `frontend-react-craftsman`, en continuación de T3/T4
(`02-development-t3-t4-admin.md`), que había cambiado el ícono de
`MessageCircle` a `WhatsApp` pero no tocó cuándo el botón aparece. Pedido del
dueño del producto: "el botón en pedidos de hablarle por WhatsApp siempre
debería estar", confirmado para **las dos** pantallas (`/admin`, el tablero, y
`/admin/pedidos`, el historial).

## Diagnóstico heredado (del coordinador, verificado antes de repartir)

- `order-card.tsx`: el botón solo existía cuando `changeStatus()` recibía un
  `notification.actionUrl` en la respuesta — o sea, nunca en la carga inicial
  del tablero, y desaparecía en el próximo refresh. Además vivía en la rama
  `else` de `blockedByPayment`, así que en "Cobrá antes de entregar" tampoco
  estaba.
- `history-list.tsx`: no existía en absoluto.
- `order.customerPhoneE164` es `string`, no nullable (`src/models/types.ts:475`)
  — confirmado de nuevo acá antes de usarlo: no hay caso "sin teléfono" que
  resolver.

## Archivos tocados

- `src/views/admin/kds/order-card.tsx`
- `src/views/admin/pedidos/history-list.tsx`
- `src/views/admin/kds/transfer-tray.tsx` (solo para consumir el helper nuevo
  y no triplicar el `replace(/\D/g, '')`; su botón ya era siempre-visible,
  no tenía el bug de T6)
- `src/lib/whatsapp.ts` (archivo nuevo)

## Módulo nuevo: `src/lib/whatsapp.ts`

`whatsappHref(phoneE164: string, text?: string): string` — arma
`https://wa.me/<dígitos>[?text=...]`. Puro, sin `server-only` (los tres call
sites son Client Components que ya reciben el teléfono en props).

## Las cinco decisiones

### 1. Peso del botón en el tablero

Antes: `Button variant="outline"` de `h-12 w-full` con texto, dentro del stack
de acciones del pie de la tarjeta. Puesto en TODAS las tarjetas de un tablero
lleno, eso son ~48px extra por tarjeta compitiendo con el botón de avance
(la acción que de verdad mueve la cocina).

**Decisión**: lo moví al HEADER de la tarjeta, como ícono solo de 44px
(`Button variant="ghost" size="icon"`), en la misma fila que el pedido
("9ETE") y el indicador de "hace X min", en vez de sumar una fila al stack de
acciones. Con esto:
- Está SIEMPRE (lo que pidió el dueño), sin excepción de estado.
- No agrega altura a la tarjeta: comparte la fila que ya existía.
- No compite con el botón de avance, que sigue siendo el único elemento
  pesado — la identidad visual del "peso primario" de la tarjeta no cambió.

El ícono usa el verde fijo del SVG de marca (`#25D366`, sin neutralizar a
`currentColor` — mismo criterio que dejó documentado T3), así que se
distingue del resto del header (todo texto, sin otros íconos) sin necesitar
tratamiento adicional.

### 2. Convivencia con "Cobrá antes de entregar"

Se resuelve sola con la decisión #1: al vivir en el header, es ortogonal a
cualquier cosa que el stack de abajo esté mostrando (el botón de avance
normal, o el bloque "Cobrá antes de entregar" + "Marcar como cobrado"). El
WhatsApp nunca compitió con esos porque ocupa una zona distinta de la
tarjeta. Antes de este cambio, el botón directamente no aparecía en este
estado (nunca había pasado por un `changeStatus` con `actionUrl`); ahora está
igual que en cualquier otro estado.

### 3. Copy / aria-label

El botón es ícono-solo (sin label visible, consistente con otros íconos-solo
del admin: `Trash2` en `schedule-editor.tsx`, `Pencil` en `product-row.tsx`,
todos con `aria-label` y sin texto). El `aria-label` sí distingue los dos
casos, porque el ícono solo no lo hace:

- Sin `actionUrl` prellenado (caso normal, chat en blanco): **"Escribirle a
  {nombre} por WhatsApp"**.
- Con `actionUrl` prellenado (`changeStatus` devolvió un mensaje de cambio de
  estado, ej. "tu pedido está listo"): **"Avisar a {nombre} por WhatsApp"**.

El link en sí prioriza el `actionUrl` prellenado cuando existe
(`waLink ?? whatsappHref(order.customerPhoneE164)`), nunca lo pisa por el
genérico — es más valioso que un chat vacío, tal como pedía el brief.

En `history-list.tsx` no hay noción de `actionUrl` (esta vista no dispara
cambios de estado), así que ahí el aria-label es siempre el genérico
"Escribirle a {nombre} por WhatsApp".

### 4. Fila del historial

Agregué una columna "Acciones" nueva al final de la tabla (después de Total),
con el mismo botón ícono de 44px. Cambié el reparto de columnas:

```
Antes:  10 / 13 / 16 / 22 / 13 / 12 / 14                (Código..Total)
Ahora:  10 / 13 / 16 / 14 / 13 / 12 / 14 / 8            (+ Acciones)
```

"Pidió" volvió a donar (ya era el donor documentado por la corrección de
anchos anterior: 29%→22%, ahora 22%→14%) porque es la única columna que
trunca con elipsis a propósito y no pierde información al ceder ancho. El
`min-w-[62rem]` de la tabla no cambió: sigue estando fijado por Hora y Total,
no por la columna nueva (8% de 62rem ≈ 79px, de sobra para un botón de 44px
con padding reducido `px-2 lg:px-3` en vez del `px-4` del resto).

Para el piso de 44px sin inflar la fila: la celda de Acciones usa `py-0` (sin
padding vertical propio) porque las filas de esta tabla ya rondan 40-48px de
alto por su propio contenido de texto + `py-2.5/lg:py-3` — el botón de 44px
entra en ese espacio casi sin empujarlo. El header de la columna lleva un
`<span className="sr-only">Acciones</span>` (no hay texto visible en la fila,
pero un lector de pantalla que navega la tabla columna por columna necesita
el nombre).

### 5. Duplicación del helper

Extraje `whatsappHref` a `src/lib/whatsapp.ts` (archivo nuevo). Con esta
tanda el patrón `wa.me/${phone.replace(/\D/g,'')}` iba a repetirse por
CUARTA y QUINTA vez (order-card, history-list, y ya estaba en transfer-tray
y store-dock), así que la extracción se paga sola. `transfer-tray.tsx` ahora
importa el helper y mantiene su propia función `transferWhatsappHref(order)`
solo para el mensaje prellenado específico de esa bandeja (pedir el
comprobante) — la parte de armar la URL en sí ya no está duplicada ahí.

`store-dock.tsx` (vitrina) **no se tocó**: no es dueño exclusivo de este
slice (era de T3, storefront). Sigue construyendo su link a mano sin usar
este helper — queda como candidato a adoptarlo el día que alguien edite ese
archivo, lo dejo anotado como follow-up, no como bug.

## Estado de la verificación

**Instrucción recibida a mitad de tarea: no verificar en navegador para este
cierre** (el `npm run dev` que tenía levantado se bajó explícitamente a
pedido del coordinador). Antes de que llegara esa instrucción sí llegué a
verificar en vivo, contra datos reales (dos pedidos creados por el flujo
normal de checkout, `la-birra`, pago en el local):

- **Confirmado en navegador**: el ícono de WhatsApp en el header de
  `order-card.tsx` se ve correctamente posicionado (zoom de screenshot) junto
  al indicador "hace X min", en una tarjeta en estado `confirmed` y en una en
  estado `ready` con "Cobrá antes de entregar" activo — en las dos está
  presente y no compite con el stack de acciones de abajo.
- **Confirmado por medición JS (`getBoundingClientRect`)**, no a ojo: el link
  del header resolvió a `aria-label="Escribirle a Tomas QC por WhatsApp"` y
  `href="https://wa.me/5491155554444"` (sin `actionUrl` prellenado en las
  transiciones que probé — "Empezar a cocinar" y "Marcar listo" no trajeron
  `notification.actionUrl` en este entorno local, así que solo alcancé a ver
  la rama "Escribirle"; la rama "Avisar" con link prellenado no la vi
  disparar en vivo, solo por lectura de código).
- **Confirmado en `history-list.tsx`**: la tabla renderiza con la columna
  nueva, dos filas con su botón de WhatsApp verde alineado bajo "Total".
  Medido con JS: el botón mide exactamente 44×44px, la fila completa 48-49px
  de alto (a 1920px de ancho de ventana — el `resize_window` de la
  herramienta de browser no logró achicar la ventana real en este entorno,
  quedó en 1920×935 pese a pedir 420×844, así que **no hay una medición real
  a ancho de mobile**). Lo que sí hice para aproximar mobile fue forzar por
  JS un `max-width: 375px` en el contenedor `overflow-x-auto` (no es lo mismo
  que un viewport real, pero corre el mismo CSS): con eso confirmé que el
  contenedor angosta, aparece su propio scroll horizontal
  (`scrollWidth: 992 / clientWidth: 373`, que coincide con el `min-w-[62rem]`
  documentado) y las columnas no se rompen ni se superponen al hacer scroll
  hasta el final.
- **No verificado en absoluto** (llegó la instrucción de frenar antes): modo
  oscuro de las dos pantallas, la tarjeta con delivery/repartidor asignado,
  el diálogo de cancelación con el nuevo layout de header, y cualquier
  interacción real a ancho de mobile nativo (lo de arriba es una
  aproximación con el contenedor forzado, no un viewport de verdad). No
  invento números para estos casos — quedan como pendientes de confirmar a
  ojo por quien haga la revisión visual.

## Acceptance criteria para el test-engineer

- **`order-card.tsx`**: para CUALQUIER pedido (cualquier `status`,
  `paymentMethod`, incluido el caso `blockedByPayment`), existe un elemento
  con role `link` cuyo `aria-label` empieza con "Escribirle a" o "Avisar a" y
  contiene `order.customerName`, con `href` que matchea
  `^https://wa\.me/\d+` (con o sin `?text=`). Nunca ausente.
  - Cuando `onChangeStatus` resuelve con `data.notification.actionUrl` no
    nulo, el `href` de ese link pasa a ser exactamente ese `actionUrl` y el
    `aria-label` cambia a "Avisar a {nombre} por WhatsApp".
  - Sin eso, el `href` es `https://wa.me/<dígitos de customerPhoneE164>` sin
    query string, y el `aria-label` es "Escribirle a {nombre} por WhatsApp".
- **`history-list.tsx`**: cada fila de pedido en la tabla (para cualquier
  `order` en `orders`, sin importar filtro de tab activo) tiene un link con
  `aria-label` "Escribirle a {order.customerName} por WhatsApp" y `href`
  `https://wa.me/<dígitos de order.customerPhoneE164>` (nunca con
  `?text=`, acá no hay mensaje prellenado). El header de esa columna tiene un
  `<th>` con nombre accesible "Acciones" (vía `sr-only`, sin texto visible).
- El link abre en pestaña nueva (`target="_blank" rel="noreferrer"`) en las
  tres ubicaciones (`order-card.tsx`, `history-list.tsx`,
  `transfer-tray.tsx`).
- `transfer-tray.tsx` no cambió su comportamiento visible: sigue siendo el
  botón "Escribirle por WhatsApp" del diálogo de confirmación, siempre
  presente (ya lo era antes de T6), ahora con el href armado vía
  `transferWhatsappHref` → `whatsappHref` en vez de a mano.

## Pendiente / cross-lane

- `store-dock.tsx` (vitrina) sigue sin usar `whatsappHref` de
  `src/lib/whatsapp.ts` — no es dueño exclusivo de este slice, queda como
  adopción futura, no como bug.
- Verificación visual real (mobile nativo, modo oscuro, delivery) queda para
  quien haga la revisión con navegador habilitado — ver sección de arriba
  para el detalle exacto de qué se confirmó y qué no.

## Skills invocadas

`impeccable` (`craft-floor.md` y `operate.md`, leídos antes de tocar
código — nada de kicker, nada de tarjeta anidada, ícono real en vez de
emoji, target de 44px), `web-design-guidelines` (accesible-name dinámico
según haya o no mensaje prellenado; `sr-only` en el header de la columna
ícono-solo), `vercel-react-best-practices` (sin nuevo estado innecesario: se
reusa `waLink` que ya existía, solo se le suma un fallback puro). `context7`
no hizo falta — no se tocó ninguna API nueva de librería, todo es JSX/CSS y
una función pura nueva.

`npm run typecheck` y `npm run lint` en verde.
