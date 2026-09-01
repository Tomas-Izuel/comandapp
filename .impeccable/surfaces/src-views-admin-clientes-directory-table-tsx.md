---
version: 1
slug: "src-views-admin-clientes-directory-table-tsx"
primary_target: "src/views/admin/clientes/directory-table.tsx"
related_targets: ["src/views/admin/clientes/customer-row.tsx","src/views/admin/clientes/whatsapp-message.ts","src/views/admin/clientes/format.ts","src/app/admin/(app)/clientes/page.tsx","src/app/admin/(app)/clientes/layout.tsx"]
---

# El padrón de clientes, y el WhatsApp que ES la reactivación

**Alcance y modo.** `/admin/clientes`, la primera de las dos tabs de la sección.
Modo **Operate**: la vara es `/admin/pedidos`, no una landing. `width="table"` en
`PageFrame`, mismo criterio que el tablero.

**Audiencia y trabajo.** El dueño del local, **nunca `staff`** (`ownerOnly: true`
en el rail, `role === 'owner'` en la page). El trabajo real no es "ver una tabla":
es **decidir a quién escribirle**. Todo lo demás de la pantalla existe para
sostener esa decisión.

**Lo que la tabla es.** Una fila por cliente, ordenada por plata gastada
descendente, con el `mailto:` cuando dejó email y el WhatsApp siempre. En mobile
colapsa a filas apiladas: nombre + gastado arriba, el resto abajo.

## El botón de WhatsApp no es un `tel:` con otro ícono

Es **la** función de reactivación del producto. Decisión del dueño (2026-08-31),
textual: *"Reactivarlos es un mensaje de whatsapp, mas personal. Boton para ir a
watsapp con el mensaje pre cargado"*. Por eso **no existe** un cuarto segmento de
campaña para reactivación: la reactivación es uno a uno.

**El helper es `whatsappHref(phoneE164, text?)` de `src/lib/whatsapp.ts`. No se
arma la URL a mano.** (`store-dock.tsx` la arma a mano y su propio comentario dice
que es deuda: es deuda, no ejemplo.)

**Tres mensajes, y el contexto elige.** No es un editor de plantillas.

| Cuándo | Prefill |
|---|---|
| `daysSinceLastOrder >= 30` | reactivación, con el link a la carta |
| El dueño elige un cupón `active` del menú | el código y el descuento en palabras |
| Default | saludo simple |

Los dos primeros textos ya están en `whatsapp-message.ts`. **El tercero —el menú
de cupones— es lo que suma T4B**, y es el único camino por el que un cupón llega a
un cliente sin gastar cupo de mail: a 15 mails por día, va a ser el más usado.

`{nombre}` es **solo el primer token** de `displayName` (`firstToken()`): la gente
escribe "Juan Pérez" y nadie saluda por apellido. `{descuento}` sale de
`describeDiscount()`, la misma función que arma la etiqueta en el panel y en el
mail — **nunca una frase armada acá**. `{link}` es `storeUrl(slug)`.

## Cuatro reglas del copy, las cuatro duras

1. **Nunca la plata del cliente.** *"Gastaste $84.000 con nosotros"* es invasivo y
   no se escribe, **aunque el dato esté en la misma fila**.
2. **Nunca un hecho que no tenemos.** *"Sabemos que te gustan las dobles"*: el
   producto no registra eso. `PRODUCT.md` prohíbe insinuar datos inexistentes.
3. **Suena a persona, no a sistema.** Rioplatense, sin "Estimado cliente", sin
   "usted", sin mayúsculas de asunto.
4. **Arranca editable, y es una propiedad del diseño.** El prefill cae en el campo
   de texto de WhatsApp: el dueño lo lee, lo retoca, y recién ahí manda. Es lo que
   hace aceptable un texto genérico — no es lo que se envía, es el punto de
   partida.

## La baja es del cliente, no del canal

Con `marketingOptOutAt`, **los dos** botones se atenúan: el `mailto:` y el
WhatsApp. La baja la pidió la persona, no el medio, así que un canal que sigue
habilitado porque "el opt-out era de mails" es la clase de tecnicismo que rompe la
confianza. Estado atenuado con el motivo accesible en el `aria-label`, no un botón
ausente: un botón que desaparece no explica nada.

## Lo que esta pantalla NO puede prometer

**Un WhatsApp no deja registro.** El producto no puede saber si el dueño mandó el
mensaje, ni cuándo, ni qué terminó escribiendo. **Consecuencia concreta: el dueño
puede escribirle dos veces al mismo cliente y el padrón no se lo va a decir.**

Se descartó a conciencia un "¿lo mandaste?" al volver y un registro optimista al
click: **un registro que depende de que el dueño vuelva y confirme es un registro
que miente**, y uno que miente sobre a quién le hablaste es peor que ninguno.

**Prohibido en esta pantalla**: cualquier marca de "contactado", "último mensaje",
badge de historial de WhatsApp, o contador de mensajes. **Permitido**: lo que sí
sabemos — `lastOrderAt`, `daysSinceLastOrder`, `ordersCount`.

## Selected direction

Tabla densa con la línea de tres números arriba (clientes · con email · plata
total) como texto, **no como tarjetas de métrica** — la plantilla de métrica-héroe
está prohibida. `SearchField` al lado. Por fila: nombre + primer token destacado,
plata gastada en `.tabular`, pedidos, ticket promedio, días desde el último, y los
dos botones de contacto de 44px al final.

Las notas del dueño son **inline y opcionales**, no un campo siempre visible: la
mayoría de las filas no tiene nota y un textarea vacío por fila es ruido.

## Estados que tienen que existir

Sin clientes todavía (`EmptyState` que **enseña**: *"Acá van a aparecer los
clientes cuando entren los primeros pedidos"*, no *"No hay datos"*) · sin
resultados de búsqueda · tabla con contenido · fila sin email · fila dada de baja
(los dos botones atenuados) · fila sin pedidos entregados (plata en $0 y días en
`—`, **no un hueco**) · guardando una nota · nota que falla (error inline, no se
pierde lo tipeado) · mobile apilado · **menú de cupones abierto / sin cupones
activos** (el menú no se ofrece si no hay ninguno: un menú vacío es peor que
ningún menú).

## Constraints

- Sin kicker/eyebrow. Sin `Panel` anidado. Sin la grilla de tarjetas
  icono+título+texto como estructura.
- `.tabular` en toda plata y todo día. Monoespaciada **solo para medición**.
- Targets de 44px, foco visible, `aria-label` que nombra a la persona en cada
  botón de contacto.
- Nada de emoji: `lucide-react` o el SVG propio de `components/ui/whatsapp`.
- Tailwind v4: `rounded-(--radius)`, **nunca** `rounded-[--radius]`.
