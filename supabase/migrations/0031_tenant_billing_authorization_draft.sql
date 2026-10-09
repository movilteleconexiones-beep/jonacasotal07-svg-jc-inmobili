-- DRAFT ONLY. Apply in reviewed staging after 0030; NOT production.
-- Authenticated tenant authorization: do not accept a caller-provided user ID.
-- No grants of billing.manage are made here.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_create_tenant_payment_order(target_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
 SELECT coalesce(
   auth.uid() IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.organizations o
     JOIN public.organization_members m ON m.organization_id=o.id
     WHERE o.id=target_org AND o.status='ACTIVE'
       AND m.user_id=auth.uid() AND m.status='ACTIVE'
   )
   AND public.has_org_permission(target_org,'billing.manage'),
   false
 );
$$;
REVOKE ALL ON FUNCTION public.can_create_tenant_payment_order(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_create_tenant_payment_order(uuid) TO authenticated;
COMMIT;
