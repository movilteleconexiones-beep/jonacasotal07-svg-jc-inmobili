-- Isolated database: model the older official licensing schema before alignment.
ALTER TABLE auth.users ADD COLUMN email text;
ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
ALTER TABLE public.subscriptions ADD COLUMN trial_ends_at timestamptz;
ALTER TABLE public.license_acceptances DROP COLUMN organization_id;
ALTER TABLE public.license_acceptances DROP COLUMN terms_snapshot;
ALTER TABLE public.license_acceptances RENAME COLUMN acceptance_user_agent TO user_agent;
ALTER TABLE public.license_acceptances ADD COLUMN accepted_at timestamptz DEFAULT now();
ALTER TABLE public.organization_licenses ADD COLUMN terms_version_id uuid REFERENCES public.license_terms_versions(id);
ALTER TABLE public.organization_licenses ADD COLUMN operational_control_full boolean DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN copyright_transferred boolean DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN resale_allowed boolean DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN sublicensing_allowed boolean DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN redistribution_allowed boolean DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN white_label_allowed boolean DEFAULT false;
ALTER TABLE public.organization_licenses ADD CHECK(status IN ('ACTIVE','SUSPENDED','EXPIRED','CANCELLED'));
INSERT INTO public.license_terms_versions(id,version,title,terms_markdown)
 VALUES('40000000-0000-0000-0000-000000000001','2','Existing accepted terms','ORIGINAL LEGAL TEXT');
INSERT INTO public.organization_licenses(organization_id,license_type,status,terms_version_id)
 VALUES('20000000-0000-0000-0000-000000000001','SAAS','ACTIVE','40000000-0000-0000-0000-000000000001');
INSERT INTO public.license_acceptances(organization_license_id,terms_version_id,accepted_by,user_agent,accepted_at)
 SELECT id,terms_version_id,'10000000-0000-0000-0000-000000000003','original agent','2026-10-08T12:00:00Z'
 FROM public.organization_licenses;
CREATE TEMP TABLE original_acceptances AS TABLE public.license_acceptances;
CREATE TEMP TABLE original_licenses AS TABLE public.organization_licenses;
CREATE TABLE public.leases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES public.organizations(id));
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_lease_access ON public.leases FOR ALL TO authenticated USING(true) WITH CHECK(true);

CREATE FUNCTION public.create_organization_with_owner(org_name text,org_slug text,org_country_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare new_org_id uuid; new_member_id uuid; new_role_id uuid; active_terms_id uuid; basic_plan_id uuid;
begin
  select id into active_terms_id from public.license_terms_versions where active limit 1;
  select id into basic_plan_id from public.plans where code='BASIC';
  insert into public.organizations(name,slug,status,plan_id) values(org_name,org_slug,'ACTIVE',basic_plan_id) returning id into new_org_id;
  insert into public.organization_licenses(organization_id,license_type,status,operational_control_full,
    copyright_transferred,resale_allowed,sublicensing_allowed,redistribution_allowed,white_label_allowed,terms_version_id)
  values(new_org_id,'SAAS','ACTIVE',false,false,false,false,false,false,active_terms_id
  );
  if basic_plan_id is not null then
    insert into public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
    values(new_org_id,basic_plan_id,'TRIAL','SAAS_MONTHLY',now(),now()+interval '14 days')
    on conflict (organization_id) do nothing;
  end if;
  insert into public.organization_members(organization_id,user_id,status) values(new_org_id,auth.uid(),'ACTIVE') returning id into new_member_id;
  insert into public.roles(organization_id,key) values(new_org_id,'ORGANIZATION_OWNER') returning id into new_role_id;
  insert into public.member_roles values(new_member_id,new_role_id);
  insert into public.role_permissions select new_role_id,id from public.permissions;
  return new_org_id;
end;
$$;
