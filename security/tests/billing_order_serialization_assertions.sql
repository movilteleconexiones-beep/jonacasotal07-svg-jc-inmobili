-- In synthetic jco_billing_serialization_test ONLY, after candidate DDL.
-- Static authorization and lifecycle checks; concurrency covered separately.
DO $assert$
DECLARE role_denied boolean:=false;
        org_count integer;
        idx integer;
        tbl text;
BEGIN
  IF has_function_privilege('anon',
    'public.create_authorized_sandbox_payment_order(uuid,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Anonymous order RPC execution was allowed'; END IF;
  IF NOT has_function_privilege('authenticated',
    'public.create_authorized_sandbox_payment_order(uuid,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Authenticated order RPC lost EXECUTE'; END IF;
  IF has_table_privilege('authenticated','public.member_permissions','UPDATE') OR
     has_table_privilege('authenticated','public.role_permissions','INSERT') THEN
    RAISE EXCEPTION 'Direct client mutation of billing grants is not restricted'; END IF;

  FOREACH tbl IN ARRAY ARRAY['organizations','organization_members',
    'member_permissions','member_roles','roles','role_permissions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('public.'||tbl)
        AND t.tgname='jco_billing_auth_lock' AND NOT t.tgisinternal
        AND (t.tgtype & 1) = 0 -- STATEMENT, not ROW
        AND (t.tgtype & 2) = 2 -- BEFORE the writer acquires row locks
    ) THEN RAISE EXCEPTION 'Missing authorization lock trigger on %',tbl; END IF;
  END LOOP;
  BEGIN
    UPDATE public.permissions SET key='billing.manage.replaced'
      WHERE key='billing.manage';
  EXCEPTION WHEN insufficient_privilege THEN role_denied:=true;
  END;
  IF NOT role_denied THEN
    RAISE EXCEPTION 'Billing permission catalog was mutable'; END IF;
END;
$assert$;

-- Organization onboarding does not require an existing row-level lock for a
-- brand-new tenant. It must not accidentally fail under the BEFORE trigger.
INSERT INTO public.organizations(id,status)
VALUES('33333333-3333-4333-8333-333333333333','ACTIVE');
DO $assert$
BEGIN
 IF (SELECT count(*) FROM public.organizations)<>3
 OR (SELECT count(*) FROM public.payment_orders)<>0
 THEN RAISE EXCEPTION 'Synthetic tenant onboarding or baseline changed'; END IF;
END;
$assert$;
