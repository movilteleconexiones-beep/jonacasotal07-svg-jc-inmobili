-- Repair restrictive financial SELECT policy drift in the active Supabase project.
-- Keep staff permissions. External users can only read a verified PERSONAL link.
-- No INSERT/UPDATE/DELETE policy, data or paid ledger is changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE expected integer;
BEGIN
  SELECT COUNT(*) INTO expected
  FROM pg_policies
  WHERE schemaname='public' AND permissive='RESTRICTIVE'
    AND cmd='SELECT' AND roles @> ARRAY['authenticated']::name[]
    AND (tablename,policyname) IN (
      ('leases','leases_financial_view'),
      ('rent_payments','rent_payments_financial_view'),
      ('owner_statements','owner_statement_financial_view')
    );
  IF expected<>3 THEN
    RAISE EXCEPTION 'Missing expected restrictive finance SELECT policies: %',expected;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='owner_statements' AND policyname='owner_statements_external_issued')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='leases' AND policyname='leases_owner_portal_select')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='rent_payments' AND policyname='rent_payments_external_personal')
  THEN
    RAISE EXCEPTION 'Portal personal SELECT policies missing: abort to prevent accidental expansion';
  END IF;
END $preflight$;

ALTER POLICY leases_financial_view ON public.leases TO authenticated
  USING (
    public.has_org_permission(organization_id,'leases.view')
    OR (status IN ('ACTIVE','TERMINATED')
      AND EXISTS (
        SELECT 1 FROM public.portal_access_links l
        WHERE l.organization_id=leases.organization_id
          AND l.user_id=(SELECT auth.uid())
          AND (l.contact_id=leases.tenant_id OR l.owner_id=leases.owner_id)
      ))
  );

ALTER POLICY rent_payments_financial_view ON public.rent_payments TO authenticated
  USING (
    public.has_org_permission(organization_id,'rent_payments.view')
    OR EXISTS (
      SELECT 1 FROM public.leases le
      WHERE le.id=rent_payments.lease_id
        AND le.organization_id=rent_payments.organization_id
        AND le.status IN ('ACTIVE','TERMINATED')
        AND EXISTS (
          SELECT 1 FROM public.portal_access_links l
          WHERE l.organization_id=rent_payments.organization_id
            AND l.user_id=(SELECT auth.uid())
            AND (l.contact_id=le.tenant_id OR l.owner_id=le.owner_id)
        )
    )
  );

ALTER POLICY owner_statement_financial_view ON public.owner_statements TO authenticated
  USING (
    public.has_org_permission(organization_id,'owner_statements.view')
    OR (issued_at IS NOT NULL AND status IN ('GENERATED','ISSUED')
      AND EXISTS (
        SELECT 1 FROM public.portal_access_links l
        WHERE l.organization_id=owner_statements.organization_id
          AND l.user_id=(SELECT auth.uid())
          AND l.owner_id=owner_statements.owner_id
      ))
  );

COMMIT;