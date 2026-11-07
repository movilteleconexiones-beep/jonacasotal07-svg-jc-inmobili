-- Security hardening and RLS performance improvements.

revoke all on function public.create_organization_with_owner(text, text) from public, anon;
grant execute on function public.create_organization_with_owner(text, text) to authenticated;

revoke all on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;

revoke all on function public.has_org_permission(uuid, text) from public, anon;
grant execute on function public.has_org_permission(uuid, text) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert
on public.ai_usage for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (user_id is null or user_id = (select auth.uid()))
);

create index if not exists idx_member_roles_role_id on public.member_roles(role_id);
create index if not exists idx_member_permissions_permission_id on public.member_permissions(permission_id);
create index if not exists idx_role_permissions_permission_id on public.role_permissions(permission_id);

create index if not exists idx_properties_assigned_agent on public.properties(assigned_agent_id);
create index if not exists idx_properties_created_by on public.properties(created_by);
create index if not exists idx_properties_import_job on public.properties(import_job_id);

create index if not exists idx_contacts_assigned_agent on public.contacts(assigned_agent_id);
create index if not exists idx_contacts_created_by on public.contacts(created_by);
create index if not exists idx_contacts_import_job on public.contacts(import_job_id);

create index if not exists idx_leads_contact on public.leads(contact_id);
create index if not exists idx_leads_property on public.leads(property_id);
create index if not exists idx_leads_assigned_agent on public.leads(assigned_agent_id);
create index if not exists idx_leads_created_by on public.leads(created_by);

create index if not exists idx_appointments_contact on public.appointments(contact_id);
create index if not exists idx_appointments_lead on public.appointments(lead_id);
create index if not exists idx_appointments_property on public.appointments(property_id);
create index if not exists idx_appointments_assigned_user on public.appointments(assigned_user_id);
create index if not exists idx_appointments_created_by on public.appointments(created_by);

create index if not exists idx_deals_contact on public.deals(contact_id);
create index if not exists idx_deals_property on public.deals(property_id);
create index if not exists idx_deals_assigned_agent on public.deals(assigned_agent_id);
create index if not exists idx_deals_created_by on public.deals(created_by);

create index if not exists idx_activities_contact on public.activities(contact_id);
create index if not exists idx_activities_lead on public.activities(lead_id);
create index if not exists idx_activities_property on public.activities(property_id);
create index if not exists idx_activities_deal on public.activities(deal_id);
create index if not exists idx_activities_user on public.activities(user_id);

create index if not exists idx_ai_usage_user on public.ai_usage(user_id);
create index if not exists idx_audit_actor on public.audit_log(actor_user_id);
create index if not exists idx_import_jobs_created_by on public.import_jobs(created_by);
