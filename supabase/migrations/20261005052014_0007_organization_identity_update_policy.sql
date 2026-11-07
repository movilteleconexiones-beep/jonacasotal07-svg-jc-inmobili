-- Allow tenant owners/admins with settings.edit to update their organization identity.

drop policy if exists organizations_update_settings_admin on public.organizations;
create policy organizations_update_settings_admin
on public.organizations for update
to authenticated
using (public.has_org_permission(id, 'settings.edit'))
with check (public.has_org_permission(id, 'settings.edit'));
