-- Enforce the v2 terms rule at the database boundary.
-- Any authenticated member may read terms/acceptance history, but only an
-- active ORGANIZATION_OWNER may create an acceptance for their organization.

drop policy if exists license_acceptance_insert on public.license_acceptances;

create policy license_acceptance_insert
on public.license_acceptances
for insert
to authenticated
with check (
  accepted_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_licenses l
    join public.organization_members om
      on om.organization_id = l.organization_id
     and om.user_id = (select auth.uid())
     and om.status = 'ACTIVE'
    join public.member_roles mr
      on mr.organization_member_id = om.id
    join public.roles r
      on r.id = mr.role_id
     and r.organization_id = om.organization_id
     and r.key = 'ORGANIZATION_OWNER'
     and r.active = true
    where l.id = organization_license_id
  )
);

comment on policy license_acceptance_insert on public.license_acceptances is
  'Only the active organization owner may accept the current license terms; members retain read access.';
