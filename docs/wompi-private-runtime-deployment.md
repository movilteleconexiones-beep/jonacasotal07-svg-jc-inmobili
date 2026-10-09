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
