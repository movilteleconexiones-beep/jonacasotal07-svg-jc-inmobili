-- INMOJCO #104/#203 — review-only candidate, NOT a Supabase migration.
-- DO NOT RUN in production until #104, verified backups, main protection,
-- staging integration, PostgREST compatibility and rollback are approved.
--
-- The old FK(property_id)->properties(id) fails to enforce tenant ownership.
-- REPLACE that FK IN PLACE, keeping its name and ON DELETE CASCADE:
-- a parallel FK to the same parent risks ambiguous PostgREST embeds (PGRST201).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Lock parents before children to serialize changes before validation.
LOCK TABLE public.properties IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.maintenance_requests IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
DECLARE
  v_child oid := to_regclass('public.maintenance_requests');
  v_parent oid := to_regclass('public.properties');
  v_old text := 'FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE';
  v_new text := 'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id) ON DELETE CASCADE';
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: authorized postgres owner required';
  END IF;
  IF v_child IS NULL OR v_parent IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_class c
       WHERE c.oid IN (v_child, v_parent)
         AND (c.relkind NOT IN ('r','p') OR c.relowner <> 'postgres'::regrole
           OR NOT c.relrowsecurity)
     ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: owner/table/RLS contract changed';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_parent
      AND c.conname='financial_properties_tenant_id_unique'
      AND c.contype='u' AND c.convalidated
      AND pg_get_constraintdef(c.oid,true)='UNIQUE (organization_id, id)'
  ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: parent composite UNIQUE missing or changed';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_child
      AND c.conname='maintenance_requests_property_id_fkey'
      AND c.contype='f' AND c.confrelid=v_parent
      AND NOT c.condeferrable
      AND pg_get_constraintdef(c.oid,true) IN (v_old,v_new)
  ) OR (
    SELECT count(*) FROM pg_constraint c
    WHERE c.conrelid=v_child AND c.contype='f' AND c.confrelid=v_parent
  ) <> 1 THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: original or single PostgREST FK contract changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.maintenance_requests mr
    LEFT JOIN public.properties p ON p.id=mr.property_id
    WHERE p.id IS NULL OR mr.organization_id IS DISTINCT FROM p.organization_id
  ) THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: existing cross-tenant/dangling records';
  END IF;
END
$preflight$;
DO $replace$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.maintenance_requests'::regclass
      AND c.conname='maintenance_requests_property_id_fkey'
      AND pg_get_constraintdef(c.oid,true)=
        'FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE'
  ) THEN
    ALTER TABLE public.maintenance_requests
      DROP CONSTRAINT maintenance_requests_property_id_fkey;
    ALTER TABLE public.maintenance_requests
      ADD CONSTRAINT maintenance_requests_property_id_fkey
      FOREIGN KEY (organization_id,property_id)
      REFERENCES public.properties(organization_id,id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$replace$;
ALTER TABLE public.maintenance_requests
  VALIDATE CONSTRAINT maintenance_requests_property_id_fkey;
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.maintenance_requests'::regclass
      AND c.conname='maintenance_requests_property_id_fkey'
      AND c.contype='f' AND c.convalidated AND c.confdeltype='c'
      AND pg_get_constraintdef(c.oid,true)=
        'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id) ON DELETE CASCADE'
  ) OR (
    SELECT count(*) FROM pg_constraint c
    WHERE c.conrelid='public.maintenance_requests'::regclass
      AND c.contype='f' AND c.confrelid='public.properties'::regclass
  ) <> 1 THEN
    RAISE EXCEPTION 'maintenance tenant FK blocked: composite FK invalid or PostgREST relationship ambiguous';
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
NOTIFY pgrst, 'reload schema';
COMMIT;
