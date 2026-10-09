# Phase 99 — Onboarding integration test specification

## Isolated environment only
Use disposable PostgreSQL with an `authenticated` role, `anon` role, `auth.uid()` fixture, production-equivalent tables, and the exact `create_organization_with_owner` function body and its dependent triggers. Do not run test writes against the official Supabase project.

## Test cases
1. With current ACL, direct authenticated EXECUTE fails with permission denied.
2. After the **candidate** grant to authenticated on the three-argument overload only, authenticated user creates one organization and receives its owner role.
3. Anonymous user cannot invoke either overload.
4. The owner role is scoped to the newly created organization and active.
5. Other system roles are created with correct scope, but no other owner membership is created.
6. Invalid country, invalid slug, or missing auth.uid are rejected and leave no partial organization.
7. Duplicate slug fails atomically.
8. No ordinary tenant-admin role assignment path can grant a privileged system role.
9. Audit entry is present and linked to the organization and caller.
10. The two-argument overload remains ungranted to authenticated unless explicitly justified.

## Important caveat
Production `create_organization_with_owner` inserts multiple related records and invokes default-role permission triggers. A reduced mock fixture may miss failures. Prefer production-equivalent migrations and actual function definitions in the isolated test database.

## Exit criteria
CI green, manual security review of SECURITY DEFINER and abuse controls, then separately approved deployment. Current production EXECUTE ACL remains unchanged.

**Status: specification only; tests not implemented or run.**
