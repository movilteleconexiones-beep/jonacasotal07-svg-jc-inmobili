-- Defense in depth for private inventory. An accidentally permissive legacy
-- SELECT policy may no longer expose every tenant's properties.
-- Linked owners/tenants continue to see only their own referenced property.
-- Do not touch any INSERT/UPDATE/DELETE policies or financial tables.
BEGIN;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir lectura publica de propiedades" ON public.properties;
REVOKE SELECT ON public.properties FROM anon;
DROP POLICY IF EXISTS jco_private_properties_anon_deny ON public.properties;
CREATE POLICY jco_private_properties_anon_deny ON public.properties
 AS RESTRICTIVE FOR SELECT TO anon USING (false);

-- A restrictive policy is intersected with all permissive SELECT grants.
-- Require a valid active staff membership with view permission, a verified
-- personally-linked external access, or the independently verified platform admin.
DROP POLICY IF EXISTS jco_private_properties_tenant_read_boundary ON public.properties;
CREATE POLICY jco_private_properties_tenant_read_boundary ON public.properties
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (
    public.is_platform_admin()
    OR (
      jco_private.is_internal_staff(organization_id)
      AND public.has_org_permission(organization_id, 'properties.view')
    )
    OR private.can_read_portal_property(id, organization_id)
 );
COMMIT;
