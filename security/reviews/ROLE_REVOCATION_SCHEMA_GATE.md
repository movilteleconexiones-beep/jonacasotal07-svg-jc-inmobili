# Role revocation security gate (draft)

Verified by read-only information_schema inspection of the official Supabase project on 2026-10-08. No production schema changes.

- roles.id is UUID primary key; roles.organization_id is nullable and references organizations.id.
- member_roles has a composite primary key (organization_member_id, role_id), referencing organization_members and roles.
- role_permissions has a composite primary key (role_id, permission_id), referencing roles and permissions.
- A null organization_id means tenant-exclusive locking cannot be assumed for every role. Verify semantics of system/global roles before making schema changes.
- Draft migration 0033 lacks synchronization for role_permissions changes. Isolated CI has reproduced the authorization-revocation race.

Release blockers:
1. Inspect system/global role semantics, existing triggers and foreign-key ON DELETE behavior.
2. Design transaction lock ordering across all affected tenants and document row-lock/deadlock risks.
3. Add positive concurrency tests for role permission deletion and updates, role deletion/cascade, member-role changes and tenant boundaries.
4. Confirm least-privilege execution rights and audit SECURITY DEFINER functions.
5. Review in disposable PostgreSQL and staging before any production migration.

Status: NOT APPROVED FOR PRODUCTION.

## CI evidence and limitations (phase 74)

- GitHub Actions run 37881298339 passed the expected-failure regression on draft 0033, the positive role-revocation candidate test, and the shared-role two-tenant advisory-lock test.
- These tests use `security/tests/atomic_order_fixture.sql`, a deliberately simplified schema. Its `member_roles` and `role_permissions` tables have **no foreign keys**, so passing tests do **not** establish safe cascade behavior.
- The shared-role test checks advisory locks acquired in one transaction; it does not establish freedom from deadlocks under concurrent transactions.
- The candidate trigger is `BEFORE ROW` and reads membership assignments. Row-lock ordering, concurrent membership changes, and `roles.active` or global-role mutation paths remain unproven.
- A concurrent two-session shared-role test was attempted but its repository write was blocked; it is **not** part of CI and must not be reported as passed.

**Release decision:** continue in draft PR #57 only. No production migration, merge, or real payments until the remaining gates are independently validated.

## Production FK verification (read-only, phase 76)

Read-only catalog query against the official Supabase project confirmed these `ON DELETE CASCADE` relationships:

| Source | Referenced table | Delete behavior |
| --- | --- | --- |
| `member_roles.organization_member_id` | `organization_members` | CASCADE |
| `member_roles.role_id` | `roles` | CASCADE |
| `role_permissions.permission_id` | `permissions` | CASCADE |
| `role_permissions.role_id` | `roles` | CASCADE |
| `roles.organization_id` | `organizations` | CASCADE |

Implication: deleting a role, permission, organization, or membership may transitively alter effective billing authorization. Each path needs a transaction-ordering review; do not infer safety from the role-delete fixture alone. No production changes were made.
