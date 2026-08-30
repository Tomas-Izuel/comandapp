# Ajustes en tres páginas

**Fecha:** 2026-08-30 · **Origen:** `/impeccable shape` · **Estado:** aprobado por el dueño del producto.

## Problema

`/admin/ajustes` son 8 bloques en un solo scroll (~2500 líneas entre
`settings-form.tsx` 1130, `schedule-editor.tsx` 756, `location-map-field.tsx` 562).
El dueño nunca entra "a revisar los ajustes": entra a cambiar **una** cosa.

El síntoma que se ve es el scroll. El defecto de fondo es otro: **hoy conviven
tres mecanismos de guardado en la misma pantalla y nada los distingue.**

| Control | Cómo se guarda | Hoy vive |
|---|---|---|
| 26 campos (`useForm`) | barra pegajosa "Guardar ajustes" | bloques 1–6 |
| `CourierCollectsPaymentField` | código de 6 dígitos por mail, se aplica solo | **adentro** del bloque de Envío |
| `ScheduleEditor` | RPC transaccional, se aplica solo | bloques 7–8 |

Consecuencias reales, no hipotéticas:

- El encargado toca el switch del repartidor, ve "Guardar ajustes" abajo, y no
  tiene forma de saber que ese switch no depende de esa barra.
- Al revés: edita la tarifa de envío, baja hasta Horarios, guarda un horario y
  se va. La tarifa nunca se guardó.

## Decisión

Sub-rutas reales bajo `/admin/ajustes/*` con nav horizontal de `<Link>`, en tres
páginas. **El alcance del "Guardar" de cada página es exactamente lo que está en
pantalla.**

| Ruta | Título | Contenido |
|---|---|---|
| `/admin/ajustes` | El local | datos, dirección + mapa, canales |
| `/admin/ajustes/pedidos` | Pedidos y envío | tomando pedidos, pago en el local, envío propio, programados, multiplicador |
| `/admin/ajustes/horarios` | Horarios | horario semanal + excepciones (`ScheduleEditor`) |

### Por qué sub-rutas y no tabs de cliente

- Deep link real: "andá a Ajustes → Horarios" es una URL.
- Cada page hace solo su fetch: `getStoreHoursData` y `getMaxPrepMinutes` dejan
  de cargarse para quien vino a corregir el WhatsApp.
- **Es imposible guardar un campo que no estás viendo.** Con tabs de cliente, un
  solo `useForm` mantiene vivos los cambios de una tab inactiva y la barra los
  guarda igual. Ese es justamente el defecto que vinimos a matar.
- `ScheduleEditor` queda en la única página **sin** barra "Guardar", así que la
  ausencia de la barra pasa a significar algo.

### Por qué este agrupamiento y no cuatro páginas

Las dependencias cruzadas son reales y no se pueden partir:

- `scheduledDeliveryEnabled` está deshabilitado si `deliveryEnabled` está
  apagado, y el hint dice literalmente *"activá 'Hacemos envíos a domicilio'
  arriba"*.
- Los minutos de viaje del envío se suman al ETA que produce el multiplicador de
  demanda. Hay un comentario en el código pidiendo explícitamente que las dos
  secciones queden contiguas.

Con los tres en `pedidos/`, el hint sigue siendo literalmente cierto y las tres
se calibran mirando una sola pantalla, en un solo submit.

## La consecuencia que no es cosmética

`updateStoreSettings` (`store.model.ts:164`) escribe **las 28 columnas** desde un
`StoreSettingsInput` completo. Si la página de perfil manda solo sus campos,
**borra la configuración de envío**. El corte obliga a tocar el backend.

Solución: **dos acciones con su propio schema `.pick()`ado**. El schema ya está
construido para esto — el comentario de `store.model.ts:172` explica que se
evitó `.refine()` justamente para que `.pick()` siguiera funcionando.

Dos acciones **nombradas**, no una que acepte un parcial arbitrario: si el
alcance lo elige el browser, el corte no protege nada. Mismo criterio que los
grants por columna del repo.

### Alternativa rechazada

Que cada página cargue el objeto completo y lo reenvíe entero con solo sus
campos sucios. No requiere backend, pero resucita exactamente el problema: una
pestaña vieja pisando un cambio que no ve.

## `timezone` y `currency` salen del set escribible

Las dos viajan en el form pero **no se editan en ninguna parte** (solo
`defaultValues`, `settings-form.tsx:66-67`). En el corte no tienen página, y una
página que las reenvía es una página que puede pisarlas sin que nadie las haya
tocado. Salen del set escribible; se siguen leyendo de `session.store` para
formatear plata y fechas.

## Trampas que el corte introduce

- **`revalidatePath('/admin/ajustes')`** (`admin.actions.ts:514`) no alcanza a
  las sub-rutas. Pasa a `revalidatePath('/admin/ajustes', 'layout')`. Silencioso
  si se olvida.
- **`isNavActive`** (`shell.tsx:48`) usa `startsWith`: "Ajustes" del sidebar
  sigue marcado en las tres sub-rutas. Ya funciona, no se toca.
- **`pedidos/` sigue teniendo dos controles que se aplican solos**
  (`AcceptingOrdersToggle`, `CourierCollectsPaymentField`) al lado de campos que
  esperan "Guardar". Necesita una convención visual que los distinga: es el
  trabajo de diseño que el routing por sí solo no resuelve.

## Anti-objetivos

- Ni una columna nueva, ni una migración.
- `ScheduleEditor` y `LocationMapField` se **mueven**, no se reescriben.
- El sidebar sigue con 8 items: Ajustes es un destino, no una carpeta.
- `courier_collects_payment` no vuelve a `storeSettingsInputSchema` bajo ninguna
  circunstancia.
