# Organization onboarding authorization design (issue #68)

## Production diagnosis (2026-10-11)
- The client `src/core/auth-context.tsx` calls the authenticated RPC
  `create_organization_with_owner(org_name, org_slug, org_country_code)`.
- Both overloads are present, but `authenticated` lacks EXECUTE.
- The SQL routine already creates the five tenant roles and assigns
  `ORGANIZATION_OWNER` to `auth.uid()`.
- `AuthAccessButton` states tenant admission needs an invitation or platform approval.
- The SuperAdmin module currently manages existing accounts; it has no create-tenant workflow.

## Non-negotiable authorization contract
1. Only an active `SUPER_ADMIN` or `PLATFORM_OWNER` may approve new tenants.
2. The designated initial owner must be an existing, email-confirmed auth user
   and must not be inferred from any arbitrary membership.
3. A privileged server-side routine must atomically create the organization,
   branded defaults, country/compliance setup, roles, permissions, owner membership,
   billing access, and audit record. The resulting organization starts pending
   commercial authorization, with live payments OFF.
4. Do not expose the existing self-service `create_organization_with_owner`
   procedure to all `authenticated` users. Its `auth.uid()` semantics would
   assign ownership to the caller, which is not the selected customer when called
   from SuperAdmin.
5. Never let the browser provide a service-role key, invent a customer identity,
   update an existing member into an owner, or mark commercial access approved
   as a side effect of registration.
6. Use a new reviewed, explicit SuperAdmin-only RPC (or privileged backend).
   Resolve the initial owner from a verified user ID, not email alone.
7. Cross-organization assignment, repeated requests, revoked administrators,
   disabled accounts, and concurrent same-slug requests must fail safely.

## Release gates
- SQL integration tests impersonate SuperAdmin, nonadmin user, reviewer,
  unrelated tenant owner, and unauthenticated actor.
- Verify exactly one owner membership and no duplicate roles on retries.
- Verify pending billing, production_enabled=false, and no existing customer
  membership/role changes.
- Verify signup UI only requests account creation, not tenant provisioning.
- Review the migration against the already deployed Supabase migration history.
- Sandbox exercise uses an explicitly marked test tenant, consented terms,
  valid Wompi sandbox secrets, and verified webhooks. No live charging.

This document defines a design and release criteria; it does not authorize an
existing tenant or alter production privileges.
