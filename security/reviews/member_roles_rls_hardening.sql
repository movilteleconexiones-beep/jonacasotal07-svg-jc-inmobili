-- REVIEW ONLY: command-specific RLS hardening; do not run in production.
-- Keep tenant isolation on all commands; permit authorized cleanup of inactive
-- same-tenant role assignments through DELETE only.
begin;
drop policy if exists member_roles_manage_admin on public.member_roles;
drop policy if exists member_roles_admin_insert on public.member_roles;
drop policy if exists member_roles_admin_update on public.member_roles;
drop policy if exists member_roles_admin_delete on public.member_roles;
drop policy if exists member_roles_admin_select on public.member_roles;

-- Preserve organization-scoped visibility independently of management privileges.
-- In production the existing member_roles_select_org policy remains in place;
-- isolated test databases must also have an explicit SELECT policy.
create policy member_roles_admin_select on public.member_roles
for select to authenticated
using (
 exists (select 1 from public.organization_members m
 where m.id=member_roles.organization_member_id
 and public.has_org_permission(m.organization_id,'roles.assign'))
);
create policy member_roles_admin_insert on public.member_roles
for insert to authenticated
with check (
 exists (select 1 from public.organization_members m
 join public.roles r on r.id=member_roles.role_id
 where m.id=member_roles.organization_member_id
 and r.organization_id=m.organization_id and r.active=true
 and public.has_org_permission(m.organization_id,'roles.assign'))
);
create policy member_roles_admin_update on public.member_roles
for update to authenticated
using (
 exists (select 1 from public.organization_members m
 join public.roles r on r.id=member_roles.role_id
 where m.id=member_roles.organization_member_id
 and r.organization_id=m.organization_id
 and public.has_org_permission(m.organization_id,'roles.assign'))
)
with check (
 exists (select 1 from public.organization_members m
 join public.roles r on r.id=member_roles.role_id
 where m.id=member_roles.organization_member_id
 and r.organization_id=m.organization_id and r.active=true
 and public.has_org_permission(m.organization_id,'roles.assign'))
);
create policy member_roles_admin_delete on public.member_roles
for delete to authenticated
using (
 exists (select 1 from public.organization_members m
 join public.roles r on r.id=member_roles.role_id
 where m.id=member_roles.organization_member_id
 and r.organization_id=m.organization_id
 and public.has_org_permission(m.organization_id,'roles.assign'))
);
commit;
-- Existing SELECT policy member_roles_select_org is intentionally preserved.
-- Cross-tenant legacy assignments require separate audited remediation.
