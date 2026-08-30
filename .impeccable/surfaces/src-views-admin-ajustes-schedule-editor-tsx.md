---
version: 1
slug: "src-views-admin-ajustes-schedule-editor-tsx"
primary_target: "src/views/admin/ajustes/schedule-editor.tsx"
related_targets: ["src/app/admin/(app)/ajustes/page.tsx","src/views/admin/ajustes/settings-form.tsx","src/controllers/admin.actions.ts"]
---

# Editor de horarios y excepciones en Ajustes

**Alcance y modo.** Componente nuevo `src/views/admin/ajustes/schedule-editor.tsx`,
montado desde `src/app/admin/(app)/ajustes/page.tsx` junto a `SettingsForm`
existente. Modo **Operate**, sin excepción — es exactamente la vara de
`operate.md`: familiaridad, densidad, poder cargarlo una vez y no volver a
pensarlo.

**Audiencia y trabajo.** El dueño, cargando el horario **una sola vez** (y
volviendo rarísima vez). No es alguien que piense en "el día que abre" como
concepto de base de datos: piensa en "los viernes cerramos tarde". La UI tiene
que traducir ese lenguaje al modelo (`opens_at_minute`+`duration_minutes`,
convención "pertenece al día que abre") sin que el dueño tenga que entenderlo.

**Selected direction — la semana.** Siete filas, lunes a domingo **en ese
orden visual** (aunque `day_of_week` interno sea 0=domingo por convención de
`Date#getDay()` — la UI reordena, no el dato). Cada fila admite 0 rangos
("Cerrado", estado explícito) o de 1 a 4 rangos ("Agregar rango" agrega otra
fila de dos `<input type="time" step="900">` + botón de borrar, mismo patrón de
lista repetible que ya existe en el ABM de catálogo para grupos de opciones —
revisar `option-groups-editor.tsx` antes de inventar el patrón de nuevo). Un
rango donde la hora de cierre es **anterior** a la de apertura (18:00 → 02:00)
se expresa tal cual, sin pedirle al dueño pensar en "pertenece al viernes": la
fila muestra un texto chico e inline —*"cruza la medianoche"*— para que quede
claro que el negocio entiende lo que cargó, y la traducción a
`(day_of_week, opens_at_minute, duration_minutes)` la hace el `lib` (T1), no el
formulario.

**El estado "sin horarios = siempre abierta".** Cuando las 7 filas están vacías
(local recién dado de alta), no es un error ni un formulario incompleto: es el
comportamiento **actual** de toda tienda hoy. Un aviso inline, tono neutro (no
`warning`, no `destructive` — mismo tono que `bg-muted`/informativo del resto
del producto): *"Sin horarios cargados, tu local está siempre abierto."* con un
CTA suave a cargar el primer rango, nunca bloqueante.

**El explicador de lead time.** Debajo de la semana, una sola línea que se
recalcula en vivo contra el **cierre más tardío de toda la semana** (no una por
fila — combinatoria innecesaria para un dato que solo importa una vez, al
guardar) y el `prep_minutes` más alto del catálogo disponible **de verdad**
(dato que el controller de lectura de Ajustes tiene que sumar —
`admin.controller.ts`, T1): *"Se aceptan pedidos hasta las 23:30. Tu producto
más lento tarda 25 min, así que un pedido de las 23:29 sale a las 23:54."* Es
prosa explicativa, no un badge ni una métrica-héroe.

**Selected direction — excepciones por fecha.** ⚠️ **Hallazgo de contrato, no
solo de diseño** (ver `02-shape.md`): ni `00-architecture.md` §2.4 ni
`01-tasks.md` (que lo lista explícitamente en "Fuera de alcance") dejan
preparado un modelo, RPC o schema para esto — las decisiones que me pasaron
para este shape son posteriores a esos documentos y lo dan por decidido. Shapeo
la superficie igual, tal como se me pidió, pero el hilo principal tiene que
resolver esa discrepancia (agregar la tabla/RPC de T0, o confirmar que sigue
fuera de alcance) antes de que T4 pueda implementar esta parte.

Con eso señalado: la superficie es una **lista**, no una grilla de calendario
visual — un `<input type="date">` nativo ya trae su propio selector de fecha en
mobile y desktop, así que dibujar un calendario propio es una superficie nueva
para un control que rara vez se toca. Cada excepción es una fila: fecha +
"Cerrado todo el día" (toggle) o rango(s) propio(s) para esa fecha (mismo
componente de fila de rango que la semana, reusado). Lista ordenada
cronológicamente, con "Agregar excepción" arriba. Cerrar una fecha que tiene
programados adentro dispara el **mismo diálogo destructivo** que pausar
pedidos (brief `settings-form.tsx` / pausar pedidos) — mismo componente,
parametrizado por la lista de pedidos afectados, no una copia.

**Copy sobre `accepting_orders` (re-encuadre, decisión §2.3 de
`00-architecture.md`).** El toggle sigue llamándose "Tomando pedidos" (no se
invierte el booleano), pero el texto de ayuda pasa de "Apagalo para pausar el
local sin tocar el catálogo" a algo que deje claro que es un freno **encima**
del horario, no el horario mismo: *"Es el freno de mano: se aplica encima del
horario. Apagalo para cerrar ahora aunque el horario diga que estás abierto."*
El comportamiento destructivo de apagarlo es el brief de al lado
(`settings-form.tsx`/pausar pedidos) — acá solo el copy que lo contextualiza.

**Estados que tienen que existir.** Semana vacía (siempre abierta). Semana
cargada con 1-4 rangos por día. Rango que cruza medianoche (indicador inline).
Guardado en curso / guardado fallido (mismo patrón que ya usa `SettingsForm`
para su propio submit — toast + error inline por día). Error del RPC
(solapamiento, más de 4 rangos) legible junto al día que falla, no en un cartel
genérico arriba de todo. Lista de excepciones vacía. Excepción con programados
adentro (dispara el diálogo).

**Primitivas.** El par "fila de rango con borrar + agregar" se repite en dos
lugares de esta misma pantalla (la semana y las excepciones): si no existe ya
un helper repetible en `src/views/admin/shared/`, vale la pena extraerlo ahí
(NO en `views/shared/surfaces.tsx`, que es gramática de cara al cliente) —
recomendación, no mandato; revisar antes `option-groups-editor.tsx` por si el
patrón ya está resuelto y solo hay que reusarlo.
