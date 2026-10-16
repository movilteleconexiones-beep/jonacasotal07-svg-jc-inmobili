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

-- Do NOT reuse the older portal helper here: a permissive legacy helper
-- must not become the authorization source for cross-tenant private reads.
CREATE OR REPLACE FUNCTION jco_private.can_read_authorized_external_property(
 p_property_id uuid, p_organization_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $jco$
 SELECT (SELECT auth.uid()) IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.properties p
     JOIN public.organizations o
       ON o.id=p.organization_id AND o.status='ACTIVE'
     WHERE p.id=p_property_id AND p.organization_id=p_organization_id
       AND (
         EXISTS (
           SELECT 1
           FROM public.property_ownerships ownership
           JOIN public.property_owners owner
             ON owner.id=ownership.owner_id AND owner.organization_id=p.organization_id
           JOIN public.portal_access_links link
             ON link.organization_id=p.organization_id AND link.owner_id=owner.id
           WHERE ownership.property_id=p.id
             AND link.user_id=(SELECT auth.uid())
         )
         OR EXISTS (
           SELECT 1 FROM public.leases lease
           JOIN public.portal_access_links link
             ON link.organization_id=lease.organization_id
            AND link.contact_id=lease.tenant_id
           WHERE lease.property_id=p.id
             AND lease.organization_id=p.organization_id
             AND lease.status IN ('ACTIVE','TERMINATED')
             AND link.user_id=(SELECT auth.uid())
         )
       )
   );
$jco$;
REVOKE ALL ON FUNCTION jco_private.can_read_authorized_external_property(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION jco_private.can_read_authorized_external_property(uuid,uuid)
 TO authenticated;

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
    OR jco_private.can_read_authorized_external_property(id, organization_id)
 );
COMMIT;
