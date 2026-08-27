/**
 * Stub de `server-only` para los tests.
 *
 * El paquete real exporta un módulo que TIRA al ser importado fuera de un
 * entorno de servidor de React: es exactamente su razón de ser (si un Client
 * Component importa un módulo de servidor, el build falla). Pero eso también
 * hace que vitest no pueda importar nada de `models/`, `controllers/` ni
 * `services/`, que es justo lo que hay que testear.
 *
 * El alias vive en `vitest.config.ts`. No debilita la garantía real: la que
 * importa es la que aplica `next build`, y esa sigue intacta — de hecho ya
 * atajó un bug (un Client Component importando `action-result.ts`).
 */
export {}
