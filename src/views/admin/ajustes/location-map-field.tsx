'use client'

import { useCallback, useEffect, useId, useRef, useState, useTransition, type ClipboardEvent } from 'react'
import { useController, useWatch, type Control } from 'react-hook-form'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { toast } from 'sonner'
import { Loader2, MapPin, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { geocodeAddressAction } from '@/controllers/geocoding.actions'
import type { GeocodeCandidate } from '@/services/geocoding'
import type { StoreProfileInput } from '@/models/schemas/store.schema'

/**
 * Este archivo importa `leaflet`, que toca `window` apenas se lo importa
 * (detección de features de browser al cargar el módulo). Por eso NO se
 * importa nunca directo: `profile-form.tsx` lo carga con
 * `dynamic(() => import(...), { ssr: false })`, que hace que Next jamás
 * evalúe este módulo en el servidor. Si algún día algo importa este archivo
 * de otra forma, el build de producción explota.
 */

/** Centro y zoom de arranque sin coordenadas cargadas: la Argentina entera,
 * en vez del (0,0) del golfo de Guinea. */
const DEFAULT_CENTER: L.LatLngTuple = [-38.4161, -63.6167]
const DEFAULT_ZOOM = 4
const LOCATED_ZOOM = 16

function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) < epsilon
}

/** `toFixed(6)` fija la precisión al mismo grano que `numeric(9,6)`/`numeric(10,6)`
 * de la base, y el `Number(...)` de vuelta saca los ceros de más para mostrar. */
function formatCoord(v: number | null): string {
  return v == null ? '' : String(Number(v.toFixed(6)))
}

/**
 * Ícono propio en vez de `L.Icon.Default`: el marcador de fábrica arma sus
 * rutas de imagen relativas a un `images/` que ningún bundler de Next
 * resuelve, así que sale invisible o 404. Un `divIcon` con SVG inline de
 * paso hereda los tokens del producto (`--primary`) en vez del pin azul
 * genérico de Leaflet.
 */
const markerIcon = L.divIcon({
  // className vacío a propósito: la default `leaflet-div-icon` trae fondo y
  // borde blanco de fábrica que no queremos.
  className: '',
  html: `<svg width="30" height="40" viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.716 23.284 0 15 0z" fill="var(--primary)"/>
    <circle cx="15" cy="15" r="5.5" fill="var(--primary-foreground)"/>
  </svg>`,
  iconSize: [30, 40],
  iconAnchor: [15, 40],
})

/**
 * El mapa de Leaflet en sí. Separado del campo que lo rodea porque Leaflet
 * no es declarativo: el `L.Map` se crea una vez en un efecto y después se
 * empuja a mano, no se vuelve a renderizar con JSX.
 */
function LocationMap({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null
  longitude: number | null
  onChange: (lat: number, lng: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  // `onChange` cambia de identidad entre renders de react-hook-form; guardarlo
  // en un ref deja que el mapa se cree una sola vez sin arrastrar ese valor
  // como dependencia de efecto. La escritura va en un efecto (no en el cuerpo
  // del render) porque mutar un ref durante el render es justo lo que
  // `react-hooks/refs` prohíbe.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const placeMarker = useCallback((lat: number, lng: number) => {
    const map = mapRef.current
    if (!map) return
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng])
      return
    }
    const marker = L.marker([lat, lng], {
      icon: markerIcon,
      draggable: true,
      alt: 'Ubicación del local',
      title: 'Arrastrá para ajustar la ubicación exacta',
    })
    marker.on('dragend', () => {
      const pos = marker.getLatLng()
      onChangeRef.current(pos.lat, pos.lng)
    })
    marker.addTo(map)
    markerRef.current = marker
  }, [])

  // Se crea una única vez: recrear el `L.Map` en cada render tiraría el zoom
  // y la posición que el dueño ya ajustó a mano. Los cambios de lat/lng
  // posteriores los aplica el efecto de abajo.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: latitude != null && longitude != null ? [latitude, longitude] : DEFAULT_CENTER,
      zoom: latitude != null && longitude != null ? LOCATED_ZOOM : DEFAULT_ZOOM,
      // El mapa vive en medio de un formulario largo: si el scroll del mouse
      // hiciera zoom, cada vez que el dueño scrollea la página el mapa se lo
      // roba en cuanto el cursor lo cruza.
      scrollWheelZoom: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Obligatoria por la política de uso de los tiles de OSM.
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map)

    // Tocar el mapa también cuenta como "mover el pin a mano": no hay que
    // depender de que ya exista un marcador para arrastrar.
    map.on('click', (e: L.LeafletMouseEvent) => {
      placeMarker(e.latlng.lat, e.latlng.lng)
      onChangeRef.current(e.latlng.lat, e.latlng.lng)
    })

    mapRef.current = map
    if (latitude != null && longitude != null) placeMarker(latitude, longitude)

    // El contenedor cambia de ancho con el layout responsivo del formulario
    // (breakpoints, sidebar): sin esto el mapa queda con los tiles cortados
    // hasta que algo dispare un resize de la ventana entera.
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inicialización única; ver comentario arriba
  }, [])

  // Cambios que NO vienen de arrastrar el pin en este mismo mapa: buscar,
  // elegir un candidato, tipear la coordenada a mano, pegar un par de Google
  // Maps, o "quitar ubicación". Si el marcador ya está en ese punto (eco de
  // su propio `dragend`) no hay que recentrar debajo del dedo del dueño.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (latitude == null || longitude == null) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    const current = markerRef.current?.getLatLng()
    if (current && approxEqual(current.lat, latitude) && approxEqual(current.lng, longitude)) return
    placeMarker(latitude, longitude)
    map.setView([latitude, longitude], Math.max(map.getZoom(), LOCATED_ZOOM))
  }, [latitude, longitude, placeMarker])

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Mapa: arrastrá el pin o tocá el lugar correcto para ajustar la ubicación del local"
      className="border-border h-72 w-full overflow-hidden rounded-lg border z-0"
    />
  )
}

/** Input numérico con borrador en string (mismo criterio que `DraftNumberInput`
 * en `fields.tsx`): un input controlado directo por el número de
 * react-hook-form le corta el "." o los ceros de más al dueño a mitad de
 * tipear. El borrador solo se resincroniza cuando el número cambió por una
 * fuente EXTERNA (arrastrar el pin, buscar, pegar) — nunca por su propia
 * tecla, que ya coincide con el valor. */
function CoordinateInput({
  id,
  label,
  value,
  onChange,
  onPaste,
  error,
}: {
  id: string
  label: string
  value: number | null
  onChange: (n: number | null) => void
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void
  error?: string
}) {
  const [draft, setDraft] = useState(() => formatCoord(value))
  // Último `value` con el que el borrador se sabe sincronizado. Comparar
  // acá adentro (patrón "ajustar estado durante el render" de React) en vez
  // de en un efecto evita el re-render en cascada que dispara
  // `react-hooks/set-state-in-effect`, y sigue sin pisar lo que el dueño
  // está tipeando: mientras la fuente del cambio es su propia tecla, `value`
  // ya es exactamente `Number(draft)` y la condición de abajo no dispara.
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    const parsed = draft.trim() === '' || draft === '-' ? null : Number(draft)
    if (parsed !== value) setDraft(formatCoord(value))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={draft}
        onPaste={onPaste}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="tabular h-10"
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw.trim() === '' || raw === '-') {
            onChange(null)
            return
          }
          const parsed = Number(raw)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Campo de ubicación de "Datos del local": buscar la dirección ya cargada,
 * elegir entre los candidatos que devuelve el geocodificador, y corregir el
 * punto a mano (arrastrando el pin, tocando el mapa, o tipeando/pegando la
 * coordenada). Lo que se guarda es siempre lo que el dueño confirmó acá
 * adentro, nunca lo que devolvió la búsqueda sin tocar — ver el comentario
 * de `geocoder.port.ts`.
 */
/** 800ms desde la última tecla: generoso a propósito. Nominatim permite 1
 * request por segundo e identifica por User-Agent — un debounce corto (200ms,
 * tipo "instant search") convierte cada tecleo rápido en un request y termina
 * baneando la IP del servidor. Con 800ms, incluso tipeando rápido, sale como
 * mucho un request por pausa real en la escritura. */
const DEBOUNCE_MS = 800

type SearchState = 'idle' | 'searching' | 'no-results'

/** De dónde salió la coordenada actual, para poder mostrarlo (requisito de
 * legibilidad) y para decidir si el auto-posicionamiento puede actuar:
 * - `none`   — no hay pin todavía.
 * - `saved`  — vino cargada de la base (una sesión anterior ya la confirmó).
 * - `auto`   — la propuso la búsqueda automática (sola o eligiendo un candidato).
 * - `manual` — el dueño la ajustó a mano: arrastró el pin, tocó el mapa, o
 *              tipeó/pegó la coordenada.
 * Solo `none` habilita que la búsqueda automática la pise sin preguntar. */
type PointSource = 'none' | 'saved' | 'auto' | 'manual'

export function LocationMapField({ storeId, control }: { storeId: number; control: Control<StoreProfileInput> }) {
  const latField = useController({ control, name: 'latitude' })
  const lngField = useController({ control, name: 'longitude' })
  const address = useWatch({ control, name: 'address' })

  const latId = useId()
  const lngId = useId()

  const latitude = latField.field.value
  const longitude = lngField.field.value
  const hasLocation = latitude != null && longitude != null
  const isDirty = latField.fieldState.isDirty || lngField.fieldState.isDirty
  const trimmedAddress = (address ?? '').trim()
  const canSearch = trimmedAddress.length >= 3

  const [, startTransition] = useTransition()
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([])
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [pointSource, setPointSource] = useState<PointSource>(() => (hasLocation ? 'saved' : 'none'))
  // Anuncio para lectores de pantalla: un reposicionamiento automático del
  // pin no puede pasar en silencio para quien no ve el mapa moverse.
  const [announcement, setAnnouncement] = useState('')

  // Última dirección efectivamente buscada: no dispara de nuevo si no cambió
  // (tecla que no altera el texto, blur/focus, etc.). Arranca en la dirección
  // ya cargada para no salir a buscar apenas se abre la página de ajustes.
  const lastQueryRef = useRef(trimmedAddress)
  // Contador de secuencia: cada búsqueda que arranca se lleva un número, y una
  // respuesta solo se aplica si sigue siendo la más nueva. Sin esto, tipear
  // rápido puede hacer que la respuesta de una búsqueda vieja llegue después
  // que la de una más nueva (orden de red, no de disparo) y el pin salte para
  // atrás. Alternativa válida: un `AbortController` por búsqueda — no hace
  // falta acá porque la Server Action no expone una request cancelable, así
  // que ignorar por secuencia es más simple y logra lo mismo.
  const searchSeqRef = useRef(0)
  // Espejo de `hasLocation` legible desde dentro del timeout/callback async
  // sin que la búsqueda en vuelo quede atada al valor de cuando arrancó: si el
  // dueño arrastra el pin mientras la respuesta viaja, tiene que ganar el pin
  // que acaba de tocar, no lo que había cuando se disparó el request.
  const hasLocationRef = useRef(hasLocation)
  useEffect(() => {
    hasLocationRef.current = hasLocation
  }, [hasLocation])

  // `useCallback` (no una función suelta) para poder declararla como
  // dependencia real del efecto de debounce de abajo sin que cada render del
  // formulario reinicie el timer: `field.onChange` de react-hook-form es
  // estable entre renders, así que esta identidad también lo es.
  const applyCandidate = useCallback(
    (c: GeocodeCandidate) => {
      latField.field.onChange(c.latitude)
      lngField.field.onChange(c.longitude)
      setPointSource('auto')
    },
    [latField.field, lngField.field],
  )

  // Invalida los resultados de la búsqueda anterior apenas la dirección se
  // sigue editando, antes incluso de que el debounce dispare la próxima: ver
  // una lista de candidatos que ya no corresponde al texto del campo es peor
  // que no ver nada.
  useEffect(() => {
    if (trimmedAddress === lastQueryRef.current) return
    setCandidates([])
    setSearchState('idle')
  }, [trimmedAddress])

  // Auto-posicionamiento con debounce mientras se escribe la dirección.
  useEffect(() => {
    if (!canSearch) return
    if (trimmedAddress === lastQueryRef.current) return

    const timeoutId = window.setTimeout(() => {
      lastQueryRef.current = trimmedAddress
      const seq = ++searchSeqRef.current
      setSearchState('searching')
      setAnnouncement('Buscando la dirección…')

      startTransition(async () => {
        const result = await geocodeAddressAction({ storeId, query: trimmedAddress })
        // Búsqueda vieja que llegó tarde: se descarta en favor de la última.
        if (seq !== searchSeqRef.current) return

        if (!result.ok) {
          setSearchState('idle')
          setAnnouncement('')
          toast.error('No se pudo buscar la dirección', { description: result.error })
          return
        }

        if (result.data.candidates.length === 0) {
          setCandidates([])
          setSearchState('no-results')
          setAnnouncement('No encontramos esa dirección. Podés marcar el punto a mano en el mapa.')
          return
        }

        setCandidates(result.data.candidates)
        setSearchState('idle')

        if (!hasLocationRef.current) {
          // No hay pin todavía: es seguro proponer el primer resultado solo.
          const [first] = result.data.candidates
          applyCandidate(first)
          setAnnouncement(`Ubicamos "${first.label}" en el mapa. Ajustalo si hace falta.`)
        } else {
          // Ya hay una coordenada — guardada o ajustada a mano — y esa es la
          // regla central de esta feature: el autocompletado NUNCA la pisa en
          // silencio. Se listan los resultados nuevos para que el dueño elija
          // actualizar si quiere; si no toca nada, el pin actual queda igual.
          setAnnouncement('La dirección cambió. Elegí un resultado de la lista para actualizar el pin, si hace falta.')
        }
      })
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [trimmedAddress, canSearch, storeId, applyCandidate])

  function handleClear() {
    latField.field.onChange(null)
    lngField.field.onChange(null)
    setCandidates([])
    setSearchState('idle')
    setPointSource('none')
    setAnnouncement('Ubicación quitada.')
  }

  function handleMapChange(lat: number, lng: number) {
    latField.field.onChange(lat)
    lngField.field.onChange(lng)
    setPointSource('manual')
  }

  // Tipear la coordenada a mano en cualquiera de los dos inputs es tan
  // "ajuste manual" como arrastrar el pin — mismo marcado de `pointSource`.
  function handleLatitudeChange(n: number | null) {
    latField.field.onChange(n)
    setPointSource('manual')
  }
  function handleLongitudeChange(n: number | null) {
    lngField.field.onChange(n)
    setPointSource('manual')
  }

  /** "que además permiten pegar una coordenada de Google Maps": si lo pegado
   * es un par "lat, lng" completo, carga las dos y no el texto crudo. */
  function handleCoordinatePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
    if (!match) return
    e.preventDefault()
    latField.field.onChange(Number(match[1]))
    lngField.field.onChange(Number(match[2]))
    setPointSource('manual')
  }

  // Candidatos mostrados para que el dueño CONFIRME una actualización (ya
  // había un pin protegido) en vez de simples alternativas al que ya se
  // aplicó solo. Cambia el título de la lista y hace que se muestre incluso
  // con un único resultado, porque acá el click es la única forma de que ese
  // resultado tenga efecto.
  const needsConfirmation = candidates.length > 0 && pointSource !== 'auto'
  const pointSourceLabel =
    pointSource === 'manual'
      ? 'Ubicación ajustada a mano.'
      : pointSource === 'saved'
        ? 'Ubicación guardada.'
        : pointSource === 'auto'
          ? 'Ubicación propuesta a partir de la dirección — arrastrá el pin si no es exacta.'
          : null

  return (
    <div className="flex flex-col gap-3">
      {/* Región discreta para lectores de pantalla: un cambio de estado que
          en pantalla se ve (spinner, texto, pin que se mueve solo) necesita
          equivalente sonoro cuando nadie lo está mirando. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {searchState === 'searching' ? (
            <span className="text-muted-foreground inline-flex h-10 items-center gap-1.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Buscando la dirección…
            </span>
          ) : null}
          {hasLocation ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              className="text-destructive hover:text-destructive h-10 gap-2"
            >
              <X className="size-4" aria-hidden />
              Quitar ubicación
            </Button>
          ) : null}
        </div>
        {isDirty ? (
          <span className="bg-warning/20 text-warning-foreground rounded-pill px-2.5 py-1 text-xs font-medium">
            Ubicación sin guardar
          </span>
        ) : null}
      </div>

      {!canSearch ? (
        <p className="text-muted-foreground text-xs">
          Cargá la dirección de arriba: el mapa se ubica solo mientras escribís.
        </p>
      ) : searchState === 'no-results' ? (
        <p className="text-warning-foreground text-xs">
          No encontramos esa dirección. Marcá el punto a mano: arrastrá el pin o tocá el lugar correcto en el mapa.
        </p>
      ) : pointSourceLabel ? (
        <p className="text-muted-foreground text-xs">{pointSourceLabel}</p>
      ) : null}

      {candidates.length > 1 || needsConfirmation ? (
        <div className="border-border flex flex-col gap-1 rounded-lg border p-1.5">
          <p className="text-muted-foreground px-1.5 pt-1 text-xs">
            {needsConfirmation
              ? 'La dirección cambió — elegí un resultado para actualizar el pin:'
              : 'Resultados de la búsqueda — elegí el correcto:'}
          </p>
          {candidates.map((c, i) => {
            const selected =
              latitude != null &&
              longitude != null &&
              approxEqual(latitude, c.latitude) &&
              approxEqual(longitude, c.longitude)
            return (
              <button
                key={`${c.latitude}-${c.longitude}-${i}`}
                type="button"
                onClick={() => applyCandidate(c)}
                aria-pressed={selected}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                  selected ? 'bg-primary/10 text-foreground font-medium' : 'hover:bg-muted text-foreground',
                )}
              >
                <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <LocationMap latitude={latitude} longitude={longitude} onChange={handleMapChange} />

      {/* Camino sin mouse: dos inputs numéricos visibles, siempre presentes
          (no solo cuando el mapa "falla"). Arrastrar un pin es interacción
          de mouse pura; esto es lo que lo hace operable con teclado o con
          un valor pegado de otra app. */}
      <div className="grid grid-cols-2 gap-3">
        <CoordinateInput
          id={latId}
          label="Latitud"
          value={latitude}
          onChange={handleLatitudeChange}
          onPaste={handleCoordinatePaste}
          error={latField.fieldState.error?.message}
        />
        <CoordinateInput
          id={lngId}
          label="Longitud"
          value={longitude}
          onChange={handleLongitudeChange}
          onPaste={handleCoordinatePaste}
          error={lngField.fieldState.error?.message}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        También podés pegar un par copiado de Google Maps (ej. «-34.603722, -58.381592») en cualquiera de los dos
        campos.
      </p>
    </div>
  )
}

export default LocationMapField
