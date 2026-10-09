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
