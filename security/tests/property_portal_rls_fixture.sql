\set ON_ERROR_STOP on
-- Run only after the consignment fixture, in its disposable database.
create table public.property_owners(id uuid primary key, organization_id uuid references public.organizations);
create table public.property_ownerships(property_id uuid references public.properties, owner_id uuid references public.property_owners);
create table public.portal_access_links(id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations,
  user_id uuid references auth.users, contact_id uuid references public.contacts, owner_id uuid references public.property_owners);
create table public.deals(id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations,
  property_id uuid references public.properties, contact_id uuid references public.contacts);
create table public.appointments(id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations,
  property_id uuid references public.properties, contact_id uuid references public.contacts);
alter table public.property_owners enable row level security;
alter table public.property_ownerships enable row level security;
alter table public.portal_access_links enable row level security;
alter table public.deals enable row level security;
alter table public.appointments enable row level security;
create policy portal_links_self_read on public.portal_access_links for select to authenticated
  using(user_id=(select auth.uid()) or public.has_org_permission(organization_id,'users.view'));
create policy owners_select on public.property_owners for select to authenticated
  using(public.has_org_permission(organization_id,'owners.view'));
create policy owners_select_portal_self on public.property_owners for select to authenticated
  using(exists(select 1 from public.portal_access_links l where l.organization_id=property_owners.organization_id
    and l.owner_id=property_owners.id and l.user_id=(select auth.uid())));
create policy ownerships_select on public.property_ownerships for select to authenticated
  using(exists(select 1 from public.properties p where p.id=property_ownerships.property_id
    and public.has_org_permission(p.organization_id,'owners.view')));
create policy ownerships_select_portal_owner on public.property_ownerships for select to authenticated
  using(exists(select 1 from public.property_owners o join public.portal_access_links l
    on l.owner_id=o.id and l.organization_id=o.organization_id
    where o.id=property_ownerships.owner_id and l.user_id=(select auth.uid())));
-- Reproduce the exact dependency that failed against the live schema.
create policy properties_select_portal_related on public.properties for select to authenticated using (
  exists(select 1 from public.property_ownerships po join public.portal_access_links l on l.owner_id=po.owner_id
    where po.property_id=properties.id and l.organization_id=properties.organization_id and l.user_id=(select auth.uid()))
  or exists(select 1 from public.leads ld join public.portal_access_links l on l.contact_id=ld.contact_id
    where ld.property_id=properties.id and ld.organization_id=properties.organization_id and l.user_id=(select auth.uid()))
  or exists(select 1 from public.deals d join public.portal_access_links l on l.contact_id=d.contact_id
    where d.property_id=properties.id and d.organization_id=properties.organization_id and l.user_id=(select auth.uid()))
  or exists(select 1 from public.appointments a join public.portal_access_links l on l.contact_id=a.contact_id
    where a.property_id=properties.id and a.organization_id=properties.organization_id and l.user_id=(select auth.uid()))
);
set role authenticated;
do $$ begin
  begin
    perform 1 from public.properties;
    raise exception 'Fixture did not reproduce property policy recursion';
  exception when sqlstate '42P17' then null; end;
end $$;
reset role;
