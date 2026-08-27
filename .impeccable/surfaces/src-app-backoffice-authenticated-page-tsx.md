---
version: 1
slug: "src-app-backoffice-authenticated-page-tsx"
primary_target: "src/app/backoffice/(authenticated)/page.tsx"
related_targets: ["src/app/backoffice/(authenticated)/tiendas/page.tsx","src/app/backoffice/(authenticated)/tiendas/[id]/page.tsx","src/app/backoffice/(authenticated)/auditoria/page.tsx","src/app/backoffice/login/page.tsx","src/app/backoffice/mfa/page.tsx"]
---

# Backoffice de plataforma

**Alcance y modo.** `/backoffice` completo: métricas globales, alta y suspensión
de locales, auditoría, login y MFA. Modo **Operate**.

**Audiencia.** **Un solo operador**: el dueño del SaaS. No es el dueño de un
local. Esto cambia todo: no hay onboarding que enseñar, no hay que vender nada, y
la densidad puede ser máxima porque el que lo usa lo conoce de memoria.

**Vara.** Paneles de administración internos serios (Stripe Dashboard, Vercel).
Comparte tokens y primitivas con el resto; **jamás** la composición de la cara
del cliente.

**Consecuencias de diseño.**
- La lista de locales es una **tabla**, con lo que se necesita para decidir:
  estado, pedidos, facturación, credenciales. Nada de tarjetas.
- Suspender un local es **destructivo y visible**: confirmación que nombra el
  local y dice qué pasa con sus pedidos en curso.
- Todo lo que pasa acá queda en `platform_audit_log`, y la auditoría se lee.
- Nada de la plantilla métrica-héroe: números grandes con label chico y una
  flechita verde es exactamente lo que este panel no necesita.

**Estados que tienen que existir.** Sin locales todavía. Local suspendido. Local
con credenciales de prueba. Sesión sin `aal2` (la RLS devuelve cero filas: el
panel tiene que decir "te falta el segundo factor", no "no hay datos"). Enrolar
TOTP por primera vez.
