-- INMOJCO #104/#203 — review-only candidate, NOT a Supabase migration.
-- DO NOT RUN against production or add to supabase/migrations until #104,
-- backups, branch protection, staging integration and rollback are approved.
--
-- Existing FK(property_id)->properties(id) can validate a property from a
-- different organization despite maintenance_requests.org-scoped RLS.
-- Add a second composite FK without dropping the legacy FK in this phase.
-- The original ON DELETE CASCADE contract remains intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Lock before the preflight to prevent race between checking existing rows
-- and adding the FK. This may briefly block writes: staging only.
LOCK TABLE public.maintenance_requests IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
DECLARE
  v_child oid := to_regclass('public.maintenance_requests');
  v_parent oid := to_regclass('public.properties');
  v_expected_name text := 'maintenance_requests_property_same_tenant_fk';
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: authorized postgres owner required';
  END IF;
  IF v_child IS NULL OR v_parent IS NULL OR NOT EXISTS(
    SELECT 1 FROM pg_class c WHERE c.oid=v_child AND c.relkind IN ('r','p')
      AND c.relowner='postgres'::regrole AND c.relrowsecurity
  ) OR NOT EXISTS(
    SELECT 1 FROM pg_class c WHERE c.oid=v_parent AND c.relkind IN ('r','p')
      AND c.relowner='postgres'::regrole AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: owner/table/RLS contract changed';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_child AND c.contype='f'
      AND c.confrelid=v_parent AND c.confdeltype='c'
      AND pg_get_constraintdef(c.oid,true) =
        'FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE'
  ) OR NOT EXISTS(
    SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_parent AND c.contype='u'
      AND pg_get_constraintdef(c.oid,true)='UNIQUE (organization_id, id)'
  ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: expected legacy FK or parent composite UNIQUE missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.maintenance_requests mr
    LEFT JOIN public.properties p ON p.id=mr.property_id
    WHERE p.id IS NULL OR mr.organization_id IS DISTINCT FROM p.organization_id
  ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: existing cross-tenant/dangling records';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_child
      AND c.conname=v_expected_name AND (
        c.contype<>'f' OR c.confrelid<>v_parent
        OR c.confdeltype<>'c' OR c.condeferrable
        OR pg_get_constraintdef(c.oid,true) NOT IN (
          'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id) ON DELETE CASCADE',
          'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id) ON DELETE CASCADE NOT VALID'
        )
      )
  ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: unexpected existing constraint';
  END IF;
END
$preflight$;
DO $add$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.maintenance_requests'::regclass
      AND conname='maintenance_requests_property_same_tenant_fk'
  ) THEN
    ALTER TABLE public.maintenance_requests
      ADD CONSTRAINT maintenance_requests_property_same_tenant_fk
      FOREIGN KEY (organization_id,property_id)
      REFERENCES public.properties(organization_id,id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$add$;
ALTER TABLE public.maintenance_requests
  VALIDATE CONSTRAINT maintenance_requests_property_same_tenant_fk;
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.maintenance_requests'::regclass
      AND conname='maintenance_requests_property_same_tenant_fk'
      AND contype='f' AND convalidated
  ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: composite FK not validated';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
        WHERE oid='public.maintenance_requests'::regclass)
     OR NOT has_table_privilege('service_role','public.maintenance_requests','SELECT')
     OR NOT has_table_privilege('authenticated','public.maintenance_requests','INSERT')
  THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: original RLS/API access changed';
  END IF;
END
$verify$;
COMMIT;
