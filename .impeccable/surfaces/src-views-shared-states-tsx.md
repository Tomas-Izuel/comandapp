---
version: 1
slug: "src-views-shared-states-tsx"
primary_target: "src/views/shared/states.tsx"
related_targets: ["src/app/[store]/page.tsx","src/app/[store]/checkout/page.tsx","src/lib/store-hours.ts"]
---

# Vitrina cerrada por horario

**Alcance y modo.** Extiende `ClosedNotice` (`src/views/shared/states.tsx`) y su
uso en `src/app/[store]/page.tsx` y `src/app/[store]/checkout/page.tsx` para el
nuevo estado `storefrontGate() === 'closed_can_schedule'`. Modo **Persuade**: el
visitante todavía está decidiendo si comprar acá o en el local de al lado — un
cartel de error lo manda al de al lado.

**Audiencia y trabajo.** Alguien con hambre a las 16:00 pensando dónde va a
cenar, o alguien a las 23:40 que ya se resignó a que hoy no llega. En los dos
casos necesita dos datos en el mismo vistazo: **que hoy este local sí vende**, y
**cuándo puede pedir**. Nada de esto es un error: es el horario de un negocio
real, y se lee exactamente así.

**Lo que NO cambia.** Los otros tres estados de la precedencia (§7.8 de
`00-architecture.md`: `suspended`, `no_payment`, `paused`) siguen mostrando el
`ClosedNotice` **actual, sin CTA y sin próxima apertura** — son cierres que el
dueño o la plataforma decidieron a mano, y ahí no hay "próxima apertura" que
prometer. Solo `closed_can_schedule` es nuevo. El componente tiene que poder
distinguir los dos casos por prop (p. ej. un `canSchedule` o pasando
`reopensAt`/`scheduleHref` solo cuando corresponde), nunca por heurística sobre
el texto.

**Selected direction.** El aviso de hoy es un banner angosto (`bg-muted`, una
línea, `role="status"`) pegado debajo del hero. La variante nueva necesita dos
líneas de información (por qué está cerrado ahora + cuándo abre) y una acción
—"Programar pedido"— sin volverse una interrupción. No es un `Panel` (no se
anida sobre el hero) ni un `EmptyState` de página completa (la carta sigue
visible atrás, sin excepción: es la premisa del feature). Sigue siendo el mismo
banner de ancho completo, pero con altura para dos líneas de texto y un botón en
pastilla de 44px alineado a la derecha en desktop / debajo en mobile. Tono
informativo, nunca de alerta: ni rojo ni el ícono de warning — es una hamburguesería
contándote su horario, no un sistema que falló.

**Copy (rioplatense, decisiones):**
- Cuándo abre HOY: *"{Tienda} cierra por hoy — abre a las {hora}. Podés ver la
  carta y programar tu pedido."*
- Cuándo abre otro día (`nextOpening` cae mañana o después): *"{Tienda} está
  cerrada ahora — abre el {día} a las {hora}. Podés ver la carta y programar tu
  pedido para ese horario."*
- CTA: *"Programar pedido"* (no "Ver horarios" — nombra la acción, no la
  pantalla).
- Si `nextOpening()` devuelve `null` (no hay apertura dentro del horizonte de 7
  días — patrón de horario vacío en esos días, caso raro): degradar a
  *"{Tienda} está cerrada ahora. Volvé a probar más tarde."* sin CTA de
  programar (no hay ningún slot que ofrecer todavía).

**Estados que tienen que existir.** Cerrado con reapertura hoy mismo. Cerrado
con reapertura otro día (hasta 7). Cerrado sin apertura calculable (degradado,
sin CTA). Los tres estados de precedencia superior, sin cambios. Tienda sin
horarios cargados: nunca entra a este componente (`isOpenAt` con `ranges=[]` es
siempre `true`, así que `closed_can_schedule` no existe para esa tienda).

**Consecuencia en `checkout/page.tsx`.** Hoy esa page corta en seco con un
`EmptyState` de página completa para **cualquier** `!canTakeOrders(store)`. Con
`closed_can_schedule` eso es un bug nuevo: hay que dejar pasar a `CheckoutForm`
en vez de mostrar el callejón sin salida — el detalle de cómo entra en modo
"solo programar" es del brief del checkout (`checkout-form.tsx`). Acá solo se
señala la dependencia: la guarda de esa page tiene que consultar
`storefrontGate()`, no `canTakeOrders()` a secas.

**Accesibilidad.** `role="status"` se mantiene (cambio no disruptivo, se anuncia
solo). El CTA es un link/botón real con nombre accesible propio ("Programar
pedido"), nunca el texto entero del párrafo como target. Foco visible temado
(no default del navegador).

**Primitivas.** Ninguna nueva: es una variante de `ClosedNotice`
(`views/shared/states.tsx`) con un botón (`Button` de shadcn o
`iconButtonClass`/pastilla existente). No toca `surfaces.tsx`.
