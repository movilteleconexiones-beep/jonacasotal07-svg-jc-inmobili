\set ON_ERROR_STOP on
-- Isolated PostgreSQL contract prototype, NOT a production migration.
-- Run only in disposable jco_security_test PostgreSQL database.
do $setup$
begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end
$setup$;
create table public.catalog_test_properties (
 id uuid primary key,
 organization_id uuid not null,
 title text not null,
 status text not null,
 is_published boolean not null default false,
 address text
);
create table public.catalog_test_organizations (
 id uuid primary key,
 enable_public_website boolean not null default false
);
insert into public.catalog_test_organizations values
 ('00000000-0000-0000-0000-000000000001',true),
 ('00000000-0000-0000-0000-000000000002',false);
insert into public.catalog_test_properties(id,organization_id,title,status,is_published,address) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Published A','AVAILABLE',true,'private A'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','Unpublished A','AVAILABLE',false,'private A2'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','Draft A','DRAFT',true,'private A3'),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000002','Published B','AVAILABLE',true,'private B');
alter table public.catalog_test_properties enable row level security;
alter table public.catalog_test_organizations enable row level security;
-- The base table is intentionally inaccessible to anon; publication uses a narrow interface.
revoke all on public.catalog_test_properties from public, anon;
revoke all on public.catalog_test_organizations from public, anon;
create view public.catalog_test_public_properties with (security_invoker = true) as
 select p.id,p.organization_id,p.title,p.status
 from public.catalog_test_properties p
 join public.catalog_test_organizations o on o.id=p.organization_id
 where p.status='AVAILABLE' and p.is_published=true and o.enable_public_website=true;
-- The view is not granted to anon because security_invoker would need base table SELECT,
-- which would expose private columns. This prototype validates the requirement for
-- a separately materialized public table or tightly audited RPC instead.
grant usage on schema public to anon;
set role anon;
do $test$
begin
 if has_table_privilege(current_user,'public.catalog_test_properties','SELECT') then
  raise exception 'SECURITY TEST FAILED: anon can read private property table';
 end if;
 if has_table_privilege(current_user,'public.catalog_test_public_properties','SELECT') then
  raise exception 'SECURITY TEST FAILED: unsafe invoker view granted to anon';
 end if;
 -- Exercise actual SQL authorization rather than relying only on privilege metadata.
 begin
  perform count(*) from public.catalog_test_properties;
  raise exception 'SECURITY TEST FAILED: anon SELECT unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
 begin
  perform count(*) from public.catalog_test_public_properties;
  raise exception 'SECURITY TEST FAILED: anon public view SELECT unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end
$test$;
reset role;
-- Verify the intended eligibility predicate with a privileged fixture query.
do $test$
declare ids uuid[];
begin
 select array_agg(p.id order by p.id) into ids
 from public.catalog_test_properties p
 join public.catalog_test_organizations o on o.id=p.organization_id
 where p.status='AVAILABLE' and p.is_published and o.enable_public_website;
 if ids is distinct from array['00000000-0000-0000-0000-000000000011'::uuid] then
  raise exception 'SECURITY TEST FAILED: published property eligibility incorrect';
 end if;
end
$test$;
-- Prototype of a separately published, column-restricted catalog table.
-- This fixture does not implement publication synchronization or production RLS.
create table public.catalog_test_published (
 property_id uuid primary key,
 organization_id uuid not null,
 title text not null,
 status text not null check (status='AVAILABLE')
);
insert into public.catalog_test_published(property_id,organization_id,title,status)
select p.id,p.organization_id,p.title,p.status
from public.catalog_test_properties p
join public.catalog_test_organizations o on o.id=p.organization_id
where p.status='AVAILABLE' and p.is_published and o.enable_public_website;
alter table public.catalog_test_published enable row level security;
create policy catalog_test_public_read on public.catalog_test_published
 for select to anon using (true);
revoke all on public.catalog_test_published from public;
grant select on public.catalog_test_published to anon;
set role anon;
do $test$
declare visible_count integer;
begin
 select count(*) into visible_count from public.catalog_test_published;
 if visible_count <> 1 then
  raise exception 'SECURITY TEST FAILED: anonymous public projection count differs';
 end if;
 if exists(select 1 from public.catalog_test_published where organization_id='00000000-0000-0000-0000-000000000002') then
  raise exception 'SECURITY TEST FAILED: disabled tenant is publicly visible';
 end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='catalog_test_published' and column_name in ('address','created_by','assigned_agent_id','import_job_id')) then
  raise exception 'SECURITY TEST FAILED: private columns present in public projection';
 end if;
end
$test$;
reset role;
-- Simulate a publication withdrawal and rebuild of the restricted projection.
-- In production this operation must be atomic, not two independently committed calls.
update public.catalog_test_properties
set is_published=false
where id='00000000-0000-0000-0000-000000000011';
delete from public.catalog_test_published
where property_id='00000000-0000-0000-0000-000000000011';
set role anon;
do $test$
begin
 if exists(select 1 from public.catalog_test_published
           where property_id='00000000-0000-0000-0000-000000000011') then
  raise exception 'SECURITY TEST FAILED: withdrawn listing still publicly visible';
 end if;
 if (select count(*) from public.catalog_test_published) <> 0 then
  raise exception 'SECURITY TEST FAILED: unexpected catalog rows after withdrawal';
 end if;
end
$test$;
reset role;
select 'Catalog publication contract fixture passed' as result;
