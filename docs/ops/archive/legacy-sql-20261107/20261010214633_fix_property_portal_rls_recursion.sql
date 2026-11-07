-- The previous property portal policy queried ownership rows whose own policy
-- queried properties, causing infinite RLS recursion even for staff readers.
begin;
create schema if not exists private;

-- This helper is deliberately outside the API schema. It returns only whether
-- the current authenticated user is explicitly linked to this property.
create function private.can_read_portal_property(p_property_id uuid, p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists(select 1 from public.properties p
      join public.organizations o on o.id=p.organization_id and o.status='ACTIVE'
      where p.id=p_property_id and p.organization_id=p_organization_id)
    and (
      exists(select 1 from public.property_ownerships po
        join public.property_owners owner on owner.id=po.owner_id and owner.organization_id=p_organization_id
        join public.portal_access_links l on l.owner_id=owner.id and l.organization_id=p_organization_id
        where po.property_id=p_property_id and l.user_id=(select auth.uid()))
      or exists(select 1 from public.leads ld
        join public.contacts c on c.id=ld.contact_id and c.organization_id=p_organization_id
        join public.portal_access_links l on l.contact_id=c.id and l.organization_id=p_organization_id
        where ld.property_id=p_property_id and ld.organization_id=p_organization_id and l.user_id=(select auth.uid()))
      or exists(select 1 from public.deals d
        join public.contacts c on c.id=d.contact_id and c.organization_id=p_organization_id
        join public.portal_access_links l on l.contact_id=c.id and l.organization_id=p_organization_id
        where d.property_id=p_property_id and d.organization_id=p_organization_id and l.user_id=(select auth.uid()))
      or exists(select 1 from public.appointments a
        join public.contacts c on c.id=a.contact_id and c.organization_id=p_organization_id
        join public.portal_access_links l on l.contact_id=c.id and l.organization_id=p_organization_id
        where a.property_id=p_property_id and a.organization_id=p_organization_id and l.user_id=(select auth.uid()))
    );
$$;
revoke all on function private.can_read_portal_property(uuid,uuid) from public, anon, authenticated;
grant execute on function private.can_read_portal_property(uuid,uuid) to authenticated;

drop policy if exists properties_select_portal_related on public.properties;
create policy properties_select_portal_related on public.properties for select to authenticated
using (private.can_read_portal_property(id,organization_id));

-- Match the ownership's property tenant as well as the linked owner's tenant.
-- Property reads now use the helper above, so this direction cannot recurse.
drop policy if exists ownerships_select_portal_owner on public.property_ownerships;
create policy ownerships_select_portal_owner on public.property_ownerships for select to authenticated
using (exists(select 1 from public.property_owners o
  join public.portal_access_links l on l.owner_id=o.id and l.organization_id=o.organization_id
  join public.properties p on p.id=property_ownerships.property_id and p.organization_id=o.organization_id
  where o.id=property_ownerships.owner_id and l.user_id=(select auth.uid())));
commit;
