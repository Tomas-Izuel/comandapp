-- ---------------------------------------------------------------------------
-- store_branding.density — cuánto aire respira la carta del local.
--
-- El local ya elige color, tipografía y radio. El AIRE es la cuarta variable
-- de identidad de esta categoría: una carta de comida rápida es densa y una de
-- hamburguesería "premium" respira. Hasta ahora eso estaba hardcodeado.
--
-- Es un enum cerrado y NO un número libre a propósito. Con un valor libre el
-- dueño puede dejar la carta ilegible o hundir los targets por debajo de 44px
-- desde el panel, y el sistema no puede garantizar nada. Los tres valores
-- están calibrados en `globals.css` y ninguno baja de la escala actual: la
-- densidad solo puede AGRANDAR el ritmo, nunca apretarlo. Por eso `compact`
-- es exactamente lo que la app ya era (factor 1) y no algo más chico.
-- ---------------------------------------------------------------------------

alter table public.store_branding
  add column if not exists density text not null default 'cozy'
    check (density in ('compact', 'cozy', 'roomy'));
