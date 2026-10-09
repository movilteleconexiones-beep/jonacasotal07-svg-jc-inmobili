-- EXPERIMENTAL ONLY. Disposable PostgreSQL fixture, NOT a production migration.
-- Intended semantics: inactive roles never grant billing.manage.
BEGIN;
CREATE TABLE IF NOT EXISTS public.roles (
 id uuid PRIMARY KEY,
 organization_id uuid REFERENCES public.organizations(id),
 active boolean NOT NULL DEFAULT true
);
CREATE OR REPLACE FUNCTION public.has_org_permission(target_org uuid, permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH membership AS (
  SELECT id FROM public.organization_members
  WHERE organization_id=target_org AND user_id=auth.uid() AND status='ACTIVE'
 ), requested_permission AS (
  SELECT id FROM public.permissions WHERE key=permission_key
 ), override_effect AS (
  SELECT mp.effect FROM public.member_permissions mp
  JOIN membership m ON m.id=mp.organization_member_id
  JOIN requested_permission p ON p.id=mp.permission_id
 ), role_grant AS (
  SELECT EXISTS(
   SELECT 1 FROM public.member_roles mr
   JOIN membership m ON m.id=mr.organization_member_id
   JOIN public.roles r ON r.id=mr.role_id AND r.active=true
   JOIN public.role_permissions rp ON rp.role_id=r.id
   JOIN requested_permission p ON p.id=rp.permission_id
  ) AS granted
 )
 SELECT CASE
  WHEN EXISTS(SELECT 1 FROM override_effect WHERE effect='DENY') THEN false
  WHEN EXISTS(SELECT 1 FROM override_effect WHERE effect='ALLOW') THEN true
  ELSE coalesce((SELECT granted FROM role_grant),false)
 END
$$;
COMMIT;
