# Role-derived billing authorization: release gate (experimental)

**Status: NOT DEPLOYABLE.** This branch starts from PR #56 commit `9fdbfa8`. Do not merge or apply migration 0033 to official Supabase or staging as a security fix. Wompi real payments remain disabled.

## Verified gap in current isolated fixture

- `has_org_permission` reads `member_roles JOIN role_permissions`.
- Migration 0033 locks `member_roles` changes but has **no trigger on `role_permissions`**.
- A concurrent deletion of a role grant can therefore race with `create_authorized_sandbox_payment_order` even when direct member overrides are serialized.
- Existing fixture does not model the live `roles` table or its organization ownership. Do not infer that roles are tenant-local.

## Mandatory red/green tests before any implementation approval

1. Seed two organizations, separate memberships, a `billing.manage` permission, a role-based grant, and **no direct member override**. Assert order succeeds while grant exists and fails after grant removal.
2. Session A deletes `role_permissions` grant and holds transaction open. Session B attempts order with `lock_timeout=500ms`; must time out on the shared lock. After A commits, order must be denied.
3. Reverse: session A creates an authorized order and holds transaction open. Session B deletes grant with short timeout; must wait. After A commits, revocation succeeds; committed order remains exactly once.
4. Repeat for INSERT and UPDATE of role grants, role deletion/renaming, membership deactivation/deletion and cascading deletes. Test UPDATE moving a membership between organizations.
5. Seed a shared role used by memberships in **two organizations**. Mutating its grant must lock both affected tenants deterministically; test opposite concurrent updates for deadlocks.
6. Assert a role change in organization B cannot authorize a user in A. Test DENY override precedence and isolation from other tenants.
7. Exercise order creation through every RPC, trigger, direct-table grant, service-role path and background worker; assert no alternate write bypass.
8. Assert unauthorized callers cannot invoke internal lock/trigger functions or change permissions; inspect `SECURITY DEFINER` ownership, explicit schema qualification, fixed search path, EXECUTE grants, RLS and transaction boundaries.

## Required design decisions

- Inspect **actual** `roles`, `role_permissions`, membership FKs, default-role triggers, cascading FK actions and permissions before writing the trigger. Fixture is intentionally incomplete.
- Prefer enforcing tenant-local role ownership with a database invariant. If shared roles remain valid, collect affected tenant UUIDs, sort ascending, then acquire transaction advisory locks in that order **before any authorization-dependent row changes**. Review lock ordering with existing row locks to prevent deadlocks.
- Do not introduce a trigger that silently skips organizations when role ownership is unknown; fail closed.
- Treat green CI as necessary, not sufficient: independent security review and isolated Supabase-compatible integration testing are mandatory.

## Exit criteria

- Every red/green scenario is automated and green against an isolated database with live-schema-equivalent constraints and privileges.
- No unexpected deadlocks or lock bypass; multi-tenant isolation independently reviewed.
- PR #56 remains draft until a separate explicit release decision. No automatic deployment or payment activation.
