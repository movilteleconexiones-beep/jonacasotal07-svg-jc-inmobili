revoke all on function public.apply_default_role_permissions() from public,anon,authenticated;

create index if not exists idx_commissions_created_by
  on public.commissions(created_by);

do $$
begin
  if to_regclass('public.license_acceptances') is not null then
    execute 'create index if not exists idx_license_acceptances_accepted_by on public.license_acceptances(accepted_by)';
    execute 'create index if not exists idx_license_acceptances_license on public.license_acceptances(organization_license_id)';
  end if;
end $$;

do $$
begin
  if to_regclass('public.portal_access_links') is not null then
    execute 'create index if not exists idx_portal_links_created_by on public.portal_access_links(created_by)';
  end if;
end $$;

create index if not exists idx_property_owners_created_by
  on public.property_owners(created_by);
