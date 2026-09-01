---
version: 1
slug: "src-views-admin-clientes-cupones-campaign-sheet-tsx"
primary_target: "src/views/admin/clientes/cupones/campaign-sheet.tsx"
related_targets: ["src/views/admin/clientes/cupones/campaign-list.tsx","src/views/admin/clientes/cupones/coupon-list.tsx","src/lib/coupon.ts"]
---

# La hoja de campaña: la cuenta completa antes de un envío que no se deshace

**Alcance y modo.** La hoja (`vaul`) que manda un cupón por mail a un segmento del
padrón, abierta desde la acción **"Mandar por mail"** de una fila de cupón. Modo
**Operate**.

**Audiencia y trabajo.** El dueño del local. El trabajo es **decidir**, no
disparar: elegir a quién, ver la cuenta, y recién entonces mandar.

**El flujo es un paso de confirmación, no un botón que manda.**

```
elegir segmento  →  el servidor devuelve CampaignPreview  →  se muestra la
cuenta COMPLETA  →  recién ahí "Mandar"
```

Un envío que no se puede deshacer no se dispara con un click. Ésa es la razón de
que exista esta hoja en vez de un botón en la fila.

## Los tres segmentos, en palabras

`all` (*"Todos los clientes"*) · `top_n` (*"Los mejores N por plata gastada"*) ·
`min_spent` (*"Los que gastaron más de $X"*). El log de campañas los muestra
**siempre en palabras**, nunca como `top_n`.

## La cuenta que se muestra, y por qué son cuatro números y no uno

> *"42 en el segmento · 17 con email · 3 se dieron de baja · se manda a 14"*

Los tres primeros explican el cuarto. Sin ellos, "se manda a 14" de un padrón de
42 parece un error del producto — y el dueño abandona.

⚠️ **`withEmail − optedOut − willSend` NO siempre da cero**, y la pantalla tiene
que tolerarlo sin mentir: `willSend` cuenta **casillas distintas y sintácticamente
válidas**, no personas, porque un solo mail sale por casilla aunque dos clientes
la compartan. Cuando la resta no cierra, **no se inventa una cuarta línea con el
motivo**: los cuatro números son los cuatro números.

## El bloqueo por vencimiento: la parte que decide si esto sirve o hace daño

Con el cupo de **15 mails por día**, una campaña a 142 personas tarda **diez
días**. Si el cupón vence el viernes, la mitad del segmento recibe un código que
ya no sirve. **Es el peor resultado posible para la marca: peor que no mandar
nada.**

La hoja lo dice **antes** de confirmar, con las dos fechas enfrentadas:

> *"Se manda a 142 personas. Con el cupo de 15 por día son 10 días: el último mail
> sale el 10/09. **El cupón vence el 05/09.**"*

Si `fitsBeforeExpiry === false`, el envío se **rechaza**. Es un bloqueo y no una
advertencia, y el motivo es que **el daño es diferido e invisible**: el dueño
aprieta "Mandar", ve que arrancó bien, y el problema aparece el día seis cuando ya
no está mirando.

El error **nombra las tres salidas**, porque un error que no dice qué hacer no
sirve:

> *"Con este cupo, el último mail sale el 10/09 y el cupón vence el 05/09. Estirá
> la vigencia hasta el 10/09, mandá a menos gente, o escribinos para ampliar el
> cupo."*

Con `couponEndsAt` en `null` no hay nada que comparar y **no se bloquea nada**.

**Lo que NO se bloquea, pero sí se dice**: `maxRedemptions` menor que la cantidad
de destinatarios. Mandarle un cupón de 50 usos a 142 personas es práctica normal
—la tasa de canje es de un dígito—, así que la pantalla lo **informa** (*"Cupón
para 50 usos, se manda a 142 personas"*) y **no opina**. Tono neutro, no warning.

`daysNeeded` y `lastSendDate` los deriva `campaignDaysNeeded()` y
`campaignLastSendDate()` de `src/lib/coupon.ts`, en vivo mientras el dueño mueve
el segmento: **no se va al servidor por cada tecla.** La fecha se formatea en la
zona del **local**, porque el dueño la va a comparar a ojo con el vencimiento.

## La oferta comercial aparece en un momento exacto

**En el preview, y SOLO cuando `daysNeeded > 1`.** No en el header de la sección,
no permanente.

El argumento es de diseño: **una oferta siempre visible se vuelve mueble y se deja
de ver**; una que aparece en el instante en que el dueño acaba de leer "son 10
días" es una conversación que empieza sola. Es además el mismo instante en que el
bloqueo puede estar rechazándole la campaña, y el error ya nombra esta salida como
tercera opción.

El pedido reusa la **forma** de `store-payment-support` (el pedido de soporte de
la pantalla de Pagos), con un mensaje libre de hasta 500 caracteres. **Degrada, no
tira**: si el mail no sale, el panel muestra la dirección de ventas para que el
dueño escriba a mano. Un pedido comercial que no sale no rompe nada.

## El log de campañas: cinco estados, y dos que no se pueden confundir

Sección de solo lectura debajo de la de cupones. Por fila: cupón · segmento en
palabras · cuándo · resultado (*"17 enviados · 1 falló"*).

**`stopped` y `failed` son distintos y piden dos acciones distintas del dueño:**

- **`failed`** — falló **lo nuestro**. Conviene reintentar.
- **`stopped`** — **la oferta dejó de valer** (el cupón venció, se agotó, o el
  dueño lo pausó). No hay nada que reintentar, y el motivo se muestra en palabras.

Tratarlos con la misma pill sería decirle al dueño "algo salió mal" cuando lo que
pasó es que **su promoción funcionó tan bien que se agotó**. `exhausted` es una
buena noticia y la pantalla tiene que dejarlo claro.

**No se manda un mail avisando que una campaña se cortó**, y es deliberado: el
único caso que llega ahí es uno que el dueño causó (pausó el cupón) o uno que
quería (se agotó). Gastar cupo transaccional en avisar algo que este panel ya
muestra, en un feature cuyo problema central **es** el cupo, sería incoherente.

## Selected direction

Hoja con tres bloques verticales: **segmento** (`RadioGroup` de tres, con el input
de N o de monto que aparece según la opción) · **la cuenta** (los cuatro números
como una línea de texto, más el bloque de días/fechas, más la oferta comercial
cuando corresponde) · **asunto y mensaje** (dos campos). Botón primario "Mandar",
deshabilitado con el motivo visible cuando `fitsBeforeExpiry === false` o
`willSend === 0`.

La cuenta es **texto**, no tarjetas. Cuatro tarjetas de métrica para cuatro
números que se leen en una línea es exactamente la plantilla que el piso de
calidad prohíbe.

## Estados que tienen que existir

Segmento sin elegir · `all` · `top_n` con N vacío / con N · `min_spent` con monto
vacío / con monto · **`willSend === 0`** (el botón no se ofrece y se dice por qué:
nadie del segmento tiene email, o todos se dieron de baja) · `daysNeeded === 1`
(**sin** oferta comercial) · `daysNeeded > 1` (con oferta) · `fitsBeforeExpiry ===
false` (bloqueado, con las tres salidas nombradas) · cupón sin `endsAt` (nunca
bloquea) · `maxRedemptions < willSend` (informa, tono neutro) · mandando ·
encolada con éxito · el pedido de cupo enviado / fallado (con la dirección de
ventas a la vista) · log vacío · log con `queued` · `sending` · `sent` ·
`stopped` con cada uno de los tres motivos · `failed` · mobile sin scroll
horizontal.

## Constraints

- Sin kicker/eyebrow. Sin `Panel` dentro de `Panel`. Sin métrica-héroe.
- `.tabular` en todo número y toda fecha.
- `campaignDaysNeeded()`, `campaignLastSendDate()` y `describeDiscount()` de
  `src/lib/coupon.ts`. La vista **no** replica la cuenta del cupo.
- El botón "Mandar" **nunca** se habilita con `fitsBeforeExpiry === false`: el
  servidor también lo rechaza, pero descubrirlo después de apretar es la
  experiencia que este bloqueo existe para evitar.
- Targets de 44px, foco visible, `aria-describedby` en el botón deshabilitado
  apuntando al motivo.
- Tailwind v4: `rounded-(--radius)`, **nunca** `rounded-[--radius]`.
