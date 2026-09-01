# T6B — Frontend: el descuento en las superficies operativas

Agente: `frontend-react-craftsman`. Rama: `feat/cupones-y-campanas`.

## Resumen

Slice quirúrgico: una línea de importe, condicionada a `discountCents > 0`, en
las superficies operativas que ya muestran plata de un pedido. **Las tres
superficies quedaron implementadas** (historial, KDS —en *dos* lugares, ver más
abajo— y portal del repartidor). El portal quedó bloqueado a mitad de la tarea
por un campo faltante en la capa de modelos; el hilo principal lo agregó
(`discountCents` en `CourierOrder.collect`, `types.ts` y
`dispatch.model.ts`) y cerré esa pieza al final. La sección de bloqueo original
queda más abajo como registro de qué se pidió y qué se resolvió.

## Archivos modificados

- `src/views/admin/pedidos/history-list.tsx` — línea de descuento en la celda
  Total de la fila.
- `src/views/admin/kds/order-card.tsx` — bloque de desglose completo
  (Subtotal/Descuento/Envío/Total) en el pie de la tarjeta.
- `src/views/admin/kds/transfer-tray.tsx` — línea de descuento en el diálogo de
  confirmación de transferencia (`ConfirmDialog`). **No estaba en la lista
  explícita de la tarea, pero es la misma familia de superficie** (`views/admin/kds/**`,
  del que soy dueño exclusivo) y el mismo criterio de negocio: quien confirma
  un pago mirando su cuenta bancaria necesita saber por qué lo que entró es
  menos que el pedido, o "no coincide" se vuelve indistinguible de un cupón
  aplicado. Ver criterios de aceptación abajo.
- `src/views/courier/active-order-card.tsx` — línea de descuento en el diálogo
  de confirmación de cobro (`ConfirmDialog` interno), agregada **después** de
  que el hilo principal sumó `discountCents` a `CourierOrder.collect`. Ver
  sección "Portal del repartidor — desbloqueado" más abajo.

**No toqué** `scheduled-tray.tsx`, `date-filter.tsx`, `board.tsx` ni
`assign-courier.tsx`: ninguno de los tres muestra un importe de pedido, así que
no hay desglose existente donde insertar la línea.

## No hubo panel ni tarjeta nueva

Cada cambio es una o más líneas de texto dentro de un contenedor que ya
existía (la celda `<td>` del total, el pie de la `Panel` de la tarjeta KDS, el
`<div>` de "Monto a confirmar" del diálogo de transferencia). Ninguno de los
tres es una `Panel` anidada.

## `history-list.tsx` — el "desglose de la fila expandida" no existe hoy

La tarea (y §5.14.4 de `00-architecture.md`) hablan de "el desglose de la fila
expandida", pero **este archivo no tiene ninguna fila expandible**: es una
tabla plana, sin `aria-expanded` ni estado de expansión en ningún lado (lo
verifiqué con grep sobre `src/views/admin/`). El "desglose de importes que ya
existe" para esta superficie es la celda **Total**, que ya mostraba una
sub-línea condicional (`incl. $X envío`, solo si `deliveryFeeCents > 0`).
Agregué la línea de descuento con el mismo patrón visual y la misma condición
(`display: block`, `text-[0.6875rem]`, `text-muted-foreground`), **antes** de
la de envío, siguiendo el orden Subtotal→Descuento→Envío→Total de §5.14.4 (acá
no hay línea de Subtotal separada porque la celda nunca la tuvo; el total ya
la incluye implícito, igual que ya hacía con el envío).

No agregué expansión de fila: hubiera sido una estructura nueva para un
slice que la tarea describe explícitamente como "chico y quirúrgico", y el
criterio de aceptación 1 ("las tres superficies muestran la línea") no exige
una fila expandible, solo que la línea aparezca en el desglose existente.

## `order-card.tsx` (KDS) — no había NINGÚN importe en la tarjeta

Antes de este cambio, `order-card.tsx` no mostraba `subtotalCents`,
`totalCents` ni ningún precio: la tarjeta comunica cocina y estado de pago
(`PaymentNotice`, `StatusPill`), pero nunca un monto. Verificado con grep
(`Price`/`*Cents`) sobre los cuatro archivos de `kds/`: solo aparece en
`transfer-tray.tsx`.

Como el criterio de aceptación 2 exige que **sin descuento la tarjeta no
cambie en nada**, no podía simplemente "mostrar el total siempre" (eso sería un
cambio visual para el 100% de los pedidos, no solo los que tienen cupón).
Decisión: el bloque de desglose completo (Subtotal, Descuento, Envío, Total)
solo se monta cuando `discountCents > 0`. Es la única forma de que "el
encargado vea por qué el total no es el subtotal" sin tocar la tarjeta en el
caso común, y de que los números realmente **cierren** a la vista (mostrar
solo la línea de descuento sin el total al lado hubiera dejado al cajero sin
la cifra que necesita cobrar).

Ubicado como primer hijo del `<div>` de pie de tarjeta (antes del pill "Cobrado
en el local" / `PaymentNotice`), aplica a **cualquier** pedido con descuento,
no solo `in_store` sin pagar — la arquitectura motiva el requisito con el caso
de cobro en el mostrador, pero un pedido pago online con cupón que un cliente
llama a preguntar por su comprobante también se beneficia de que el encargado
pueda leer el desglose en el tablero, y condicionar por método de pago hubiera
sido una regla más sin beneficio claro.

## `transfer-tray.tsx` — el mismo criterio, en el diálogo de confirmación

`ConfirmDialog` ya mostraba `order.totalCents` como "Monto a confirmar" (el
número contra el que el encargado coteja su resumen bancario). Con descuento,
ese número es menor al subtotal del pedido y sin la línea de descuento el
encargado no tiene forma de saber si "no coincide" es un problema real o el
cupón. Agregué la línea (mismo patrón: código + signo menos + monto,
`.tabular`) arriba del monto a confirmar, **solo si `discountCents > 0`**; sin
descuento el bloque es visualmente idéntico al anterior (mismo contenido,
solo un `<div>` de más envolviendo la misma fila única — verificado a ojo en
el diff).

## Formato de la línea, en las tres superficies tocadas

`{couponCodeSnapshot} −<Price .../>`, con el código como etiqueta y el signo
menos pegado al monto, como pide §5.14.4. `.tabular` en el monto (vía `Price`,
que ya lo aplica internamente — `src/views/shared/money.tsx:23`). Truncado con
`min-w-0 truncate` en el contenedor flex de KDS/transfer-tray (mismo patrón que
`order-card.tsx:265` ya usaba para el nombre del cliente) — `coupons_code_check`
acota el código a `[A-Z0-9]{4,16}`, así que el riesgo de overflow es bajo, pero
"Descuento " + 16 caracteres puede apretar una tarjeta angosta en mobile.

## Criterios de aceptación — estado

1. **Con descuento, las tres superficies muestran la línea y los números
   cierran.** Cumplido en las tres.
2. **Sin descuento, ninguna de las tres cambia en nada.** Verificado en las
   cuatro piezas tocadas (historial, KDS ×2, repartidor): la condición es
   siempre `discountCents > 0` (nunca `!= null` ni un default engañoso —
   `Order.discountCents` y `collect.discountCents` son `not null`, `0` cuando
   no hubo cupón).
3. **El código del cupón se muestra como etiqueta de la línea.** Cumplido en
   historial y KDS, con `couponCodeSnapshot`. **No en el repartidor** — ver
   más abajo, es una limitación real de qué expone la RPC, no un olvido.
4. **El repartidor ve el total con descuento (que ya es `totalCents`).**
   Ya se cumplía **sin ningún cambio de código**: `courier_queue` arma
   `collect.totalCents` a partir de `o.total_cents`, que la migración
   `20260901130000_cupones.sql` ya calcula neto del descuento. El agregado de
   este slice fue la línea explicativa, no el monto correcto (que nunca
   estuvo mal).

## Portal del repartidor — desbloqueado por el hilo principal, cerrado

Quedó registrado abajo, tal cual se reportó en la primera vuelta de este
informe, para que quede el rastro de qué se pidió y qué hizo cada lado.

**Lo que reporté como bloqueo:** `src/views/courier/active-order-card.tsx`
(`ConfirmDialog` interno) necesitaba `discountCents` en `CourierOrder.collect`
(`src/models/types.ts`, ~línea 716) y en `CourierQueueRpcRow['collect']`
(`src/models/dispatch.model.ts`, ~línea 81) — la migración
`20260901130000_cupones.sql` ya emitía la clave desde `courier_queue`, pero el
tipo de TypeScript no la tenía, y ambos archivos son `src/models/**`, fuera de
mi lane. No hice un cast para sortearlo: el objeto real ya traía el campo en
runtime, así que un cast hubiera "andado" pero es la divergencia silenciosa
que la tarea pide evitar.

**Lo que hizo el hilo principal:** agregó `discountCents: number` (no
nullable, `0` sin cupón) a `collect` en los dos archivos. El mapeo
`collect: row.collect` de `toCourierOrder()` era un pass-through directo, así
que no hizo falta tocarlo.

**Lo que hice yo, una vez desbloqueado:** agregué la línea en
`ConfirmDialog` (`active-order-card.tsx`, entre "Pedido" y "Envío"), **solo si
`order.collect.discountCents > 0`**:
```tsx
{order.collect.discountCents > 0 ? (
  <div className="flex items-baseline justify-between">
    <span className="text-muted-foreground">Descuento</span>
    <span className="tabular">
      −<Price cents={order.collect.discountCents} currency={order.collect.currency} />
    </span>
  </div>
) : null}
```

**Sin código de cupón como etiqueta acá, y es intencional, no una omisión.**
`courier_queue` no expone `couponCodeSnapshot` en `collect` (verificado en la
migración: el objeto solo trae `subtotalCents`/`discountCents`/
`deliveryFeeCents`/`totalCents`/`currency`), así que el repartidor ve
"Descuento" genérico, sin código — instrucción explícita del coordinador: no
inventar el código ni deducirlo. Si en algún momento se quiere el código
también en la puerta, hace falta sumar `coupon_code_snapshot` a `collect` en
la RPC `courier_queue` (otra migración; no lo pido como parte de este slice
porque el criterio de aceptación 4 no lo exige).

## Skills invocadas

- `impeccable` (`craft-floor.md` + `operate.md`, ya leídos antes de tocar
  código) — el hook post-edición no reportó hallazgos en ninguno de los tres
  archivos.
- `web-design-guidelines` — chequeo puntual sobre las reglas de truncado de
  texto en flex (`min-w-0` + `truncate`) y numerales tabulares; ambas ya
  cumplidas por el patrón existente de `Price` y por `order-card.tsx:265`.

## Comprobado

- `npm run typecheck` — verde en el momento de cada edit mío (verificado
  después de historial, después de KDS y de nuevo después del repartidor).
  **Al cerrar el informe, `typecheck` y `lint` muestran errores/warnings
  nuevos** en `tests/models/order.model.test.ts`, `src/models/order.model.ts`
  y `src/emails/**` — ninguno de esos archivos es mío, y ninguno referencia
  `history-list.tsx`, `order-card.tsx`, `transfer-tray.tsx` ni
  `active-order-card.tsx` (confirmado con grep sobre la salida completa). Son
  del lane de backend (T1B/T2B), que está escribiendo en paralelo sobre
  `couponCode`/`Coupon*` en `order.model.ts` mientras cierro este slice. Mis
  cuatro archivos siguen verdes de forma aislada.
- `npm run lint` — mismo caso: los 10 warnings son todos en
  `src/models/order.model.ts` (imports sin usar de la migración de cupones en
  curso), cero en mis archivos.
- Grep de `Price`/`*Cents` sobre `src/views/admin/kds/*.tsx` y
  `src/views/courier/*.tsx` para confirmar qué superficies mostraban plata
  antes de este cambio (ninguna otra además de las tocadas).
- El hook de `impeccable` corrió sobre `active-order-card.tsx` tras el último
  edit: sin hallazgos.

## Spec para el test engineer

Comportamientos observables por rol de usuario, en las cuatro piezas
implementadas (historial, KDS ×2, repartidor):

- **Sin cupón** (`discountCents === 0`, tanto en `Order` como en
  `collect`): las cuatro piezas tocadas renderizan exactamente igual que antes
  de este slice — ninguna línea de descuento en el DOM. Es el caso que protege
  contra la regresión visual del criterio 2: un test de snapshot/query que
  busque el texto del código de cupón o "Descuento" no debería encontrar nada
  cuando el campo es 0.
- **Con cupón** (`discountCents > 0`):
  - `history-list.tsx`: la celda de Total de la fila del pedido contiene tanto
    el texto de `order.couponCodeSnapshot` como un monto precedido de `−`. El
    total mostrado arriba (`order.totalCents`) sigue siendo el número grande;
    la línea de descuento es la sub-línea chica.
  - `order-card.tsx`: el pie de la tarjeta (dentro de la `Panel`) contiene
    cuatro líneas — Subtotal, "Descuento {código}", (Envío si
    `deliveryFeeCents > 0`), Total — y los montos, leídos como enteros de
    centavos, satisfacen `subtotal − discount + delivery === total` (mismo
    invariante que el CHECK de Postgres
    `orders_total_is_subtotal_plus_delivery_check` post-cupón).
  - `transfer-tray.tsx`, `ConfirmDialog`: al abrir el diálogo de un pedido
    `payment_method = 'transfer'` con descuento, aparece la línea "Descuento
    {código} − $X" arriba de "Monto a confirmar", y el monto de "Monto a
    confirmar" sigue siendo `order.totalCents` (sin cambios de esa parte).
  - `active-order-card.tsx`, `ConfirmDialog` del repartidor: cuando
    `order.collect` no es `null` (local con cobro en la puerta, `in_store`,
    todavía impago) y `order.collect.discountCents > 0`, aparece una línea
    "Descuento − $X" entre "Pedido" y "Envío". **A diferencia de las otras
    tres, el label es "Descuento" a secas, sin código** — `courier_queue` no
    expone `couponCodeSnapshot` en `collect`, así que no hay dato que mostrar
    ahí. No es un bug ni una inconsistencia a limar: no confundir con las
    otras tres superficies al escribir el test (no buscar el código acá).
- **Accesibilidad**: ningún cambio agrega o quita foco, roles ni landmarks —
  son nodos de texto dentro de contenedores ya existentes (`<td>`, `<div>`
  dentro de `Panel`, `<div>` dentro de `DialogContent`). No hace falta un test
  de foco nuevo; sí vale un test de contenido textual (`getByText`) para las
  cuatro piezas en los dos escenarios (con/sin descuento).

## Pendiente / follow-up

- Ninguno de este slice. Si en algún momento se quiere el código de cupón
  también en la puerta del repartidor, hace falta sumar
  `coupon_code_snapshot` a `collect` en la RPC `courier_queue` (otra
  migración) — no es parte de ningún criterio de aceptación de T6B.
