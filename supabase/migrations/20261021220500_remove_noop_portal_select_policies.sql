-- Only remove proven non-contributing PERMISSIVE SELECT USING(false) policies.
-- Existing affirmative and restrictive tenant-isolation policies are preserved.
-- Abort if policies have changed or their legitimate guards are missing.
BEGIN;
DO $policy_safety$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('activities','activities_portal_select','activities_select'),
    ('appointments','appointments_portal_select','appointments_select'),
    ('deals','deals_portal_select','deals_select'),
    ('leads','leads_portal_select','leads_select')
  ) AS target(table_name,noop_name,legitimate_name) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname='public'
        AND p.tablename=item.table_name AND p.policyname=item.noop_name
        AND p.cmd='SELECT' AND p.permissive='PERMISSIVE'
        AND p.roles=ARRAY['authenticated']::name[] AND btrim(p.qual)='false'
    ) THEN
      RAISE EXCEPTION 'Unexpected policy definition for %.%',item.table_name,item.noop_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname='public'
        AND p.tablename=item.table_name AND p.policyname=item.legitimate_name
        AND p.cmd='SELECT' AND p.permissive='PERMISSIVE' AND p.qual<>'false'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname='public'
        AND p.tablename=item.table_name AND p.policyname='jco_commercial_access'
        AND p.permissive='RESTRICTIVE'
    ) THEN
      RAISE EXCEPTION 'Missing authorized or restrictive policy for %',item.table_name;
    END IF;
  END LOOP;
END;
$policy_safety$;
DROP POLICY "activities_portal_select" ON public.activities;
DROP POLICY "appointments_portal_select" ON public.appointments;
DROP POLICY "deals_portal_select" ON public.deals;
DROP POLICY "leads_portal_select" ON public.leads;
COMMIT;
