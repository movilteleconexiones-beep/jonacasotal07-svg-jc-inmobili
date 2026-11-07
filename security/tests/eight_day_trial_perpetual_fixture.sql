-- PostgreSQL 17 CI fixture ONLY: synthetic accounts, no customer PII or Wompi secrets.
CREATE OR REPLACE FUNCTION jco_private.pending_organization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN NEW.status='INACTIVE'; RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.platform_admins
    WHERE user_id=auth.uid() AND active AND admin_level IN ('SUPER_ADMIN','PLATFORM_OWNER')); $$;

UPDATE auth.users SET email_confirmed_at=now() WHERE id IN (
 '10000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000003');
-- Deliberately corrupted LIFETIME preconfiguration to prove the draft repairs
-- partial quotas, stale feature limits, disabled PRO rights and foreign rights.
UPDATE public.plans SET max_users=2,max_properties=NULL WHERE code='LIFETIME';
INSERT INTO public.plan_features(plan_id,feature_key,enabled,feature_limit)
SELECT l.id,p.feature_key,false,999
FROM public.plans l CROSS JOIN LATERAL (
  SELECT feature_key FROM public.plan_features
  WHERE plan_id=(SELECT id FROM public.plans WHERE code='PRO')
    AND enabled=true AND feature_key LIKE 'permission:%'
  ORDER BY feature_key LIMIT 1
) p
WHERE l.code='LIFETIME'
ON CONFLICT(plan_id,feature_key) DO UPDATE SET
  enabled=false,feature_limit=999;
INSERT INTO public.plan_features(plan_id,feature_key,enabled,feature_limit)
SELECT id,'permission:unapproved_perpetual_export',true,NULL
FROM public.plans WHERE code='LIFETIME'
ON CONFLICT(plan_id,feature_key) DO UPDATE SET enabled=true;
-- fixture plans already have IDs and permissions from commercial migration.
INSERT INTO public.organizations(id,name,slug) VALUES
 ('20000000-0000-0000-0000-000000000010','Trial A','trial-2026-10'),
 ('20000000-0000-0000-0000-000000000011','Trial B','trial-2026-11'),
 ('20000000-0000-0000-0000-000000000012','Manual Lifetime','manual-life');
INSERT INTO public.organization_members(id,organization_id,user_id,status) VALUES
 ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','ACTIVE'),
 ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','ACTIVE'),
 ('30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','ACTIVE');
INSERT INTO public.roles(id,organization_id,key,active) VALUES
 ('40000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000010','ORGANIZATION_OWNER',true),
 ('40000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000011','ORGANIZATION_OWNER',true),
 ('40000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000012','ORGANIZATION_OWNER',true);
INSERT INTO public.member_roles(organization_member_id,role_id) VALUES
 ('30000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000010'),
 ('30000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000011'),
 ('30000000-0000-0000-0000-000000000012','40000000-0000-0000-0000-000000000012');
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT mr.role_id,p.id FROM public.member_roles mr CROSS JOIN public.permissions p WHERE mr.role_id IN (
 '40000000-0000-0000-0000-000000000010',
 '40000000-0000-0000-0000-000000000011',
 '40000000-0000-0000-0000-000000000012');
INSERT INTO public.license_terms_versions(id,version,title,terms_markdown) VALUES
 ('50000000-0000-0000-0000-000000000010','8day-v1','Fixture','FIXTURE NO CHARGE');
INSERT INTO public.license_acceptances (organization_id,organization_license_id,
 terms_version_id,accepted_by,terms_snapshot,acceptance_user_agent)
 SELECT l.organization_id,l.id,'50000000-0000-0000-0000-000000000010',
   CASE WHEN l.organization_id='20000000-0000-0000-0000-000000000012'
      THEN '10000000-0000-0000-0000-000000000002'::uuid
      ELSE '10000000-0000-0000-0000-000000000001'::uuid END,
   'FIXTURE TERMS','CI ONLY'
 FROM public.organization_licenses l
 WHERE l.organization_id IN (
   '20000000-0000-0000-0000-000000000010',
   '20000000-0000-0000-0000-000000000011',
   '20000000-0000-0000-0000-000000000012');
