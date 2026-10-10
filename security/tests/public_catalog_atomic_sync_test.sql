\set ON_ERROR_STOP on
-- Atomic publication synchronization prototype: disposable PostgreSQL only.
do $setup$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $setup$;
create table public.atomic_orgs(id int primary key, website_enabled boolean not null default false);
create table public.atomic_properties(
 id int primary key, org_id int not null references public.atomic_orgs(id),
 title text not null, address text not null, status text not null,
 approved boolean not null default false
);
create table public.atomic_public_listings(
 property_id int primary key references public.atomic_properties(id) on delete cascade,
 org_id int not null, title text not null
);
create function public.atomic_refresh_property(p_id int) returns void
language plpgsql as $fn$
begin
 delete from public.atomic_public_listings where property_id=p_id;
 insert into public.atomic_public_listings(property_id,org_id,title)
 select p.id,p.org_id,p.title from public.atomic_properties p
 join public.atomic_orgs o on o.id=p.org_id
 where p.id=p_id and p.approved and p.status='AVAILABLE' and o.website_enabled;
end $fn$;
create function public.atomic_property_changed() returns trigger
language plpgsql as $fn$
begin
 if tg_op='DELETE' then return old; end if;
 perform public.atomic_refresh_property(new.id);
 return new;
end $fn$;
create trigger atomic_property_sync after insert or update on public.atomic_properties
for each row execute function public.atomic_property_changed();
create function public.atomic_org_changed() returns trigger language plpgsql as $fn$
declare p_id int;
begin
 if new.website_enabled is distinct from old.website_enabled then
  for p_id in select id from public.atomic_properties where org_id=new.id loop
   perform public.atomic_refresh_property(p_id);
  end loop;
 end if;
 return new;
end $fn$;
create trigger atomic_org_sync after update of website_enabled on public.atomic_orgs
for each row execute function public.atomic_org_changed();
alter table public.atomic_properties enable row level security;
alter table public.atomic_orgs enable row level security;
alter table public.atomic_public_listings enable row level security;
create policy atomic_anon_listings on public.atomic_public_listings for select to anon using (true);
revoke all on public.atomic_properties,public.atomic_orgs,public.atomic_public_listings from public;
grant usage on schema public to anon;
grant select on public.atomic_public_listings to anon;
insert into public.atomic_orgs values (1,true),(2,false);
insert into public.atomic_properties(id,org_id,title,address,status,approved) values
 (11,1,'A','SECRET A','AVAILABLE',false),
 (12,1,'B','SECRET B','DRAFT',true),
 (21,2,'C','SECRET C','AVAILABLE',true);
do $assert$ begin
 if (select count(*) from public.atomic_public_listings)<>0 then raise exception 'unapproved, draft or disabled org leaked'; end if;
end $assert$;
update public.atomic_properties set approved=true where id=11;
do $assert$ begin
 if (select count(*) from public.atomic_public_listings)<>1 then raise exception 'approval did not publish'; end if;
end $assert$;
update public.atomic_properties set approved=false where id=11;
do $assert$ begin
 if exists(select 1 from public.atomic_public_listings where property_id=11) then raise exception 'withdrawal did not unpublish'; end if;
end $assert$;
update public.atomic_properties set approved=true where id=11;
update public.atomic_properties set status='INACTIVE' where id=11;
do $assert$ begin
 if exists(select 1 from public.atomic_public_listings where property_id=11) then raise exception 'inactive listing leaked'; end if;
end $assert$;
update public.atomic_properties set status='AVAILABLE' where id=11;
update public.atomic_orgs set website_enabled=false where id=1;
do $assert$ begin
 if (select count(*) from public.atomic_public_listings)<>0 then raise exception 'disabled website leaked'; end if;
end $assert$;
update public.atomic_orgs set website_enabled=true where id=1;
-- Transaction rollback: both source approval and public projection must revert.
begin;
 update public.atomic_properties set approved=false where id=11;
 do $assert$ begin
  if exists(select 1 from public.atomic_public_listings where property_id=11) then raise exception 'withdrawal not visible inside transaction'; end if;
 end $assert$;
rollback;
do $assert$ begin
 if (select approved from public.atomic_properties where id=11) is distinct from true then raise exception 'rollback lost source approval'; end if;
 if (select count(*) from public.atomic_public_listings where property_id=11)<>1 then raise exception 'rollback lost public projection'; end if;
end $assert$;
-- Cascading deletion must remove the published projection.
insert into public.atomic_properties(id,org_id,title,address,status,approved)
 values (13,1,'Delete me','SECRET DELETE','AVAILABLE',true);
do $assert$ begin
 if (select count(*) from public.atomic_public_listings where property_id=13)<>1 then raise exception 'delete fixture not published'; end if;
end $assert$;
delete from public.atomic_properties where id=13;
do $assert$ begin
 if exists(select 1 from public.atomic_public_listings where property_id=13) then raise exception 'deleted property still public'; end if;
end $assert$;
-- The public table must not be writable by anonymous callers.
set role anon;
do $assert$ begin
 if has_table_privilege(current_user,'public.atomic_public_listings','INSERT') or
    has_table_privilege(current_user,'public.atomic_public_listings','UPDATE') or
    has_table_privilege(current_user,'public.atomic_public_listings','DELETE') then
  raise exception 'anon can mutate public projection';
 end if;
end $assert$;
reset role;
set role anon;
do $assert$ begin
 if has_table_privilege(current_user,'public.atomic_properties','SELECT') then raise exception 'anon can read source'; end if;
 if (select count(*) from public.atomic_public_listings)<>1 then raise exception 'anon publication count incorrect'; end if;
end $assert$;
reset role;
select 'Atomic publication fixture passed' as result;
