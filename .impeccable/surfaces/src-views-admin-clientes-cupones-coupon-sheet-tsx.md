---
version: 1
slug: "src-views-admin-clientes-cupones-coupon-sheet-tsx"
primary_target: "src/views/admin/clientes/cupones/coupon-sheet.tsx"
related_targets: ["src/views/admin/clientes/cupones/coupon-list.tsx","src/views/admin/clientes/cupones/coupon-detail.tsx","src/app/admin/(app)/clientes/cupones/page.tsx","src/views/admin/shared/confirm-with-code.tsx","src/lib/coupon.ts"]
---

# La hoja del cupón: dos tiempos, y el peor caso a la vista

**Alcance y modo.** La hoja (`vaul`) de crear y editar un cupón, dentro de
`/admin/clientes/cupones`. Modo **Operate**. La página son **dos secciones
apiladas con `PanelHeading`** —Cupones y Campañas—, **no** tabs anidadas: misma
decisión y mismo motivo que el brief de la bandeja de programados.

**Audiencia y trabajo.** El dueño del local, nunca `staff`. El trabajo es armar
una promoción **sin regalar plata sin querer**. Cada campo de este formulario es
dinero, y el error no se ve el día que se comete: se ve cuando el código ya
circula.

**Hoja y no modal, con justificación.** El piso de calidad dice que "modal como
primera idea es pereza". Acá la hoja se gana el lugar: son diez campos donde cada
uno mueve plata, hay foco protegido real, y es el patrón que el producto ya usa
para la hoja de producto de la vitrina.

## Los dos tiempos, que es lo que hace tolerable el segundo factor

```
"Guardar borrador"  →  el cupón existe, status = draft, NO expone NADA,
                       se edita todas las veces que haga falta, gratis
"Activar"           →  pide el código de 6 dígitos por mail  →  status = active
```

**El borrador es gratis e ilimitado, y eso es el diseño entero.** El flujo normal
es **un código por cupón**, no uno por edición: todo se acomoda en borrador y el
código se pide una sola vez, al final. Sin esta separación, activar un cupón
costaría un ida y vuelta por mail por cada corrección, y a 15 mails de cupo
diario eso es inviable.

**Al pie de la hoja, un aviso que se actualiza mientras el dueño tipea**, según
`requiresConfirmation(current, next)` de `src/lib/coupon.ts` — la misma función
que corre en el servidor:

> *"Este cambio se aplica al instante"* · *"Este cambio pide un código por mail"*

**Nadie descubre el segundo factor después de apretar guardar.** Ése es el punto
del aviso, y por eso va al pie y no en un tooltip.

## La asimetría: apagar está SIEMPRE a un click

**"Pausar" nunca pide código.** El escenario completo: un código se filtró, está
sangrando plata, y el dueño no puede apagarlo hasta que llegue un mail — un mail
que sale por Resend, que es el recurso escaso de todo este feature, y que puede
tardar, caer en spam o no salir. El repo ya tiene el principio escrito para la
vista previa de marca: **un modo que solo RESTA capacidad no es una escalación.**

Aprobado por el dueño del producto, textual: *"No apagar se apaga sin codigo"*.

**Consecuencia de diseño**: "Pausar" no es una acción escondida en un menú de tres
puntos ni detrás de un diálogo de confirmación. Está a la vista, en la fila y en la
hoja, y es lo primero que alguien busca cuando algo va mal.

## El peor caso en pesos, arriba del botón de guardar

Calculado **en vivo** con `worstCaseCents()`. Es el número que contesta "¿cuánto
me puede costar esto si el código se filtra?", y va **antes** de guardar, no
después.

⚠️ **`worstCaseCents()` devuelve `null`, y `null` significa SIN COTA.** Con
`maxDiscountCents` en null y descuento porcentual, el techo lo pone el carrito más
caro que alguien arme: **no hay techo**. La UI **no puede** mostrar un guión ni un
"$0" ahí: tiene que decir que no hay tope, en palabras, y ese es el estado que más
importa que quede impecable de toda la hoja. Un cupón sin cota mostrado como "—"
es el peor resultado posible de esta pantalla.

## Los números de uso dicen la verdad, y la verdad tiene tres partes

Mientras hay pedidos en vuelo, **el número no es el de canjes concretados.**

- **En la lista**, la columna "Usos" muestra el **cupo ocupado**:
  `reservedCount + redeemedCount` sobre `maxRedemptions` (*"7 / 50"*). Es el
  número que contesta la pregunta operativa: *¿al siguiente cliente le va a
  andar?*
- **En la hoja**, el desglose en **una línea de texto**, no en tres tarjetas:
  *"12 canjes · 2 reservados · quedan 36 de 50"*. "Reservados" lleva un helper al
  lado: *"pedidos con el cupón que todavía no se entregaron"*.
- **Los "liberados" NO van en el titular**: son diagnóstico. Van como `StatusPill`
  en su fila de la lista de canjes, con el motivo.
- Las tres métricas del detalle (canjes · descontado · facturado) cuentan **solo
  `redeemed`**. Facturación sobre un pedido reservado que todavía puede morir es
  un número falso, y es el número con el que el dueño decide si repite la promo.

Los tres agregados van como **una línea de texto arriba de la lista de canjes**:
*"43 canjes · $64.000 descontados · $312.000 facturados"*. **Nada de tarjetas de
métrica ni de la plantilla de métrica-héroe.**

## El estado que se muestra es DERIVADO

`couponState()` devuelve `draft | scheduled | active | paused | expired |
exhausted`. Los tres últimos **no existen en la base**: se calculan. La
`StatusPill` los muestra a todos por igual, pero **la hoja no ofrece "activar" un
cupón `expired`** sin estirar antes la vigencia — y el aviso del pie ya dice que
estirarla pide código.

## Selected direction

Campos en este orden, que es el orden en que se piensa una promoción: nombre
interno · código (con un botón **"Generar"** al lado, que es el default
recomendado) · tipo de descuento (`RadioGroup`) · valor · tope de descuento (solo
si es %) · mínimo de subtotal · vigencia desde/hasta · tope de usos total · tope
por teléfono · métodos de pago (checkboxes, `null` = todos).

`ConfirmWithCode` al pie, **el mismo componente** que usan las credenciales de
Mercado Pago y la cuenta bancaria. Sin un segundo flujo, sin una segunda estética
de código.

Un cupón con canjes **no se borra**: la acción es "Pausar". Si el `RESTRICT` de la
base rechaza un borrado, el mensaje es *"Este cupón ya se usó: se puede pausar, no
borrar."* — nunca el texto de la constraint.

## Estados que tienen que existir

Sin cupones (`EmptyState` que **enseña** qué es un cupón y qué habilita) · hoja
nueva vacía · borrador guardado · borrador con el aviso "se aplica al instante" ·
edición con el aviso "pide un código" · **peor caso acotado** · **peor caso SIN
COTA** · pidiendo el código · código rechazado (la hoja **no pierde lo tipeado**)
· intentos agotados (el cupón conserva sus valores viejos: **nunca queda a medio
modificar**) · activado con éxito · pausado · `scheduled` · `expired` ·
`exhausted` · con reservas vivas (el desglose de tres partes) · con canjes
liberados (pill con motivo) · sin canjes todavía · borrado rechazado por uso ·
mobile: la hoja entra sin scroll horizontal.

## Constraints

- Sin kicker/eyebrow. Sin `Panel` dentro de `Panel`. Sin métrica-héroe.
- `.tabular` en toda plata, todo porcentaje y todo contador.
- `describeDiscount()` y `couponState()` de `src/lib/coupon.ts`: **la vista no
  arma la frase del descuento ni deriva el estado por su cuenta.** Son los mismos
  helpers que usa el mail.
- La vista **no calcula el descuento que se va a cobrar**. Eso lo hace Postgres.
- Targets de 44px, `aria-invalid` + `aria-describedby` por campo con error.
- Tailwind v4: `rounded-(--radius)`, **nunca** `rounded-[--radius]`.
