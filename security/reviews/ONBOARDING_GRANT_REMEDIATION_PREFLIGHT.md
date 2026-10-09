# Phase 98 — Onboarding permission remediation preflight

## Confirmed caller
`src/core/auth-context.tsx` requires `session?.user` and directly invokes `supabase.rpc('create_organization_with_owner', { org_name, org_slug, org_country_code })` with the browser client. It then reloads memberships.

## Confirmed blocker
The three-argument production function is SECURITY DEFINER, owned by postgres, and its EXECUTE ACL excludes `authenticated`. The browser's authenticated RPC cannot run under this grant.

## Proposed change, NOT approved or applied
After security review and isolated integration tests, consider an explicitly scoped EXECUTE grant on the **three-argument overload only** to `authenticated`, retaining no `anon` grant. The two-argument overload is not used by the confirmed frontend path and should remain restricted unless separately justified.

## Security acceptance checklist
- Authenticate and derive ownership only from `auth.uid()`; never accept a caller-provided owner ID.
- Check name, slug and country validation; database uniqueness; predictable error handling.
- Prevent uncontrolled organization creation via rate limits/quotas or other anti-abuse control.
- Verify all writes occur in a single transaction and failure leaves no partial tenant.
- Confirm no unsafe privileged side effects from `apply_default_role_permissions`.
- Verify the owner receives the correct organization-scoped system role.
- Test anonymous execution is rejected and authenticated execution succeeds in isolated PostgreSQL.
- Verify direct system-role assignment outside onboarding remains denied.
- Avoid service-role credentials in frontend code.

**Current state: proposed only. No production grants, no live tests.**
