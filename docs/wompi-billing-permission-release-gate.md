# Billing permission release gate

Read-only inspection of the official JCO Supabase permission catalog on 2026-10-08 found `settings.edit` and `settings.view`, but **no billing-specific permission**. This is a security blocker for trusted paid order creation.

- Use an explicit `billing.manage` permission for creating or changing paid subscription orders; never infer it from `settings.edit`, tenant ownership labels or platform admin listing rights.
- The `server/wompi-billing-permission.ts` helper defines a **contract only**; it does not provision the permission or query Supabase.
- Before enabling any order endpoint, draft and validate a staging migration to insert the permission, define its assignment to authorized roles through reviewed policy, and enforce it in a service-role-only transactional order-creation RPC bound to the verified user and active organization membership.
- Preserve explicit member-level deny overrides and tenant isolation. Do not automatically grant `billing.manage` to existing roles or customers without an approved policy.
- Require authenticated user identity from a verified session, never an arbitrary browser-supplied user ID. Do not grant permission based on browser-supplied booleans.
- Run cross-tenant, suspended-organization, inactive-member, revoked-permission and concurrent-insert tests on isolated PostgreSQL and Supabase staging.

**Not deployed:** no permission rows, customer memberships, production schema or payment orders are changed by this document.
