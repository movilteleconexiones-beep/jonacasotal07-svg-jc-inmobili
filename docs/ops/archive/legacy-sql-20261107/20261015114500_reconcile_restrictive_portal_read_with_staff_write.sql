-- Restore private owner/tenant SELECT without weakening restrictive staff write gates.
-- PR #175 updated an AS RESTRICTIVE FOR ALL policy as if it were permissive.
-- Keep all INSERT / UPDATE / DELETE commercially gated and individually authorized.
BEGIN;

DO $jco$
DECLARE
  t text;
  portal_scope text;
  staff_gate constant text :=
    '(jco_private.operational_access(organization_id) AND ' ||
    '(public.is_platform_admin() OR jco_private.is_internal_staff(organization_id)))';
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'portal_access_links','properties','leases',
    'rent_payments','owner_statements','documents'
  ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=t
        AND policyname='jco_commercial_access'
        AND permissive='RESTRICTIVE' AND cmd='ALL'
    ) THEN
      RAISE EXCEPTION 'Expected RESTRICTIVE ALL commercial policy missing: %',t;
    END IF;

    IF t='portal_access_links' THEN
      portal_scope := '(user_id=(SELECT auth.uid()))';
    ELSIF t='properties' THEN
      portal_scope := 'public.has_portal_property(id)';
    ELSE
      portal_scope := format(
        'EXISTS (SELECT 1 FROM public.portal_access_links ext ' ||
        'WHERE ext.organization_id=%I.organization_id ' ||
        'AND ext.user_id=(SELECT auth.uid()))',t
      );
    END IF;

    EXECUTE format('DROP POLICY jco_commercial_access ON public.%I',t);
    EXECUTE format(
      'CREATE POLICY jco_commercial_portal_read_guard ON public.%I ' ||
      'AS RESTRICTIVE FOR SELECT TO authenticated USING (%s OR %s)',
      t,staff_gate,portal_scope
    );
    EXECUTE format(
      'CREATE POLICY jco_commercial_staff_insert_guard ON public.%I ' ||
      'AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)',
      t,staff_gate
    );
    EXECUTE format(
      'CREATE POLICY jco_commercial_staff_update_guard ON public.%I ' ||
      'AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
      t,staff_gate,staff_gate
    );
    EXECUTE format(
      'CREATE POLICY jco_commercial_staff_delete_guard ON public.%I ' ||
      'AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)',
      t,staff_gate
    );
  END LOOP;
END $jco$;

-- Existing finance-specific RESTRICTIVE SELECT policies were also requiring
-- operational staff permissions even when personal portal SELECT was allowed.
-- Preserve staff permission checks, adding only direct active lease/owner links.
DO $jco$
BEGIN
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public'
        AND (tablename,policyname) IN (
          ('leases','leases_financial_view'),
          ('rent_payments','rent_payments_financial_view'),
          ('owner_statements','owner_statement_financial_view'))
        AND cmd='SELECT' AND permissive='RESTRICTIVE') <> 3
  THEN
    RAISE EXCEPTION 'Expected three restrictive finance SELECT guards missing';
  END IF;
END $jco$;

ALTER POLICY leases_financial_view ON public.leases TO authenticated
  USING (
    public.has_org_permission(organization_id,'leases.view')
    OR (
      status IN ('ACTIVE','TERMINATED')
      AND EXISTS (
        SELECT 1 FROM public.portal_access_links l
        WHERE l.organization_id=leases.organization_id
          AND l.user_id=(SELECT auth.uid())
          AND (l.contact_id=leases.tenant_id OR l.owner_id=leases.owner_id)
      )
    )
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
    OR (
      issued_at IS NOT NULL AND status IN ('GENERATED','ISSUED')
      AND EXISTS (
        SELECT 1 FROM public.portal_access_links l
        WHERE l.organization_id=owner_statements.organization_id
          AND l.user_id=(SELECT auth.uid())
          AND l.owner_id=owner_statements.owner_id
      )
    )
  );

COMMIT;
