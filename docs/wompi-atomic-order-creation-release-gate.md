# Atomic sandbox order creation: release gate

Migration 0032 is **draft only**. It uses the authenticated database identity, locks the active tenant, checks active membership and explicit billing.manage, derives amount and billing cycle from the trusted COP plan catalog, and inserts a PENDING sandbox-only order in one transaction. It blocks orders after 2026-12-31 until tax policy is configured. It never activates a subscription or triggers a charge.

**Do not deploy yet.** Before staging approval, add isolated PostgreSQL integration tests for cross-tenant requests, inactive members/organizations, DENY override, missing permission, price tampering, reference collision and rollback. Confirm plans schema and migrations 0026/0029/0030/0031 are applied in order. Verify actual Wompi sandbox payment flow separately.

**Concurrency security blocker:** the organization row is locked, but a concurrent billing permission or role grant revocation could still race the `has_org_permission` check. Introduce a coordinated membership/permission locking or serialized revocation protocol and test it before production. Never interpret this draft as fully race-safe.

The caller must generate an unpredictable reference on a trusted server, not trust a browser-supplied reference; enforce rate limits and anti-replay protections in the API. Granting `billing.manage` requires a separately reviewed least-privilege role assignment policy. No changes to production Supabase, live Wompi, subscriptions or website.
