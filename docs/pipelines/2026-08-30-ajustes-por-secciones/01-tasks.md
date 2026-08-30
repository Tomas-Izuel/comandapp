# Corte en slices

Dos agentes en paralelo. **No comparten un solo archivo.** El contrato de abajo
lo fija el hilo principal y ninguno de los dos lo negocia.

## Contrato (fijado antes de repartir)

### Schemas nuevos — `src/models/schemas/store.schema.ts`

```ts
export const storeProfileInputSchema = storeSettingsInputSchema.pick({
  name: true, description: true, phoneE164: true, whatsappPhoneE164: true,
  address: true, latitude: true, longitude: true,
  instagramHandle: true, mapsUrl: true, rappiUrl: true,
  pedidosYaUrl: true, uberEatsUrl: true,
})
export type StoreProfileInput = z.infer<typeof storeProfileInputSchema>

export const storeOrderingInputSchema = storeSettingsInputSchema.pick({
  acceptingOrders: true, inStorePaymentEnabled: true, minOrderCents: true,
  autoStartOrders: true, autoReadyOrders: true,
  deliveryEnabled: true, deliveryFeeCents: true, deliveryFreeFromCents: true,
  deliveryMinOrderCents: true, deliveryMinutes: true, deliveryBusyMinutes: true,
  scheduledDeliveryEnabled: true, scheduledCapacityPerNight: true,
  demandThresholdOrders: true, demandMultiplier: true,
})
export type StoreOrderingInput = z.infer<typeof storeOrderingInputSchema>
```

12 + 15 = 27 claves. `storeSettingsInputSchema` tiene 29: `timezone` y
`currency` quedan **deliberadamente fuera de las dos** (ver 00-architecture).
`storeSettingsInputSchema` se conserva como fuente de las dos derivadas.

### Acciones — `src/controllers/admin.actions.ts`

```ts
export async function updateStoreProfileAction(
  storeId: number, input: StoreProfileInput,
): Promise<ActionResult>

export async function updateStoreOrderingAction(
  storeId: number, input: StoreOrderingInput,
): Promise<ActionResult>
```

`updateStoreSettingsAction` se elimina. Mismo permiso que hoy
(`requireStoreMembership`, cualquier staff — no `owner`).

### Modelos — `src/models/store.model.ts`

```ts
export async function updateStoreProfile(storeId: number, input: StoreProfileInput): Promise<void>
export async function updateStoreOrdering(storeId: number, input: StoreOrderingInput): Promise<void>
```

Cada una parsea **su** schema y hace `.update()` con **solo sus columnas**.
La normalización "las dos o ninguna" de `latitude`/`longitude` va en
`updateStoreProfile`. `updateStoreSettings` se elimina.

---

## Slice A — backend (`senior-backend-engineer`)

**Dueño exclusivo de:**
- `src/models/schemas/store.schema.ts`
- `src/models/store.model.ts`
- `src/controllers/admin.actions.ts`

**No toca:** nada bajo `src/views/` ni `src/app/`. Ni migraciones.

Además del contrato:
- `revalidatePath('/admin/ajustes')` en `admin.actions.ts:514` pasa a
  `revalidatePath('/admin/ajustes', 'layout')` — sin eso la confirmación por
  código no refresca la sub-ruta.
- Verificar si `tests/` referencia `updateStoreSettings*`; si sí, **reportarlo**,
  no arreglarlo (el suite es del test-engineer).

## Slice B — frontend (`frontend-react-craftsman`)

**Dueño exclusivo de:**
- `src/app/admin/(app)/ajustes/**`
- `src/views/admin/ajustes/**`

**No toca:** `src/controllers/`, `src/models/`, `src/views/admin/shell.tsx`.

Importa `updateStoreProfileAction` / `updateStoreOrderingAction` y sus tipos
**por el contrato de arriba**, aunque el Slice A todavía no haya terminado.

**Archivos:**

| Archivo | Qué |
|---|---|
| `ajustes/layout.tsx` | nuevo. `PageFrame title="Ajustes" width="form"` + nav de tabs + `children` |
| `ajustes/page.tsx` | reescrito → El local |
| `ajustes/pedidos/page.tsx` | nuevo |
| `ajustes/horarios/page.tsx` | nuevo. Es quien pide `getStoreHoursData` + `getMaxPrepMinutes` |
| `views/admin/ajustes/settings-tabs.tsx` | nuevo, cliente (`usePathname`) |
| `views/admin/ajustes/fields.tsx` | nuevo. `Field`, `DraftNumberInput`, `ToggleField`, `toEmptyToNull`, `SaveBar` — extraídos tal cual de `settings-form.tsx`, comentarios incluidos |
| `views/admin/ajustes/profile-form.tsx` | nuevo, desde `settings-form.tsx` |
| `views/admin/ajustes/ordering-form.tsx` | nuevo, desde `settings-form.tsx`. Se lleva `AcceptingOrdersToggle` y `CourierCollectsPaymentField` |
| `views/admin/ajustes/settings-form.tsx` | **se elimina** |
| `schedule-editor.tsx`, `location-map-field.tsx` | **no se tocan** |

**Trabajo de diseño real (no es mover archivos):** en `pedidos/` conviven campos
que esperan "Guardar" con dos controles que se aplican solos. Hace falta una
convención visual que los distinga, consistente entre los dos. Es el punto que
el routing no resuelve.

Cada page resuelve su propia sesión y redirige a `/admin/acceso` si no está ok
(el layout no autoriza por sí solo — regla dura del repo).
