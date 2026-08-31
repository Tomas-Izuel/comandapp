# Detalles de QC — 2026-08-31

Tanda chica de cinco correcciones puntuales reportadas por el dueño del
producto. No hay decisión de arquitectura nueva: por eso no hay
`00-architecture.md`. El corte es por directorio y ningún slice comparte un
solo archivo con otro.

## T1 — Cuenta bancaria: el alta con SOLO alias falla (backend)

**Síntoma reportado**: `/admin/pagos` dice que alcanza con el alias (el CBU/CVU
puede no estar), pero al crear la cuenta falla. La regla querida es la que ya
está escrita en todos lados: **al menos uno** de los dos, CBU/CVU o alias.

Verificado desde el hilo principal ANTES de repartir, para que el slice no
vuelva a recorrerlo:

- `bankAccountInputSchema.safeParse({ cbu: '', alias: 'mi.local.pagos', holderName: 'Juan Perez', holderTaxId: '' })`
  devuelve `success: true` con `{ alias, holderName }`. El schema NO es el problema.
- En la base local, `store_bank_accounts_has_identifier_check` es
  `cbu is not null or alias is not null` y `store_pending_changes_kind_check`
  ya incluye `'bank_account'`. El schema de Postgres NO es el problema.

O sea que la falla está entre la Server Action, el modelo de pending changes,
el envío del mail o la vista. Hay que **reproducirla**, no adivinarla.

Dueño exclusivo de: `src/controllers/admin.actions.ts`,
`src/models/store-bank-account.model.ts`, `src/models/store-pending-change.model.ts`,
`src/models/schemas/store.schema.ts`, `src/views/admin/pagos/**`.

## T2 — El "+" de la tarjeta de producto se convierte en selector de cantidad

Al tocar "+" en la carta, el control pasa a ser un stepper para sumar más de
uno sin entrar a la ficha. Solo aplica al camino que hoy ya suma directo
(producto sin opciones obligatorias): con opciones obligatorias el "+" sigue
siendo un link a la ficha.

Dueño exclusivo de: `src/views/storefront/product-card.tsx` y archivos nuevos
bajo `src/views/storefront/`.

## T3 — Ícono de WhatsApp en los botones del KDS

`src/components/ui/whatsapp.tsx` ya existe y ya lo usan la vitrina
(`store-dock.tsx`, `transfer-panel.tsx`). Los dos botones del KDS quedaron con
`MessageCircle`.

## T4 — Barras del horario semanal más prolijas

`DayBar` en `src/views/admin/ajustes/schedule-track.tsx`.

T3 y T4 son el mismo slice (los dos en `views/admin/`). Dueño exclusivo de:
`src/views/admin/kds/order-card.tsx`, `src/views/admin/kds/transfer-tray.tsx`,
`src/views/admin/ajustes/schedule-track.tsx`.

## T5 — Footer más sutil y mail propio

El footer de la cara del cliente pesa demasiado para lo que es (lo único de la
plataforma que el cliente ve) y publica un gmail personal. Pasa a
`hola@comandapp.ar` — decisión del dueño del producto, 2026-08-31.

Dueño exclusivo de: `src/views/shared/site-footer.tsx`,
`src/app/legal/terminos/page.tsx`, `src/app/legal/privacidad/page.tsx`,
`src/lib/env.server.ts` (solo el default de `SUPPORT_EMAIL`).
