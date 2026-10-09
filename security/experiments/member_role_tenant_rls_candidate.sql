-- EXPERIMENTAL ONLY. Disposable PostgreSQL; NOT approved for production.
-- Restrict member_roles INSERT/UPDATE to the member's own org or an
-- explicitly permitted global role. This candidate allows global roles only
-- when the caller has roles.assign on the target org; further system-role
-- restrictions may be needed.
CREATE OR REPLACE FUNCTION public.member_role_tenant_matches(
  target_member uuid, target_role uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (
   SELECT 1
   FROM public.organization_members m
   JOIN public.roles r ON r.id=target_role
   WHERE m.id=target_member
     AND (r.organization_id=m.organization_id OR r.organization_id IS NULL)
 )
$$;
REVOKE ALL ON FUNCTION public.member_role_tenant_matches(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_role_tenant_matches(uuid,uuid) TO authenticated;
DROP POLICY IF EXISTS member_roles_manage_admin ON public.member_roles;
CREATE POLICY member_roles_manage_admin ON public.member_roles
 FOR ALL TO authenticated
 USING (
   EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.id=member_roles.organization_member_id
      AND public.has_org_permission(m.organization_id,'roles.assign')
   )
 )
 WITH CHECK (
   EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.id=member_roles.organization_member_id
      AND public.has_org_permission(m.organization_id,'roles.assign')
   )
   AND public.member_role_tenant_matches(
     member_roles.organization_member_id,member_roles.role_id
   )
 );
