# 03-review — Detalles de QC (2026-08-31)

## Veredicto

**APROBADO**

## Alcance revisado

`git diff --stat` (working tree, nada commiteado):

```
 src/app/legal/privacidad/page.tsx          |   2 +-
 src/app/legal/terminos/page.tsx            |   2 +-
 src/lib/env.server.ts                      |   2 +-
 src/views/admin/ajustes/schedule-track.tsx | 109 ++++++++++++++-
 src/views/admin/kds/order-card.tsx         |  26 +++-
 src/views/admin/kds/transfer-tray.tsx      |   6 +-
 src/views/shared/site-footer.tsx           |  48 ++++---
 src/views/storefront/product-card.tsx      | 212 ++++++++++++++++++++++++-----
 src/views/storefront/store-dock.tsx        |  41 ++----
 9 files changed, 350 insertions(+), 98 deletions(-)
```

Más `docs/pipelines/2026-08-31-detalles-qc/{01-tasks,02-development-*}.md`
(untracked, sin código). Revisé cada archivo línea por línea contra el diff
real, no contra lo que reportan los `02-development-*.md`, y corrí de nuevo
`npm run typecheck` y `npm run lint` (los dos en verde, cero cambios respecto
de lo que reportó el hilo principal).

No hay tocado ni un archivo de `src/models`, `src/controllers`, `src/services`
ni `supabase/migrations/` en esta tanda: es 100% `views/` + dos constantes de
copy. Layer discipline, dinero, estado de cocina, idempotencia y RLS no
aplican — no hay superficie para violarlos acá.

## T1 — Cuenta bancaria (sin cambios de código)

La investigación es sólida. Las tres capas (modelo contra Postgres real,
Server Action con mocks solo en el borde, y end-to-end real con magic link +
código de Resend real) cubren el camino completo sin dejar un salto de fe en
el medio, y cada resultado quedó verificado con una consulta a la base, no
solo con el mensaje de la UI. Descartar la teoría del rate limit citando que
`RateLimitError` es una `DomainError` y por lo tanto el mensaje SÍ llega
completo al dueño es el argumento correcto — no hace falta cambiar copy ahí.

Sobre los dos leads que dejó abiertos:

- **Rate limit fail-closed de `bank_account_change:store`**: no amerita
  ningún cambio ahora. El comportamiento es el querido (three strikes con
  mensaje explícito) y no hay evidencia de que sea la causa del reporte
  original.
- **`revalidatePath` después de una escritura ya commiteada**
  (`confirmPendingChangeAction`, `src/controllers/admin.actions.ts:550`,
  `:564` y `:581`): confirmé el patrón leyendo el archivo actual — las TRES
  ramas (`payment_credentials`, `bank_account`,
  `courier_collects_payment`) llaman `revalidatePath` dentro del mismo
  `try` de `toActionResult`, después de que el admin client ya escribió. Si
  `revalidatePath` tirara en producción (hoy no lo hace, según lo verificado
  en la capa 3), el dueño vería "no pudimos procesar la operación" sobre un
  cambio de credenciales de cobro, cuenta bancaria o política de caja que YA
  se aplicó — silencioso y en las tres superficies más sensibles del panel de
  pagos. No es un bug de esta tanda (el código no se tocó) y no hay evidencia
  de que esté ocurriendo hoy, así que no bloquea este commit. Sí lo dejo
  marcado como candidato a su propio slice: separar "aplicar el cambio" de
  "invalidar cache" en `confirmPendingChangeAction`, envolviendo el
  `revalidatePath` en su propio `try/catch` que loguee y no propague. Prioridad
  media — toca dinero y cambios de política de cobro, pero es una condición de
  carrera teórica, no reproducida.

## T2 — Stepper en `product-card.tsx`

Verifiqué en código, no solo en el log, los tres puntos que pedía el brief:

- **`pr-13` + `bg-primary/10`**: `PhotoFrame` (línea 110 de
  `surfaces.tsx`) arma su `<div>` exterior con
  `cn('bg-muted relative w-full overflow-hidden', aspect, className)`. Como
  `className` llega DESPUÉS y `cn` usa `twMerge`, `bg-primary/10` sí gana
  sobre `bg-muted` en ese mismo `<div>` — no es un supuesto, es cómo
  `twMerge` resuelve dos utilidades de `background-color` en conflicto. El
  hijo `PhotoFallback` (`h-full w-full`, porcentual) se ajusta solo al
  content-box angostado por el `pr-13`, así que la franja reservada queda con
  el mismo tinte de marca que el resto del fallback. Correcto.
- **Geometría**: `pr-13` = `size-11` (el botón) + `right-2` (el margen), la
  misma cuenta que ya usan los controles — escala con `--spacing` igual que
  ellos. La guarda `@min-[14rem]:pr-0` cancela la reserva en la forma
  horizontal, donde el control ya no vive sobre la foto. Sin fisuras.
- **`MenuSkeleton` (no tocado)**: confirmé que dibuja `size-11 rounded-full
  right-2 bottom-2` en la esquina — exactamente la geometría del "+" en
  reposo. Como `lines` arranca en `[]` tanto en servidor como en cliente antes
  de hidratar `localStorage`, `quantity` es siempre 0 en el primer paint: no
  hay salto de layout contra el esqueleto.

**Accesibilidad del stepper**: el `aria-live="polite"` está en el `<span>`
exterior (sin `key`), y el hijo con `key={quantity}` es el que muestra el
dígito — así el lector de pantalla observa una mutación de contenido en un
nodo estable en vez de perder la referencia en cada +1/-1. Correcto, y es el
orden que hay que usar (si el `aria-live` estuviera en el nodo con `key`, cada
cambio destruye el nodo antes de que se anuncie). `role="group"` con un solo
botón visible en reposo no es un error de ARIA ni "ruido" real — es
válido tener un grupo de un elemento, y evita agregar el atributo recién
cuando aparece el segundo botón. Nit menor, no bloqueante: se podría omitir el
`role`/`aria-label` mientras `isStepper` es `false` para no anunciar un grupo
de un solo control, pero la consistencia que eligieron es una decisión
defendible, no un bug.

**`MAX_QUICK_ADD_QUANTITY = 50` duplicado a mano**: aceptable por ahora.
Confirmé que replica un precedente real (`product-detail.tsx` ya hardcodea
`max={50}`) y que el desincronismo más grave posible si `MAX_LINE_QUANTITY`
cambiara en `lib/cart.tsx` es "el botón se deshabilita un `+1` tarde", nunca
una cantidad inválida (`setQuantity` clampea del lado del carrito
independientemente). Igual, ahora son TRES lugares con el mismo número mágico
(`cart.tsx`, `product-detail.tsx`, `product-card.tsx`). Recomiendo exportar
`MAX_LINE_QUANTITY` desde `src/lib/cart.tsx` en un slice futuro — es un
cambio de una palabra (agregar `export`) que elimina la triplicación sin
tocar ninguna lógica, pero como ese archivo estaba fuera del alcance de este
slice, no lo tomo como bloqueante acá.

**Nit sin severidad, para que quede anotado**: `handleIncrement` y
`handleDecrement` calculan el próximo valor a partir del `quantity` derivado
en el render (`quantity + 1` / `quantity - 1`) en vez de una actualización
funcional. Dos clicks disparados antes de que React re-renderice (no un
double-tap humano normal, sí un test automatizado que dispare eventos
sintéticos en la misma tarea) podrían subcontar. Es exactamente el mismo
patrón que ya usa el `Stepper` compartido (`onChange(Math.min(max, value +
1))` en `surfaces.tsx`), así que no es una regresión de este slice ni un
patrón nuevo — lo dejo mencionado como algo a tener en cuenta si
`test-engineer` escribe un test con `fireEvent.click` dos veces seguidas sin
esperar el render entre medio: el test tiene que aserit contra el DOM
re-renderizado en cada paso, no encadenar clicks a ciegas.

## T3 — Ícono de WhatsApp en el KDS

Cambio quirúrgico y correcto. Confirmé que `WhatsApp`
(`src/components/ui/whatsapp.tsx`) usa `fill="#25D366"` fijo (no
`currentColor`), consistente con el argumento de "es un logo, no texto". Los
dos usos (`order-card.tsx:328`, `transfer-tray.tsx:204`) van con `aria-hidden`
y acompañados de una etiqueta visible completa ("Avisar por WhatsApp" /
"Escribirle por WhatsApp"), así que el ícono no es el único portador del
dato y el argumento de WCAG 1.4.11 sostiene: la excepción de contraste
no-textual aplica a gráficos DECORATIVOS o reforzados por texto, no a un
ícono que sea la única pista. Acá el texto ya dice todo. Coincido con la
lectura del dev: el ~2:1 en claro es bajo pero no bloqueante en este contexto
puntual — y es MEJOR que el precedente ya aceptado en `store-dock.tsx`, donde
el mismo verde fijo se usa en un botón **icon-only** (sin texto visible,
solo `aria-label`) que este slice no tocó y que ya estaba en producción antes
de esta tanda.

## T4 — `schedule-track.tsx`

Revisé el archivo completo, no solo el diff. Tres puntos:

- **Radio `min(var(--radius-sm), 3px)`**: correcto y sigue el mismo idioma que
  `button.tsx` (`rounded-[min(var(--radius-md),10px)]`). Anclado al token, con
  techo en píxeles. Bien resuelto tras la corrección del coordinador.
- **`max(${width}%, 6px)`**: sintaxis válida de `max()` de CSS mezclando
  unidades, soportada en los navegadores modernos objetivo del proyecto.
  Resuelve el problema real de turnos sub-píxel sin inventar un mínimo en
  minutos que hubiera exigido tocar el cálculo de `left`/`width` en base de
  minutos.
- **`mix-blend-difference` sobre `--primary`**: verifiqué el argumento de
  forma independiente, no solo repetí el cálculo del dev log. `DayBar` se usa
  ÚNICAMENTE desde `schedule-editor.tsx` (grep confirmado, un solo call
  site), que a su vez solo se monta bajo `/admin/ajustes` — una ruta de
  Operate que **nunca** inyecta el `<style>` de marca: ese `<style>` scopeado
  solo lo emite `src/app/[store]/layout.tsx` (`buildThemeCss`). O sea que la
  preocupación del brief ("¿se cae el argumento con `/admin/apariencia`, que
  embebe la vitrina tematizada en un iframe?") no aplica: `/admin/apariencia`
  y `schedule-track.tsx` son superficies completamente distintas que nunca
  comparten árbol de render, y el iframe de preview de marca vive en OTRA
  page, con su propio documento HTML — no hay forma de que un color de marca
  cromático llegue a pintarse "debajo" de este marcador. El argumento de
  croma 0 sostiene con más margen del que el dev log reclama, no menos.
  Aprobado sin reservas.

`hourTicks`/`tickStepHours` operan sobre `axis.start`/`axis.end`, que
`computeWeekAxis` siempre redondea a enteros (`Math.floor`/`Math.ceil`), así
que no hay riesgo de acumulación de error de punto flotante en el `for` del
cálculo de marcas.

## T5 — Footer y mail de contacto

Grep de verificación repetido desde este review: cero apariciones de
`tomasizuel@gmail.com` en `src/`, `.env.example` o cualquier archivo de
código vivo — la única mención que queda es en el log de una tanda de
pipeline anterior (historial, no config). El footer sigue siendo Server
Component puro, sin `'use client'`, con los tres targets táctiles (`min-h-11`)
resueltos correctamente: dos `Link` del nav y el `<a mailto:>`, con la
etiqueta "¿Tenés un local?" como texto plano AFUERA del link (así el
`hover:underline` no subraya la frase entera). No es un kicker ni compite con
el heading de ninguna página — es texto de pie con el mismo peso que
"Privacidad"/"Términos", tal como pedía el dueño del producto.

## Disciplina de slice

Confirmé con grep que ningún agente tocó un archivo fuera de su lista
declarada en `01-tasks.md`. Las dos correcciones de comentarios en
`store-dock.tsx` (T3, segunda vuelta) están dentro del slice T3/T4 según el
propio `01-tasks.md` no las nombra explícitamente, pero el coordinador las
autorizó puntualmente y el diff final de `store-dock.tsx` no toca nada de
lógica — solo el ícono de Instagram (unificación real, ver abajo) y prosa de
comentario. No quedó ningún comentario describiendo un estado que ya no
existe: repasé los tres bloques de comentarios que la nota de la tarea
señalaba como "problema recurrente" y los tres están al día con el código
actual.

**Hallazgo real, ya corregido dentro de esta misma tanda**: la unificación de
`InstagramMark` → `Instagram` en `store-dock.tsx` no es cosmética, es la
corrección de un bug de consistencia visual real (mismo canal, dos glifos
distintos según de dónde entrara el usuario). Bien encontrado y bien
resuelto — grep confirma que `InstagramMark` no queda huérfano en ningún otro
archivo.

## Qué está bien

- Cero cambios fuera de `views/`, `app/legal/*` y una constante de
  `env.server.ts`: el corte por slice se respetó al pixel, sin invasión de
  `models/`, `controllers/` ni migraciones.
- El estado del stepper de T2 deriva 100% de `useCart().lines`, sin
  `useState` paralelo — exactamente el patrón que evita que la tarjeta y
  `/carrito` se desincronicen.
- Motion: un solo momento autorizado, aplicado en dos capas separadas
  (`animate-rise` al montar, `animate-bump` en cada cambio) sin que uno
  reinicie al otro, y con `prefers-reduced-motion` degradando a un estado
  final idéntico.
- T1 es el estándar correcto para "no se reprodujo": tres capas
  independientes, verificación contra la base real en cada una, y las
  teorías descartadas quedan documentadas con su razonamiento en vez de
  simplemente desestimadas.
- Las tres correcciones que pidió el coordinador en su propia revisión (T3/T4)
  quedaron todas resueltas con el mismo nivel de rigor que el resto del
  slice (medición real, no ajuste a ojo).

## Bloqueantes

Ninguno.

## Para anotar (no bloqueante, no requiere una nueva vuelta de esta tanda)

1. **`revalidatePath` después de escritura commiteada** en
   `confirmPendingChangeAction` (`src/controllers/admin.actions.ts:550/564/581`)
   — candidato a slice propio, prioridad media, encontrado por T1 y
   confirmado por este review.
2. **`MAX_LINE_QUANTITY` triplicado** (`lib/cart.tsx`, `product-detail.tsx`,
   ahora también `product-card.tsx`) — exportarlo de `cart.tsx` en un slice
   futuro que sí tenga permiso de tocar ese archivo.
