# Horario semanal como línea de tiempo

**Modo Operate.** Reemplaza el estado de reposo del horario semanal en
`schedule-editor.tsx`: siete tarjetas apiladas de ~140px (≈1050px para la semana
entera, antes del explicador y de las excepciones) pasan a siete pistas
horizontales con el horario dibujado como barra.

**Audiencia y trabajo.** El dueño, que carga el horario una vez y después
**vuelve a verificarlo**, no a editarlo. El reposo tiene que responder "¿está
bien cargado?" de un vistazo; la edición es el caso raro y puede costar un tap.

## Las tres consecuencias de elegir barras

Elegido por el dueño del producto (2026-08-30) contra un resumen de siete líneas
de texto. Las tres objeciones que se plantearon son parte del contrato:

### El eje se deriva de los datos

Nada de 00:00–24:00: una hamburguesería quedaría apretada contra el borde
derecho. El eje va **de la apertura más temprana al cierre más tardío de la
semana**, redondeado a horas enteras, con **span mínimo de 8h** para que un local
de un solo turno no dibuje una barra que ocupa todo. Se recalcula al editar.

Que sea derivado y no fijo es lo que lo hace legible sin explicarlo: el eje
siempre es "tu semana". Bordes a resolver: semana vacía (no hay eje, se muestra
el aviso de "siempre abierta") y un solo día cargado (el span mínimo evita el eje
degenerado).

### La hora exacta no se va

Una barra no se verifica de un vistazo — nadie mira un píxel y dice "eso son las
19:00". El texto queda; la barra se suma.

```
Viernes   ······████████████··   19:00 – 02:00
```

En 640px de contenido (`--admin-max-form` 48rem menos gutters): etiqueta ~90px +
pista ~400px + horas ~130px.

### Mobile apila, no comprime

A 360px la pista no convive con etiqueta y horas en una línea. Se apila y la
pista queda a ancho completo (~328px).

## Lo que la barra gana

- **El cruce de medianoche deja de ser una nota al pie.** Con eje derivado que
  llega a 02:00 o 04:00, la barra del viernes es más larga y termina después del
  marcador de 24h. El texto "Cruza la medianoche" pasa a ser confirmación, no la
  única señal.
- **El sábado con dos turnos se lee como dos bloques separados**, que es la forma
  que tiene en la realidad. Hoy son dos filas idénticas de inputs que hay que
  leer.

## Edición

Tocar un día abre **solo ese día**, con los `<input type="time">` a tamaño
completo; las otras seis pistas no cambian. Nunca dos días abiertos a la vez.
Se mantiene `+ Agregar rango` y se agrega **`Copiar a…`**: la carga inicial es la
única vez que la pantalla se usa en serio, y sin eso son siete días a mano.

## Piso técnico

- **Sin librería de charts.** `recharts` está en el proyecto para el dashboard y
  no viene acá: son rectángulos posicionados en porcentaje, es CSS.
- **La barra es decorativa: `aria-hidden`.** El dato accesible es el texto de las
  horas. Un lector de pantalla escucha "Viernes, 19:00 a 02:00".
- **La pista no es interactiva.** No se arrastra: con `step={900}` y 400px
  cubriendo 14h, un píxel son ~2 minutos. Se toca para abrir el editor.
- **Sin animación de entrada.** El único momento con motion autorizado en este
  producto es agregar al carrito.
- El color de la barra sale de los tokens del panel, **no** del tema del local:
  `/admin` no lleva marca del local.

## Excepciones por fecha

Quedan como **lista**. Solo se compacta el reposo a una línea por fecha que se
abre al tocar. Se mantiene el `<input type="date">` nativo: ya trae su propio
calendario en mobile y desktop, y dibujar uno propio es una superficie nueva para
un control que se toca dos veces al año. El diálogo destructivo al cerrar una
fecha con programados adentro no cambia.

## Alcance

Solo `src/views/admin/ajustes/schedule-editor.tsx` (+ extraer la pista a su
propio archivo si crece). **Ni modelo, ni acciones, ni migración**: el RPC de
guardado y `StoreHoursData` no cambian.
