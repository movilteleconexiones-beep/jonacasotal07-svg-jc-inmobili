\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 test of the actual reviewed SQL function.
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $fn$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$fn$;
create table public.organization_members(id uuid primary key,organization_id uuid,user_id uuid,status text);
create table public.permissions(id uuid primary key,key text unique);
create table public.member_permissions(organization_member_id uuid,permission_id uuid,effect text);
create table public.roles(id uuid primary key,organization_id uuid,active boolean);
create table public.member_roles(organization_member_id uuid,role_id uuid);
create table public.role_permissions(role_id uuid,permission_id uuid);
\ir ../reviews/has_org_permission_role_scope_review.sql
insert into public.organization_members values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000901','ACTIVE');
insert into public.permissions values
 ('00000000-0000-0000-0000-000000000201','properties.publish');
insert into public.roles values
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000002',true),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000001',false),
 ('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000001',true);
insert into public.role_permissions values
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201'),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000201'),
 ('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000201');
insert into public.member_roles values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000301'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000302');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000901',false);
do $test$ begin
 if public.has_org_permission('00000000-0000-0000-0000-000000000001','properties.publish') then
  raise exception 'cross-tenant or inactive role granted permission';
 end if;
end $test$;
insert into public.member_roles values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000303');
do $test$ begin
 if not public.has_org_permission('00000000-0000-0000-0000-000000000001','properties.publish') then
  raise exception 'valid role did not grant permission';
 end if;
end $test$;
insert into public.member_permissions values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','DENY');
do $test$ begin
 if public.has_org_permission('00000000-0000-0000-0000-000000000001','properties.publish') then
  raise exception 'DENY did not override role grant';
 end if;
end $test$;
delete from public.member_permissions;
delete from public.member_roles where role_id='00000000-0000-0000-0000-000000000303';
insert into public.member_permissions values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','ALLOW');
do $test$ begin
 if not public.has_org_permission('00000000-0000-0000-0000-000000000001','properties.publish') then
  raise exception 'explicit ALLOW did not grant permission';
 end if;
end $test$;
update public.organization_members set status='INACTIVE';
do $test$ begin
 if public.has_org_permission('00000000-0000-0000-0000-000000000001','properties.publish') then
  raise exception 'inactive member retained permission';
 end if;
end $test$;
select 'Scoped has_org_permission function passed' as result;
