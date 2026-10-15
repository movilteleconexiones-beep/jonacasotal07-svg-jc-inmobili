-- Permit external users to read ONLY verified personal lease/payment data
-- or property ownership references; prospects retain only the public catalog.
BEGIN;

CREATE OR REPLACE FUNCTION public.has_portal_property(target_property uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.properties p
  JOIN public.organizations o ON o.id=p.organization_id AND o.status='ACTIVE'
  WHERE p.id=target_property AND (
    EXISTS (
      SELECT 1 FROM public.property_ownerships po
      JOIN public.portal_access_links l ON l.owner_id=po.owner_id
         AND l.organization_id=p.organization_id
      WHERE po.property_id=p.id AND l.user_id=(SELECT auth.uid())
    ) OR EXISTS (
      SELECT 1 FROM public.leases le
      JOIN public.portal_access_links l ON l.contact_id=le.tenant_id
        AND l.organization_id=le.organization_id
      WHERE le.property_id=p.id AND le.organization_id=p.organization_id
        AND le.status IN ('ACTIVE','TERMINATED') AND l.user_id=(SELECT auth.uid())
    )
  )
 );
$$;

CREATE OR REPLACE FUNCTION private.can_read_portal_property(p_property_id uuid,p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.properties p WHERE p.id=p_property_id
     AND p.organization_id=p_organization_id)
  AND public.has_portal_property(p_property_id);
$$;

-- Prospects linked through contact records may never browse private deals,
-- appointments, leads, activities or property-linked documents.
ALTER POLICY activities_portal_select ON public.activities TO authenticated USING (false);
ALTER POLICY appointments_portal_select ON public.appointments TO authenticated USING (false);
ALTER POLICY deals_portal_select ON public.deals TO authenticated USING (false);
ALTER POLICY leads_portal_select ON public.leads TO authenticated USING (false);
ALTER POLICY documents_portal_select ON public.documents TO authenticated
 USING (
    (entity_type='OWNER' AND public.has_portal_owner(entity_id))
    OR (entity_type='CONTACT' AND EXISTS(
      SELECT 1 FROM public.portal_access_links l JOIN public.leases le
       ON le.tenant_id=l.contact_id AND le.organization_id=l.organization_id
      WHERE l.user_id=(SELECT auth.uid()) AND l.contact_id=documents.entity_id
        AND l.organization_id=documents.organization_id AND le.status IN ('ACTIVE','TERMINATED')
    ))
    OR (entity_type='USER' AND entity_id=(SELECT auth.uid()))
 );
-- Public catalogs are served only through the published, nonprivate site;
-- never expose all property fields via a generic anon SQL SELECT policy.
ALTER POLICY properties_portal_select ON public.properties TO authenticated USING (public.has_portal_property(id));
ALTER POLICY properties_select_portal_related ON public.properties TO authenticated
 USING (private.can_read_portal_property(id,organization_id));

CREATE POLICY leases_tenant_portal_select ON public.leases FOR SELECT TO authenticated
 USING (status IN ('ACTIVE','TERMINATED') AND EXISTS (
  SELECT 1 FROM public.portal_access_links l
   WHERE l.user_id=(SELECT auth.uid()) AND l.organization_id=leases.organization_id
    AND l.contact_id=leases.tenant_id
 ));
CREATE POLICY rent_payments_external_personal ON public.rent_payments FOR SELECT TO authenticated
 USING (EXISTS(
  SELECT 1 FROM public.leases le
  WHERE le.id=rent_payments.lease_id AND le.organization_id=rent_payments.organization_id
    AND le.status IN ('ACTIVE','TERMINATED') AND (
     EXISTS(SELECT 1 FROM public.portal_access_links l
       WHERE l.organization_id=rent_payments.organization_id AND l.user_id=(SELECT auth.uid())
         AND l.contact_id=le.tenant_id)
     OR EXISTS(SELECT 1 FROM public.portal_access_links l
       WHERE l.organization_id=rent_payments.organization_id AND l.user_id=(SELECT auth.uid())
         AND l.owner_id=le.owner_id)
    )
 ));
CREATE POLICY owner_statements_external_issued ON public.owner_statements FOR SELECT TO authenticated
 USING (status='ISSUED' AND EXISTS(
   SELECT 1 FROM public.portal_access_links l WHERE l.organization_id=owner_statements.organization_id
    AND l.owner_id=owner_statements.owner_id AND l.user_id=(SELECT auth.uid())
 ));
COMMIT;
