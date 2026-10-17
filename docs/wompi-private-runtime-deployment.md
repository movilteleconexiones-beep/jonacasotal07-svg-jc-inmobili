# Private Wompi webhook runtime — deployment gate

The Node runtime is intentionally separate from the Vite public site. **Do not deploy or enable it until migrations 0026–0028 have passed a real staging verification against the target schema.** The GitHub isolated PostgreSQL fixture is not a production migration rehearsal.

## Private environment variables (server only)

- `SUPABASE_URL`: HTTPS URL of the official Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: privileged backend key; NEVER use a `VITE_` prefix.
- `WOMPI_EVENTS_SECRET`: Wompi event checksum secret; NEVER use a `VITE_` prefix.
- `WOMPI_ENV`: `sandbox` for Wompi test events, `production` only after approval.
- `PORT`: optional, default `8080`.

Run in a dedicated backend process: `npm run wompi:server`. The webhook route is `POST /wompi/events`; the health check is `GET /healthz`. Require HTTPS and a public URL reachable by Wompi; the runtime does not provision hosting, TLS, DNS, or firewall settings.

## Safety and go-live checklist

1. Back up the production schema and validate all migration dependencies in a staging Supabase project.
2. Verify plan prices, `subscriptions.organization_id` uniqueness, and actual tenant statuses. Test payment approval, duplicate delivery, invalid amount, suspended tenant, and lifetime-license protection.
3. Install the server secrets only in a backend secrets manager; never in Vite, GitHub source, or browser configuration.
4. Use Wompi sandbox events and verify signature, exact amount, reference, currency, environment and transaction ID.
5. Confirm transaction reconciliation, alerting and manual review for `organization_inactive` and `manual_review` before production deployment.
6. Approve a separate production rollout and test rollback.

**Important:** `p_event_id` and `p_payload_sha256` currently use a deterministic transaction-state fingerprint, not Wompi's raw event ID or a SHA256 of the original request. This is a known audit limitation to address before live billing.

The runtime does not initiate Wompi checkout or create payment orders; those flows remain separate work.

## Railway Sandbox diagnosticado — 16/oct/2026

Estado verificado en **lectura solamente** para servicio
`inmojco-wompi-sandbox` del proyecto Railway `secure-sparkle`:

- El build (comando `npm run lint`) terminó correctamente en el despliegue
  `3e104e82-f5f3-452f-b1d0-e2d31707abd9`.
- Falló el arranque de `npm run wompi:server` con
  `Missing required server environment variable: WOMPI_EVENTS_SECRET`.
- El chequeo `/readyz` terminó fallando porque **el proceso nunca abrió su puerto**;
  no se trata de un error DNS ni de certificado.
- El nombre `WOMPI_EVENTS_SECRET` figura en la lista de variables del servicio,
  pero esa lista no garantiza que haya un valor no vacío.
- Preflight SQL solo lectura en Supabase `cuitgyqrjibgwuniapmk`: tablas
  `payment_orders`, `payment_events`, `subscriptions` y RPC
  `process_verified_payment_event(...)` presentes; `service_role` tiene
  `EXECUTE`, `anon` no. **No se procesó ningún pago.**

### Resolución segura, cuando corresponda reanudar Sandbox

1. Abrir Railway → proyecto `secure-sparkle` → servicio
   `inmojco-wompi-sandbox` → **Variables**.
2. Comprobar en la UI de Railway, sin revelar su contenido aquí, que
   `WOMPI_ENV=sandbox`, `SUPABASE_URL` corresponda al proyecto oficial
   `cuitgyqrjibgwuniapmk` y que `WOMPI_PRODUCTION_APPROVED` NO sea
   `1` (o eliminarlo si el panel permite hacerlo).
3. Configurar **exclusivamente en Railway** `WOMPI_EVENTS_SECRET` con el
   **secreto de integridad de eventos de Wompi de pruebas** correspondiente
   a la cuenta del software. No usar clave pública, privada ni de producción
   como sustituto, y no inventar un secreto de prueba.
4. Confirmar que `SUPABASE_SERVICE_ROLE_KEY` exista para el proyecto
   correcto y permanezca solo en el backend, nunca en variables `VITE_`.
5. Antes de redeploy: revisar que el entorno elegido no cree servicios ni
   cargos imprevistos y que el usuario autorice la reanudación del sandbox.
   A continuación, comprobar `/healthz` y `/readyz`, y simular eventos
   inválidos y firmados con secreto de **test**, verificando rechazo de
   firmas incorrectas e idempotencia.
6. No enviar eventos Wompi reales ni habilitar producción hasta los
   controles de conciliación, recuperación y aceptación comercial.

La rama de integración añade `server/wompi-runtime-config.ts`:
bloquea secretos vacíos/de ejemplo, impide reutilizar el mismo valor como
service-role y secreto de eventos, y en modo **production** exige tanto
`WOMPI_PRODUCTION_APPROVED=1` como el proyecto Supabase oficial.
`tests/wompi-runtime-config.test.mjs` verifica estos límites sin revelar
claves ni abrir conexiones.

**No se configuraron secretos, reiniciaron servicios, procesaron pagos ni
modificaron variables Railway durante este diagnóstico.**
