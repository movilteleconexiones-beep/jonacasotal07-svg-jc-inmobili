revoke all on function public.apply_default_role_permissions() from public,anon,authenticated;

create index if not exists idx_commissions_created_by
  on public.commissions(created_by);
create index if not exists idx_license_acceptances_accepted_by
  on public.license_acceptances(accepted_by);
create index if not exists idx_license_acceptances_license
  on public.license_acceptances(organization_license_id);
create index if not exists idx_portal_links_created_by
  on public.portal_access_links(created_by);
create index if not exists idx_property_owners_created_by
  on public.property_owners(created_by);
