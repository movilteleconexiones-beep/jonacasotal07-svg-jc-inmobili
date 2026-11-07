-- INMOJCO #91 / G08: prevent linking maintenance to another tenant's property.
-- Preserve PostgREST relationship name and ON DELETE CASCADE behavior.
-- Requires public.properties unique (organization_id,id), already on production.
-- No data update; fail closed on unexpected DDL or existing cross-tenant rows.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '25s';
DO $preflight$
DECLARE v_fk text;
BEGIN
 IF current_user <> 'postgres' THEN
   RAISE EXCEPTION 'Expected postgres migration executor';
 END IF;
 SELECT pg_get_constraintdef(oid) INTO v_fk
 FROM pg_constraint WHERE conrelid='public.maintenance_requests'::regclass
   AND conname='maintenance_requests_property_id_fkey' AND contype='f';
 IF v_fk IS DISTINCT FROM
   'FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE'
 THEN RAISE EXCEPTION 'Maintenance property FK changed: %',v_fk; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indrelid='public.properties'::regclass AND i.indisunique AND i.indisvalid
    AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid='public.properties'::regclass AND attname='organization_id')
    AND i.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid='public.properties'::regclass AND attname='id')
    AND i.indnkeyatts=2
 ) THEN RAISE EXCEPTION 'Missing unique (organization_id,id) property key'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.maintenance_requests m JOIN public.properties p ON p.id=m.property_id
  WHERE m.organization_id IS DISTINCT FROM p.organization_id
 ) THEN RAISE EXCEPTION 'Existing cross-tenant maintenance property reference'; END IF;
END $preflight$;

ALTER TABLE public.maintenance_requests
  DROP CONSTRAINT maintenance_requests_property_id_fkey;

ALTER TABLE public.maintenance_requests
  ADD CONSTRAINT maintenance_requests_property_id_fkey
    FOREIGN KEY (organization_id,property_id)
    REFERENCES public.properties(organization_id,id)
    ON DELETE CASCADE;

DO $postflight$
DECLARE v_fk text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO v_fk FROM pg_constraint
 WHERE conrelid='public.maintenance_requests'::regclass
   AND conname='maintenance_requests_property_id_fkey';
 IF v_fk IS DISTINCT FROM
   'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id) ON DELETE CASCADE'
 THEN RAISE EXCEPTION 'Tenant maintenance FK was not established: %',v_fk; END IF;
 IF NOT (SELECT convalidated FROM pg_constraint
  WHERE conrelid='public.maintenance_requests'::regclass
   AND conname='maintenance_requests_property_id_fkey') THEN
  RAISE EXCEPTION 'Tenant maintenance FK is not validated';
 END IF;
END $postflight$;
