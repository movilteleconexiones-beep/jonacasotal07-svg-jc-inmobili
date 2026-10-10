\set ON_ERROR_STOP on
-- Disposable PostgreSQL test fixtures; never connect this script to production.
do $role_setup$
begin
 if not exists (select 1 from pg_roles where rolname='authenticated') then
  create role authenticated nologin;
 end if;
end;
$role_setup$;
create table public.organization_members (
 id uuid primary key,
 organization_id uuid not null
);
create table public.roles (
 id uuid primary key,
 organization_id uuid,
 active boolean not null default true
);
create table public.member_roles (
 organization_member_id uuid not null references public.organization_members(id),
 role_id uuid not null references public.roles(id),
 primary key (organization_member_id,role_id)
);
create function public.has_org_permission(target_org uuid, permission_key text)
returns boolean language sql stable as $$
 select permission_key = 'roles.assign'
    and target_org::text = current_setting('app.allowed_org', true)
$$;
insert into public.organization_members values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000002');
insert into public.roles values
 ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000222','00000000-0000-0000-0000-000000000002');
alter table public.member_roles enable row level security;
grant usage on schema public to authenticated;
grant select on public.organization_members,public.roles to authenticated;
grant select,insert,update,delete on public.member_roles to authenticated;
grant execute on function public.has_org_permission(uuid,text) to authenticated;
\i security/reviews/member_roles_rls_hardening.sql
-- Mirror production's permissive organization-member SELECT policy.
-- It must not accidentally authorize INSERT, UPDATE or DELETE.
create function public.is_org_member(target_org uuid)
returns boolean language sql stable as $is_member$
 select target_org::text = current_setting('app.allowed_org', true)
$is_member$;
grant execute on function public.is_org_member(uuid) to authenticated;
create policy member_roles_select_org on public.member_roles
for select to authenticated
using (
 exists (select 1 from public.organization_members m
 where m.id=member_roles.organization_member_id
 and public.is_org_member(m.organization_id))
);
set role authenticated;
set app.allowed_org = '00000000-0000-0000-0000-000000000001';
-- Allowed: assign an organization A role to an organization A member.
insert into public.member_roles values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111');
-- Foreign tenant assignments must not be visible to an A-only administrator.
do $$
declare visible_count integer;
begin
 select count(*) into visible_count from public.member_roles;
 if visible_count <> 1 then
   raise exception 'SECURITY TEST FAILED: tenant A must see only its authorized assignment';
 end if;
end $$;
-- Forbidden: role B to member A, even with A's role assignment permission.
do $$
begin
 begin
  insert into public.member_roles values
   ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000222');
  raise exception 'SECURITY TEST FAILED: cross-tenant INSERT succeeded';
 exception
  when insufficient_privilege then null;
 end;
end $$;
-- Forbidden: assign an inactive role even when it belongs to tenant A.
reset role;
insert into public.roles(id,organization_id,active) values
 ('00000000-0000-0000-0000-000000000333','00000000-0000-0000-0000-000000000001',false);
set role authenticated;
do $inactive_role$
begin
 begin
  insert into public.member_roles values
   ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000333');
  raise exception 'SECURITY TEST FAILED: inactive role INSERT succeeded';
 exception
  when insufficient_privilege then null;
 end;
end $inactive_role$;
-- Forbidden: changing an existing assignment to an inactive same-tenant role.
do $inactive_update$
begin
 begin
  update public.member_roles
     set role_id='00000000-0000-0000-0000-000000000333'
   where organization_member_id='00000000-0000-0000-0000-000000000011';
  raise exception 'SECURITY TEST FAILED: inactive role UPDATE succeeded';
 exception
  when insufficient_privilege then null;
 end;
end $inactive_update$;
-- The rejected UPDATE must preserve the authorized assignment.
do $unchanged_assignment$
begin
 if not exists (
  select 1 from public.member_roles
  where organization_member_id='00000000-0000-0000-0000-000000000011'
    and role_id='00000000-0000-0000-0000-000000000111'
 ) then
  raise exception 'SECURITY TEST FAILED: rejected UPDATE changed valid assignment';
 end if;
end $unchanged_assignment$;
-- Authorized tenant A administrator can remove a pre-existing inactive assignment.
reset role;
insert into public.member_roles values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000333');
set role authenticated;
delete from public.member_roles
 where organization_member_id='00000000-0000-0000-0000-000000000011'
   and role_id='00000000-0000-0000-0000-000000000333';
do $inactive_cleanup$
begin
 if exists (select 1 from public.member_roles
  where organization_member_id='00000000-0000-0000-0000-000000000011'
    and role_id='00000000-0000-0000-0000-000000000333') then
  raise exception 'SECURITY TEST FAILED: authorized inactive assignment cleanup failed';
 end if;
end $inactive_cleanup$;
-- Forbidden: update an existing assignment to a role belonging to B.
do $$
begin
 begin
  update public.member_roles
    set role_id='00000000-0000-0000-0000-000000000222'
    where organization_member_id='00000000-0000-0000-0000-000000000011';
  raise exception 'SECURITY TEST FAILED: cross-tenant UPDATE succeeded';
 exception
  when insufficient_privilege then null;
 end;
end $$;
-- Forbidden: assign any role to B's member while acting as A.
do $$
begin
 begin
  insert into public.member_roles values
   ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000222');
  raise exception 'SECURITY TEST FAILED: foreign-member INSERT succeeded';
 exception
  when insufficient_privilege then null;
 end;
end $$;
do $$
begin
 if (select count(*) from public.member_roles) <> 1 then
   raise exception 'SECURITY TEST FAILED: unexpected visible assignments';
 end if;
end $$;
-- Without roles.assign in the member's organization, the existing assignment
-- must not be writable or removable, even if its ID is known.
set app.allowed_org = '00000000-0000-0000-0000-000000000002';
do $$
declare affected integer;
begin
 delete from public.member_roles
 where organization_member_id='00000000-0000-0000-0000-000000000011';
 get diagnostics affected = row_count;
 if affected <> 0 then
   raise exception 'SECURITY TEST FAILED: unauthorized DELETE removed assignment';
 end if;
end $$;
do $$
declare affected integer;
begin
 update public.member_roles
 set role_id='00000000-0000-0000-0000-000000000222'
 where organization_member_id='00000000-0000-0000-0000-000000000011';
 get diagnostics affected = row_count;
 if affected <> 0 then
   raise exception 'SECURITY TEST FAILED: unauthorized UPDATE changed assignment';
 end if;
end $$;
-- Tenant B can assign its own role without gaining access to A.
insert into public.member_roles values
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000222');
-- B can read its own assignment and no assignment from A.
do $$
declare visible_count integer;
begin
 select count(*) into visible_count from public.member_roles;
 if visible_count <> 1 then
   raise exception 'SECURITY TEST FAILED: tenant B must see exactly its own assignment';
 end if;
end $$;
-- The other tenant cannot read A's assignment, even when it knows the IDs.
do $$
declare visible_count integer;
begin
 select count(*) into visible_count
 from public.member_roles
 where organization_member_id='00000000-0000-0000-0000-000000000011';
 if visible_count <> 0 then
   raise exception 'SECURITY TEST FAILED: tenant B read tenant A role assignment';
 end if;
end $$;
-- Recheck tenant A visibility after tenant B creates its own assignment.
set app.allowed_org = '00000000-0000-0000-0000-000000000001';
do $$
declare visible_count integer;
begin
 select count(*) into visible_count from public.member_roles;
 if visible_count <> 1 then
   raise exception 'SECURITY TEST FAILED: tenant A gained visibility into B';
 end if;
end $$;
reset role;
do $$
begin
 if (select count(*) from public.member_roles) <> 2 then
  raise exception 'SECURITY TEST FAILED: expected one authorized assignment per tenant';
 end if;
end $$;
select 'JCO RLS isolation smoke tests passed' as result;
