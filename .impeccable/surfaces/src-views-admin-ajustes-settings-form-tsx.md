---
version: 1
slug: "src-views-admin-ajustes-settings-form-tsx"
primary_target: "src/views/admin/ajustes/settings-form.tsx"
related_targets: ["src/views/admin/catalogo/confirm-delete-button.tsx","src/views/admin/shared/confirm-with-code.tsx","src/controllers/admin.actions.ts"]
---

# Diálogo destructivo: pausar pedidos

**Alcance y modo.** El toggle `acceptingOrders` existente en
`src/views/admin/ajustes/settings-form.tsx` ("Tomando pedidos"), más un
componente de diálogo compartido nuevo, reusado también desde el editor de
excepciones (`schedule-editor.tsx`, brief hermano). Modo **Operate**. Es,
textual, **"el control de mayor radio de todo este trabajo"**: apagarlo puede
cancelar pedidos ya pagados.

**Audiencia y trabajo.** El dueño o encargado que aprieta "Tomando pedidos" para
cerrar antes de lo previsto — un corte de luz, se quedaron sin un ingrediente,
cierran una hora antes un martes flojo. Hoy ese toggle es inocuo (un booleano
más que se guarda con el resto del formulario). Con programados, apagarlo puede
**cancelar plata que ya está cobrada** — esa consecuencia tiene que verse
**en el momento del toggle**, no descubrirse después en el historial.

**Por qué deja de ser "un campo más del formulario".** Hoy `acceptingOrders`
viaja adentro del mismo `react-hook-form` que nombre, teléfono, dirección, etc,
y todo se guarda junto al tocar "Guardar". Un cambio destructivo no puede
depender de que el dueño toque "Guardar" varios campos después y sin verlo
venir: apagar el toggle tiene que abrir el diálogo **ahí mismo**, antes de que
el cambio se aplique — mismo principio que ya usan `ConfirmWithCode`
(cambios sensibles de pago) y `ConfirmDeleteButton` (borrar un producto) en
este mismo árbol de vistas. El patrón correcto es extraerlo del submit general
a su propia acción confirmada, no inventar un cuarto mecanismo.

**Selected direction.** Un diálogo (`Dialog` de shadcn, mismos primitivos que ya
usa `ConfirmDeleteButton`) que se abre al intentar apagar el toggle, con el
conteo **recién calculado** —no cacheado del último render— de pedidos
programados de la noche en curso que todavía no dispararon:

> *"Esto cancela 6 pedidos programados de esta noche. 4 están pagados
> ($47.800). El reembolso lo gestionás vos desde Mercado Pago."*

Las tres piezas de información van **siempre**, en ese orden: cuántos se
cancelan, cuántos de esos están pagados y por cuánto, y la frase del reembolso
manual **con todas las letras** — no es negociable, viene de la decisión de
producto. Acción primaria `variant="destructive"` ("Pausar y cancelar" o
similar — nombra la consecuencia, no un genérico "Confirmar"); cancelar vuelve
el toggle a su posición anterior sin aplicar nada.

**El caso sin consecuencia.** Si el conteo da 0 (no hay programados esta noche),
un diálogo de "vas a cancelar 0 pedidos" es ruido que le resta crédito a la
próxima alerta real. En ese caso el toggle se apaga directo, sin interrumpir —
o, como mucho, un diálogo liviano sin tono destructivo ("No hay pedidos
programados esta noche, se pausa sin problema"). Encender de vuelta el toggle
nunca es destructivo y no necesita diálogo.

**Reuso desde excepciones por fecha.** El mismo diálogo (parametrizado por la
lista de pedidos afectados, no una copia) se dispara al cerrar una fecha del
calendario de excepciones que tiene programados adentro (brief
`schedule-editor.tsx`) — mismas tres piezas de información, singular o plural
según corresponda, mismo botón destructivo.

**Estados que tienen que existir.** Conteo en 0 (sin fricción). Conteo > 0, con
y sin pagados dentro del grupo. Cargando el conteo (breve, tiene que sentirse
inmediato — es un `count(*)` acotado a "esta noche", no una consulta pesada).
Error al cancelar (se muestra inline en el diálogo, mismo patrón que
`ConfirmDeleteButton`, el diálogo no se cierra solo). Confirmado con éxito
(toast + el toggle queda apagado).

**Primitivas.** Un componente nuevo, recomendado en
`src/views/admin/shared/` (p. ej. `cancel-scheduled-orders-dialog.tsx`) —
admin-scoped, **no** en `views/shared/surfaces.tsx` (esa es gramática de cara
al cliente). Se construye sobre los primitivos de `@/components/ui/dialog` que
ya usa `ConfirmDeleteButton`, no sobre uno nuevo.
