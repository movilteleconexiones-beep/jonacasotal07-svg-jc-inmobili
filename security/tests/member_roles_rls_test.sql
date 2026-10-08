\set ON_ERROR_STOP on
-- Disposable PostgreSQL test fixtures; never connect this script to production.
create role authenticated nologin;
create table public.organization_members (
 id uuid primary key,
 organization_id uuid not null
);
create table public.roles (
 id uuid primary key,
 organization_id uuid
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
set role authenticated;
set app.allowed_org = '00000000-0000-0000-0000-000000000001';
-- Allowed: assign an organization A role to an organization A member.
insert into public.member_roles values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111');
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
reset role;
do $$
begin
 if (select count(*) from public.member_roles) <> 1 then
  raise exception 'SECURITY TEST FAILED: assignments changed despite RLS';
 end if;
end $$;
select 'JCO RLS isolation smoke tests passed' as result;
