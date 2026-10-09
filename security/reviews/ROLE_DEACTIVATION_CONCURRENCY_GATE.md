# Phase 80 — Role deactivation transaction safety gate

The candidate `security/experiments/inactive_role_permission_candidate.sql` changes authorization semantics, but **does not serialize UPDATE roles.active with order creation**.

## Required red/green regression
1. Create a disposable database using the real role FK relationships and role-aware `has_org_permission`.
2. Assign a global role with `billing.manage` to members of two organizations, without direct overrides.
3. Session A starts an authorized sandbox order and holds its tenant advisory lock open.
4. Session B attempts `UPDATE public.roles SET active=false` with `lock_timeout='500ms'`.
5. The update **must not commit** while session A is still holding the lock; test should observe a lock timeout, not an unrelated SQL error.
6. Repeat with session A on the second organization and with role reactivation.
7. Run two concurrent role updates and membership changes to detect lock-order cycles.
8. Verify permission checks after the change and check that explicit DENY remains dominant.

## Architectural concern
A BEFORE ROW trigger on `roles` that enumerates tenant memberships may be vulnerable to row-lock/advisory-lock inversion. A role can be global (`organization_id IS NULL`) and assigned across many tenants. Cascading role deletion and concurrent membership reassignment must be included in the design review.

**Gate: BLOCKED.** No production deployment, merge, or real Wompi payments until all paths have a validated locking strategy.
