-- Fase 1 / JCO: proposed RLS hardening. REVIEW BEFORE APPLYING.
-- This file is intentionally NOT an auto-applied migration.
-- Existing data inspection (2026-10-08): zero cross-organization member-role assignments.
-- Current roles are organization-scoped; review if global roles are added later.
begin;

drop policy if exists member_roles_manage_admin on public.member_roles;

create policy member_roles_manage_admin
on public.member_roles
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    join public.roles r on r.id = member_roles.role_id
    where m.id = member_roles.organization_member_id
      and r.organization_id = m.organization_id
      and public.has_org_permission(m.organization_id, 'roles.assign')
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    join public.roles r on r.id = member_roles.role_id
    where m.id = member_roles.organization_member_id
      and r.organization_id = m.organization_id
      and public.has_org_permission(m.organization_id, 'roles.assign')
  )
);

commit;

-- Verification queries (read-only; execute separately):
-- select count(*) from public.member_roles mr
-- join public.organization_members m on m.id=mr.organization_member_id
-- join public.roles r on r.id=mr.role_id
-- where r.organization_id is distinct from m.organization_id;
-- Test with two authenticated users from distinct organizations before production.
