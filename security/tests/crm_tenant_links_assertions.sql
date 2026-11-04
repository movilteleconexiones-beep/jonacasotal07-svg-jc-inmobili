-- Verify candidate blocks crossed links at DATABASE level, not only in UI or RLS.
DO $checks$
DECLARE denied boolean; num integer;
BEGIN
 -- All existing relationship names are maintained, now with same-agency FKs.
 -- Adding secondary FK names here would break PostgREST embedded joins.
 IF (SELECT count(*) FROM pg_catalog.pg_constraint
     WHERE connamespace='public'::regnamespace AND convalidated
       AND conname IN ('leads_contact_id_fkey','leads_property_id_fkey',
           'property_consignments_contact_id_fkey',
           'property_consignments_property_id_fkey',
           'property_consignments_lead_id_fkey')
       AND cardinality(conkey)>1)<>5 THEN
   RAISE EXCEPTION 'Five same-name composite CRM FKs not validated';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='public.leads'::regclass AND c.contype='f'
         AND c.confrelid='public.contacts'::regclass)<>1
    OR (SELECT count(*) FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='public.leads'::regclass AND c.contype='f'
         AND c.confrelid='public.properties'::regclass)<>1
    OR (SELECT count(*) FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='public.property_consignments'::regclass AND c.contype='f'
         AND c.confrelid='public.contacts'::regclass)<>1
    OR (SELECT count(*) FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='public.property_consignments'::regclass AND c.contype='f'
         AND c.confrelid='public.properties'::regclass)<>1
    OR (SELECT count(*) FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='public.property_consignments'::regclass AND c.contype='f'
         AND c.confrelid='public.leads'::regclass)<>1 THEN
   RAISE EXCEPTION 'CRM PostgREST has multiple join paths to the same parent';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
     WHERE connamespace='public'::regnamespace AND convalidated
       AND conname='jco_consignment_lead_requires_contact') THEN
   RAISE EXCEPTION 'Nullable lead/contact guard missing or unvalidated';
 END IF;
 -- Legitimate matching agency records continue working.
 INSERT INTO public.leads VALUES (
   'cccccccc-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'aaaaaaaa-0000-4000-8000-000000000001');
 INSERT INTO public.property_consignments VALUES (
   'cccccccc-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000001');

 denied:=false;
 BEGIN
  INSERT INTO public.leads VALUES (
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   '11111111-1111-4111-8111-111111111111',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL);
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign-tenant contact accepted for lead'; END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.leads VALUES (
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'bbbbbbbb-0000-4000-8000-000000000002');
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign-tenant property accepted for lead'; END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.property_consignments VALUES (
   'dddddddd-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL,NULL);
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign-tenant contact accepted in consignment'; END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.property_consignments VALUES (
   'dddddddd-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL,
   'bbbbbbbb-0000-4000-8000-000000000002');
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign-tenant property accepted in consignment'; END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.property_consignments VALUES (
   'dddddddd-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'bbbbbbbb-2222-4222-8222-222222222222',NULL);
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign-tenant lead accepted in consignment'; END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.property_consignments VALUES (
   'dddddddd-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'aaaaaaaa-1111-4111-8111-111111111111',NULL);
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Consignment lead accepted with wrong contact in same agency'; END IF;

 -- Without this CHECK, MATCH SIMPLE skips the 3-column FK when contact_id
 -- is NULL, allowing an unrelated lead from a different organization.
 denied:=false;
 BEGIN
  INSERT INTO public.property_consignments VALUES (
   'dddddddd-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   NULL,'bbbbbbbb-2222-4222-8222-222222222222',NULL);
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'NULL contact bypassed composite lead FK'; END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.property_consignments VALUES (
   'dddddddd-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   NULL,'aaaaaaaa-1111-4111-8111-111111111111',NULL);
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'NULL contact accepted with same-tenant lead'; END IF;

 denied:=false;
 BEGIN
  UPDATE public.leads SET contact_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  WHERE id='aaaaaaaa-1111-4111-8111-111111111111';
 EXCEPTION WHEN foreign_key_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant contact UPDATE accepted'; END IF;

 IF (SELECT count(*) FROM public.leads)<>3
 OR (SELECT count(*) FROM public.property_consignments)<>2 THEN
  RAISE EXCEPTION 'Rejected attempts modified existing CRM data';
 END IF;
END $checks$;

-- The authenticated tenant author cannot use RLS to bypass these new FKs.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
DO $actor$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.leads VALUES(
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   '11111111-1111-4111-8111-111111111111',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL);
 EXCEPTION WHEN foreign_key_violation THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Authenticated actor bypassed tenant FK'; END IF;
END $actor$;
ROLLBACK;
SELECT 'PASS: five validated same-name composite CRM FKs, single PostgREST parent paths, NULL guard, and tenant isolation' AS result;
