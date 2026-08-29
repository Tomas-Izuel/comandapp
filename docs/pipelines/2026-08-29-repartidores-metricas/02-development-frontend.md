# Slice frontend — métricas de repartidor en `/admin/repartidores`

No hubo un `01-tasks.md` propio para este slice: el runbook llegó entero en
el prompt del orquestador, con el contrato ya fijado en `CourierRow`
(`src/models/types.ts`) y con dos campos nuevos (`courierCollects`,
`currency`) que otro agente estaba agregando en paralelo al caso `'ok'` de
`StaffSession` en `src/controllers/staff.controller.ts`. No existía un run
previo para esto, así que abro `docs/pipelines/2026-08-29-repartidores-metricas/`.

Pedido del dueño del producto (textual): *"en repartidores estaría bien
tener algunos datos, ejemplo cuántos pedidos hizo, tiempo promedio, cuánta
plata cobró él en la entrega"*. `/admin/repartidores` era un padrón puro
(alta/baja/reenviar invitación); ahora cada fila también contesta esas tres
preguntas.

## Archivos tocados (todos dentro de mi ownership declarado)

- `src/views/admin/repartidores/courier-metrics.tsx` — **archivo nuevo**.
  Componente `CourierMetrics`: la tira densa de tres medidas (`<dl>` con
  pares `dt`/`dd`), pensada para vivir dentro de la fila del `Panel`, no como
  tarjeta propia. No es una primitiva de `src/views/shared/`: es específica
  de esta pantalla (formatea `avgDeliveryMinutes` con la regla de los tres
  casos, ver abajo), así que la dejo local a `repartidores/`, no en
  `shared/surfaces.tsx`.
- `src/views/admin/repartidores/courier-row.tsx` — la fila ahora tiene dos
  líneas: la de siempre (identidad + `StatusPill`s + acciones, sin cambios de
  comportamiento) y, debajo, la tira de métricas o la leyenda de "sin
  actividad todavía" para un invitado que nunca entró. `CourierRow` (el
  componente) ahora recibe `currency` y `courierCollects` además de
  `storeId`/`courier`.
- `src/views/admin/repartidores/courier-manager.tsx` — recibe `currency` y
  `courierCollects` como props nuevas y las reenvía a cada `CourierRow`. El
  `EmptyState` de "todavía no invitaste a nadie" queda intacto.
- `src/app/admin/(app)/repartidores/page.tsx` — pasa `session.currency` y
  `session.courierCollects` (los dos campos que el otro agente agregó a
  `StaffSession`) a `CourierManager`. Actualicé el `description` del
  `PageFrame`: ya no es solo "invitá gente", ahora también dice que se puede
  ver cuánto entregó cada uno.

No toqué `src/models/**`, `src/controllers/**` (incluido
`staff.controller.ts`, que no es mío), `supabase/**`, `src/views/shared/**`
ni ninguna otra vista.

## Contrato consumido

`CourierRow` en `src/models/types.ts` ya traía los cinco campos nuevos
(`deliveriesToday`, `deliveries30d`, `avgDeliveryMinutes`,
`collectedTodayCents`, `collected30dCents`) — no los cambié. `StaffSession`
(`status: 'ok'`) ganó `courierCollects: boolean` y `currency: string` en
paralelo; los asumí como existentes según indicó el orquestador, y al
momento de mi `typecheck` ya estaban (con una carrera transitoria: un
`tsc --noEmit` a mitad de la escritura concurrente del otro agente mostró un
error fantasma en `kitchen.actions.ts` que no era mío ni tenía relación con
mis archivos; un segundo `tsc --noEmit` limpio confirmó que era una lectura a
mitad de escritura, no un problema real).

Dato que llegó a mitad de tarea (mensaje del coordinador, con la migración ya
aplicada al stack local): `avgDeliveryMinutes` no es binario (`null` vs `>0`)
sino de **tres** casos, porque la RPC lo castea a `::int` en SQL
(`supabase/migrations/20260829120000_courier_stats.sql`):

- `null` → nunca hubo una entrega medible → `"—"` + "sin entregas medidas".
- `0` → SÍ hay una entrega medida y el promedio real da bajo un minuto
  (arranque y entrega casi juntos) → `"<1 min"`. Nunca `"0 min"`: se lee como
  roto y es la lectura equivocada de un dato correcto.
- `> 0` → `"N min"`.

Implementado en `formatAvgMinutes()` dentro de `courier-metrics.tsx`,
chequeando `=== 0` antes de redondear (aunque el valor ya viene entero desde
Postgres, así que el `Math.round()` del branch `> 0` es un no-op defensivo).

## Decisiones de diseño / trade-offs

### 1. Dónde va la tira: segunda línea de la fila, no un tercer elemento en el `justify-between`

La fila original era `flex-col` en mobile / `flex-row sm:justify-between`
con dos hijos (identidad, acciones). Meter la tira de métricas como tercer
hijo del mismo `justify-between` la hacía competir por espacio horizontal
con las acciones en pantallas intermedias y no dejaba wrapear limpio a
360px. En cambio: el `div` exterior de la fila pasa a ser siempre
`flex-col`, con un primer bloque interno que reproduce el layout de siempre
(`flex-col sm:flex-row sm:justify-between` para identidad+acciones) y, debajo,
la tira de métricas (o la leyenda de "sin actividad") como segunda línea de
ancho completo. Esto no cambia nada del comportamiento de las acciones ni de
los `StatusPill`; solo agrega una línea.

### 2. `<dl>` con `dt`/`dd` envueltos en `div`, no una grilla suelta de `span`

El brief pide que "cada número necesita un rótulo textual asociado (no
confíes en la posición)". Un `<dl>` (con cada par `dt`+`dd` envuelto en un
`div` — válido en HTML5, no rompe la semántica) ata el rótulo al valor en el
DOM, así que un lector de pantalla no depende de dónde termina cayendo el
bloque cuando la tira wrapea en mobile. `flex flex-wrap` en vez de un CSS
grid fijo: con `showMoney` a veces son 2 medidas y a veces 3, y un grid de
columnas fijas dejaría un hueco vacío cuando falta la de plata.

### 3. Repartidor invitado que nunca entró: leyenda corta, no la tira con ceros

`invitedNotEntered` (`courier.isActive && courier.lastSignInAt === null`, ya
existía) ahora también decide si se muestra la tira completa o una sola
línea muda: *"Sin actividad todavía — cuando entre y reparta su primer
pedido, sus números van a aparecer acá."* Decisión explícita del brief
("decidí vos... pero decidí, no lo dejes al azar"): tres métricas en cero al
lado de un nombre recién invitado se leen como que algo se rompió, no como
"recién arranca". Un repartidor **desactivado** (con o sin historial) sigue
mostrando la tira completa con sus números reales — esa plata y esas
entregas existieron y el dueño puede necesitar cerrarle la cuenta.

Nota: si alguna vez existiera un repartidor invitado y desactivado en el
mismo movimiento antes de entrar nunca (`isActive === false` y
`lastSignInAt === null`), `invitedNotEntered` da `false` (exige
`isActive === true`) y ese caso cae en la tira completa con ceros reales — es
consistente con la regla "desactivado siempre muestra su historial", y es un
edge case casi inexistente en la práctica (invitar y dar de baja sin que
nadie entre nunca).

### 4. Plata condicional: `courierCollects || collected30dCents > 0`

Mismo criterio que ya usa el portal del repartidor (`order.collect === null`
→ ni una palabra sobre dinero, en `active-order-card.tsx`). Si el local nunca
habilitó el cobro en la puerta y no hay un solo peso histórico, la tercera
medida ("Cobrado en la puerta") ni se renderiza — no hay hueco vacío ni
rótulo con "$0". Si el local lo tuvo habilitado y lo apagó, `collected30dCents
> 0` mantiene visible el acumulado histórico (la plata que cobró existió,
aunque hoy el local ya no ofrezca esa modalidad).

### 5. Jerarquía invertida en "Cobrado en la puerta": hoy es lo primero, no los 30 días

A diferencia de "Entregas" (30 días primero, hoy como secundario — mide
volumen), en plata el número principal es **hoy**: es un arqueo de caja (lo
que el repartidor tiene encima en este momento y le tiene que entregar al
dueño), no una métrica de ventas acumuladas. El de 30 días va después,
separado por `·`, en texto secundario.

### 6. Formato de plata: siempre `<Price>`, nunca a mano

`src/views/shared/money.tsx` ya expone `Price` con `currency` como prop y
numerales tabulares incorporados (`className="tabular"` interno). Lo usé tal
cual con `currency={currency}` (viene de `session.currency`, no hardcodeado
`'ARS'`) — cero formateo de plata a mano en este slice.

### 7. Ninguna primitiva nueva en `src/views/shared/`

`CourierMetrics` no calificaba para vivir ahí: es un composé específico de
esta pantalla (conoce la forma exacta de `CourierRow` del dominio y el caso
particular de `avgDeliveryMinutes`), no una pieza de vocabulario reusable
entre superficies. Reutiliza `Price` de `shared/money.tsx` sin tocarlo.

## Ronda 2 — arreglos pedidos por el coordinador tras revisar el resultado construido

Todos dentro de `courier-metrics.tsx`, sin tocar nada fuera de
`src/views/admin/repartidores/**`:

1. **Rótulo "Promedio de entrega" → "Promedio en la calle".** El `title`
   original ("puerta a puerta: no incluye el tiempo de cocina") era la única
   desambiguación, y `title` es hover puro: en el celular del dueño —el
   dispositivo desde donde se mira este panel, según PRODUCT.md— nunca se
   dispara. El rótulo suelto se podía leer como el tiempo total del pedido.
   Cambiado a "Promedio en la calle", el mismo idioma que ya usa el checkout
   del cliente para "están todos en la calle" (= los repartidores). El
   `title` queda como refuerzo en desktop, ya no como el único portador del
   significado.
2. **Secundario de plata oculto cuando `collected30dCents ===
   collectedTodayCents`.** Con datos reales del stack local, un local recién
   arrancado tiene ese empate todo el tiempo (no pasó ni un día completo de
   historia todavía), y renderizar "$X · $X en 30 días" se lee como un bug de
   cálculo, no como un dato. El rótulo "hoy" ya es la información completa en
   ese caso; el secundario solo aparece cuando aporta algo distinto.
3. **`Math.round(min)` eliminado de `formatAvgMinutes`.** `avgDeliveryMinutes`
   ya llega entero desde Postgres (`round(...)::int` en la RPC de
   `courier_stats`, `supabase/migrations/20260829120000_courier_stats.sql`);
   redondear de nuevo en el cliente insinuaba que el valor podía llegar
   fraccionado, que no es el caso. El comentario de la función se actualizó
   para no atribuirse un redondeo que no hace.

Verificado después de los tres cambios: `npm run typecheck` y `npm run lint`
limpios (mismos 6 warnings preexistentes en `tests/**`, ninguno mío); el hook
de `impeccable` no reportó hallazgos sobre esta edición.

## Comportamiento a 360px de ancho

Con el `Panel` en `p-4` (16px por lado) el contenido disponible ronda 328px.
Las tres medidas tienen `min-width` de `6.5rem`, `6.5rem` y `8rem` (104px,
104px, 128px) separadas por `gap-x-5` (20px): la suma de las tres no entra en
una sola línea a ese ancho, así que `flex-wrap` las parte en dos líneas
(típicamente las dos primeras juntas, la de plata sola abajo) — sin scroll
horizontal en ningún momento, y sin apretar los botones de acción de la fila
de arriba (que siguen en su propio `flex-wrap` independiente). Verificado
leyendo los anchos computados, no una corrida en dispositivo real; si el
equipo de QA visual quiere confirmarlo con capturas, el hook de `impeccable`
ya corrió sobre estos archivos sin hallazgos mecánicos.

## Estados verificados / spec para `test-engineer`

Comportamientos observables por el usuario que un test debería poder
ejercitar a través de la UI (roles/labels accesibles, no clases):

1. **Fila con historial completo** (`deliveries30d > 0`,
   `avgDeliveryMinutes` no nulo, `courierCollects` true o
   `collected30dCents > 0`, y `collected30dCents !== collectedTodayCents`): se
   ve una lista de definición con tres pares rótulo/valor — "Entregas · 30
   días" (`deliveries30d` + "· N hoy"), "Promedio en la calle" (minutos),
   "Cobrado en la puerta · hoy" (precio hoy + "· precio 30 días").
2. **`avgDeliveryMinutes === null`**: el valor mostrado es exactamente `"—"`
   seguido del texto `"sin entregas medidas"`. Nunca `"0 min"`.
3. **`avgDeliveryMinutes === 0`**: el valor mostrado es exactamente
   `"<1 min"`, sin la leyenda "sin entregas medidas" (es un dato real).
4. **`avgDeliveryMinutes > 0`**: el valor mostrado es `"{N} min"` — `N` tal
   cual llega (ya es entero desde la RPC, el cliente no redondea de nuevo).
5. **Cero entregas hoy, sí en 30 días**: "Entregas · 30 días" sigue
   mostrando el número de 30 días con "· 0 hoy" como secundario — no colapsa
   ni desaparece.
6. **`courierCollects === false` y `collected30dCents === 0`**: no aparece
   ningún texto ni rótulo relacionado con plata en la fila (buscar por el
   rótulo "Cobrado en la puerta" debería fallar / no existir).
7. **`courierCollects === false` pero `collected30dCents > 0`** (se
   desactivó el cobro pero hay histórico): el bloque de plata SÍ aparece,
   con el acumulado de 30 días.
7b. **`collected30dCents === collectedTodayCents`** (local recién arrancado:
   todo lo cobrado en 30 días pasó hoy, no hay historia previa): el bloque de
   plata muestra SOLO el número de hoy con su rótulo — el secundario "· X en
   30 días" no se renderiza, para no repetir el mismo número dos veces bajo
   dos rótulos distintos (se lee como un bug de cálculo si se deja).
8. **Repartidor invitado que nunca entró** (`isActive: true`,
   `lastSignInAt: null`): no se renderiza la lista de definición de
   métricas; en su lugar aparece el párrafo
   "Sin actividad todavía — cuando entre y reparta su primer pedido, sus
   números van a aparecer acá." El `StatusPill` sigue diciendo "Invitado ·
   todavía no entró" (sin cambios, no es mi lane tocarlo salvo que ya
   estuviera así).
9. **Repartidor desactivado** (`isActive: false`) con historial: la fila
   entera sigue en `opacity-60` (sin cambios) y la tira de métricas sigue
   mostrando sus números reales (no colapsa a la leyenda de "sin
   actividad").
10. **Accesibilidad**: cada valor numérico está en un `<dd>` con su `<dt>`
    hermano dentro del mismo `<div>` de agrupación — un lector de pantalla
    que navegue por listas de definición anuncia rótulo y valor juntos
    independientemente del orden visual. El rótulo "Promedio en la calle" ya
    desambigua solo (mismo idioma que usa el checkout para "todos en la
    calle" = los repartidores, no la cocina); el `title` con "puerta a
    puerta: no incluye el tiempo de cocina" queda de refuerzo para
    desktop/mouse, sin cargar el significado — en el celular del dueño, que
    es el dispositivo principal según PRODUCT.md, `title` no se dispara
    nunca.
11. **Moneda**: todo número de plata usa `<Price currency={session.currency}>`
    — no hay `'ARS'` hardcodeado en este slice; un test podría forzar una
    tienda con otra moneda y confirmar que el símbolo cambia.

## Verificación

- `npm run typecheck` — limpio en el estado final (una corrida a mitad de la
  escritura concurrente de `staff.controller.ts` mostró un error transitorio
  no relacionado con mis archivos; una segunda corrida ya con los cambios
  del otro agente aplicados salió limpia).
- `npm run lint` — 0 errores. Los 6 warnings existentes son de
  `tests/**` (variables `_omit`/`_table`/`_cols`/`_opts`/`_apiKey` sin usar),
  no tocan mis archivos ni son de este slice.
- Hook de `impeccable`: corrió después de cada edición de UI
  (`courier-metrics.tsx`, `courier-row.tsx`, `courier-manager.tsx`,
  `repartidores/page.tsx`) sin hallazgos mecánicos.

## Qué dejé afuera / follow-ups

- No agregué ningún indicador visual de tendencia (flechas arriba/abajo,
  comparación con el período anterior): el contrato de `CourierRow` no trae
  esos datos y el `PRODUCT.md` ("Evidence on Hand") prohíbe insinuar métricas
  que no existen.
- No agregué un link o acceso directo desde la fila hacia el detalle de
  pedidos de ese repartidor: no estaba en el pedido del dueño ni en mi
  ownership (`src/app/admin/(app)/repartidores/page.tsx` solo pasa props); si
  se quiere en una próxima iteración, es una nueva ruta/controller, no una
  extensión de este slice.
- Si el equipo de QA visual corre una captura real a 360px y la tira queda
  más apretada de lo esperado, el ajuste más simple es bajar `gap-x-5` a
  `gap-x-4` en `courier-metrics.tsx` — no debería hacer falta tocar la
  estructura.
