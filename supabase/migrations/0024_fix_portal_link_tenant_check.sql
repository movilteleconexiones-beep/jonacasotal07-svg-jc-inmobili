-- Fix tenant validation in portal_access_links insert policy.

drop policy if exists portal_links_insert on public.portal_access_links;

create policy portal_links_insert
on public.portal_access_links for insert to authenticated
with check (
  public.has_org_permission(portal_access_links.organization_id,'users.edit')
  and portal_access_links.created_by = (select auth.uid())
  and (
    portal_access_links.contact_id is null
    or exists (
      select 1
      from public.contacts c
      where c.id = portal_access_links.contact_id
        and c.organization_id = portal_access_links.organization_id
    )
  )
  and (
    portal_access_links.owner_id is null
    or exists (
      select 1
      from public.property_owners o
      where o.id = portal_access_links.owner_id
        and o.organization_id = portal_access_links.organization_id
    )
  )
);
