# Phase 93 — Strict role assignment verification plan

**Draft-only. No production rollout.**

The proposed tenant-admin assignment rule is:
`role.organization_id = member.organization_id AND role.active = true AND role.is_system_role = false`.

This is stricter than the existing experimental RLS candidate, which allows global roles. It is also deliberately distinct from privileged provisioning of system roles.

## Isolated RLS acceptance tests
- Active non-system same-tenant role: INSERT succeeds.
- Active non-system foreign-tenant role: INSERT fails with RLS violation.
- Inactive non-system same-tenant role: INSERT fails with RLS violation.
- Active system role scoped to tenant: INSERT fails with RLS violation.
- Active global system role: INSERT fails with RLS violation.
- Active global non-system role: INSERT fails with RLS violation.
- Missing role: INSERT fails (FK or RLS).
- UPDATE changing role_id to foreign/system/inactive role: fails.
- DELETE existing assignment: check existing policy and revocation authorization separately.

## Required product decision
System role keys `ORGANIZATION_OWNER`, `ADMIN`, `MANAGER`, `AGENT` need an explicit privileged provisioning workflow. Blocking ordinary tenant-admin assignment without providing a safe provisioning path could break onboarding.

## Verification standard
Execute as `authenticated` in disposable PostgreSQL, with a non-owner DB role and production-equivalent RLS. Assert rejection reason and verify no unauthorized rows were persisted. Test system-role provisioning only through a separately reviewed privileged function.

**Current state:** implementation and CI validation pending; no claim of test success.
