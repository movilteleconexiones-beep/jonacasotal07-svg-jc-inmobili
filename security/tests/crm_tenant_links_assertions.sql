-- Verify candidate blocks crossed links at DATABASE level, not only in UI or RLS.
DO $checks$
DECLARE denied boolean; num integer;
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_constraint
     WHERE connamespace='public'::regnamespace AND convalidated
       AND conname IN ('jco_leads_org_contact_fk','jco_leads_org_property_fk',
                       'jco_consignment_org_contact_fk','jco_consignment_org_property_fk',
                       'jco_consignment_org_lead_contact_fk'))<>5 THEN
   RAISE EXCEPTION 'Composite CRM foreign key validation incomplete';
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
SELECT 'PASS: five validated composite CRM FKs; cross-tenant INSERT/UPDATE rejected; legitimate links accepted' AS result;
