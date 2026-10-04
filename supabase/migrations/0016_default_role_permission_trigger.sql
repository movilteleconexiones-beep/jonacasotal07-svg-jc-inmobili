create or replace function public.apply_default_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key in ('ORGANIZATION_OWNER','ADMIN') then
    insert into public.role_permissions(role_id,permission_id)
    select new.id,id from public.permissions
    on conflict do nothing;
  elsif new.key = 'MANAGER' then
    insert into public.role_permissions(role_id,permission_id)
    select new.id,id from public.permissions
    where key in (
      'properties.view','properties.create','properties.edit',
      'clients.view','clients.create','clients.edit',
      'owners.view','owners.create','owners.edit',
      'leads.view','leads.assign','leads.edit',
      'appointments.view','appointments.create','appointments.edit',
      'deals.view','deals.create','deals.edit','deals.close',
      'documents.view','documents.upload',
      'commissions.view','commissions.create','commissions.edit',
      'reports.view','users.view'
    )
    on conflict do nothing;
  elsif new.key = 'AGENT' then
    insert into public.role_permissions(role_id,permission_id)
    select new.id,id from public.permissions
    where key in (
      'properties.view','properties.create','properties.edit',
      'clients.view','clients.create','clients.edit',
      'owners.view','owners.create','owners.edit',
      'leads.view','leads.edit',
      'appointments.view','appointments.create','appointments.edit',
      'deals.view','deals.create','deals.edit',
      'documents.view','documents.upload'
    )
    on conflict do nothing;
  elsif new.key = 'CLIENT' then
    insert into public.role_permissions(role_id,permission_id)
    select new.id,id from public.permissions
    where key in (
      'properties.view',
      'appointments.view','appointments.create',
      'documents.view','documents.upload'
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_default_role_permissions_trigger on public.roles;
create trigger apply_default_role_permissions_trigger
after insert on public.roles
for each row execute function public.apply_default_role_permissions();
