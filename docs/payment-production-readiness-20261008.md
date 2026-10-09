# Payment rollout readiness — 2026-10-08

Read-only review of the official Supabase project `nqzopzhmhqdssgpljypu`.

Verified:
- PR #33 private Wompi runtime merged after CI success; not deployed.
- `public.subscriptions` has `UNIQUE (organization_id)`, compatible with the 0028 upsert.
- `public.payment_orders` and `public.payment_events` do not yet exist.
- Current BASIC, PRO, ENTERPRISE and LIFETIME plans have zero prices and USD currency.
- The payment activation SQL requires a positive-price COP plan and matching monthly/annual billing cycle.
- The production migrations 0026–0028 have not been applied.

Deployment is blocked pending approved COP plan pricing, staging Supabase verification, event audit improvements, and HTTPS backend deployment. Do not mutate production subscriptions or plan prices based on these observations alone.

Run `security/reviews/payment_production_readiness_readonly.sql` to recheck deployment blockers without altering any records.
