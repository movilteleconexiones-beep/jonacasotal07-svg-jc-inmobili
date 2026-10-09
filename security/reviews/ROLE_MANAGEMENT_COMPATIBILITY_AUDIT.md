# Phase 84 — Production role management compatibility audit

Read-only inspection of official Supabase project `nqzopzhmhqdssgpljypu` (no schema changes).

## Existing functions
- `public.create_custom_role(target_org uuid, role_name text, role_description text, permission_keys text[])`: SECURITY DEFINER; calls `has_org_permission(target_org,'roles.create')`, inserts an active organization-scoped role, then inserts matching `role_permissions` by supplied permission keys.
- `public.apply_default_role_permissions()`: SECURITY DEFINER trigger function; inserts permissions on roles with keys `ORGANIZATION_OWNER`, `ADMIN`, `MANAGER`, `AGENT`. `CLIENT` gets no grants.
- `public.has_org_permission(uuid,text)`: role-derived grants do not check `roles.active`.

## Integration hazards
1. A global-role `role_permissions` change can affect multiple tenants; an org-scoped custom-role creation initially has no assignments.
2. The default-permission trigger writes `role_permissions` as a side effect of role insertion. Audit trigger timing and locking order before adding row triggers.
3. The role creation function uses SECURITY DEFINER. Inspect EXECUTE grants and role-management RLS; do not assume the function is inaccessible to anonymous callers.
4. A future privileged `set_role_active` RPC must authorize the tenant, reject unauthorized global/system role changes, lock all affected tenants in stable order, and recheck membership before UPDATE.
5. Direct UPDATE/DELETE privileges and service-role bypasses must be reviewed before replacing a trigger with an RPC.

## Decision
No production changes. Do not merge experimental lock triggers until concurrency/deadlock and privilege reviews are complete.
