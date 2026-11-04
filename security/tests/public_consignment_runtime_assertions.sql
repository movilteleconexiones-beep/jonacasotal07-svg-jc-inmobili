-- Test the currently deployed consignation RPC bodies, not a replacement migration.
-- Only for the matching synthetic fixture in a throwaway PostgreSQL 17 instance.
REVOKE ALL ON FUNCTION public.get_public_property_intake_site(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_property_consignment(text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_property_intake_site(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_property_consignment(text,uuid,jsonb) TO anon,authenticated;
DO $acl$
BEGIN
 IF NOT has_function_privilege('anon','public.get_public_property_intake_site(text)','EXECUTE')
    OR NOT has_function_privilege('anon','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
    OR has_table_privilege('anon','public.property_consignments','SELECT')
    OR has_table_privilege('anon','public.property_consignments','INSERT')
    OR has_table_privilege('authenticated','public.property_consignments','SELECT')
 THEN RAISE EXCEPTION 'Public consignation ACL drift'; END IF;
END $acl$;
BEGIN;
SET LOCAL ROLE anon;
DO $exercise$
DECLARE
 p jsonb:=jsonb_build_object(
   'title','Apartamento sintético con autorización',
   'operation_type','RENT','property_type','APARTMENT',
   'price',1700000,'lot_area',120,'built_area',80,
   'bedrooms',2,'bathrooms',1.5,'parking_spaces',1,
   'administration_fee',0,'construction_year',2010,
   'state','Antioquia','city','Medellin','neighborhood','Centro',
   'description','Apartamento de datos completamente ficticios',
   'owner_name','Propietario ficticio',
   'owner_phone','+57 300 123 4567','contact_consent',true
 );
 request_a uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 request_a2 uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 receipt1 jsonb; receipt2 jsonb; receipt_beta jsonb;
 denied boolean; slug text;
BEGIN
 IF public.get_public_property_intake_site('alpha-form')->>'company_name'
       <> 'Alpha Inmobiliaria'
    OR public.get_public_property_intake_site('beta-form')->>'company_name'
       <> 'Beta Inmobiliaria'
    OR public.get_public_property_intake_site('alpha-form')->>'currency' <> 'COP'
 THEN RAISE EXCEPTION 'Public intake site returned wrong agency identity'; END IF;
 FOREACH slug IN ARRAY ARRAY[
   'suspended-form','disabled-form','unpaid-form','hidden-form','missing-form'
 ] LOOP
  IF public.get_public_property_intake_site(slug) IS NOT NULL THEN
    RAISE EXCEPTION 'Blocked site metadata leaked: %',slug;
  END IF;
 END LOOP;

 receipt1:=public.submit_property_consignment('alpha-form',request_a,p);
 IF receipt1->>'reference' IS NULL THEN RAISE EXCEPTION 'Missing receipt'; END IF;
 receipt2:=public.submit_property_consignment('alpha-form',request_a,p);
 IF receipt2<>receipt1 THEN RAISE EXCEPTION 'Idempotent retry generated another reference'; END IF;
 -- Tenant B can use the same UUID and must receive its OWN reference.
 receipt_beta:=public.submit_property_consignment('beta-form',request_a,p);
 IF receipt_beta->>'reference' IS NULL OR receipt_beta=receipt1 THEN
   RAISE EXCEPTION 'Cross-tenant request ID was deduplicated or leaked';
 END IF;

 -- Same UUID with different content must fail, not replace saved payload.
 denied:=false;
 BEGIN
  PERFORM public.submit_property_consignment('alpha-form',request_a,
    p||jsonb_build_object('title','Manipulación de contenido'));
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Changed request replay was accepted'; END IF;

 -- Consent is mandatory for consignations, too.
 denied:=false;
 BEGIN
  PERFORM public.submit_property_consignment('alpha-form',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',p||jsonb_build_object('contact_consent',false));
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Consignment without consent accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.submit_property_consignment('alpha-form',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',p||jsonb_build_object('unknown_private_field','secret'));
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unknown payload attribute accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.submit_property_consignment('alpha-form',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',p||jsonb_build_object('price',-10));
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid property price accepted'; END IF;

 receipt2:=public.submit_property_consignment('alpha-form',request_a2,
   p||jsonb_build_object('title','Segundo apartamento ficticio'));
 IF receipt2->>'reference' IS NULL THEN RAISE EXCEPTION 'Second valid intake rejected'; END IF;
 -- Hourly limit is 2, so third distinct accepted payload must be refused.
 denied:=false;
 BEGIN
  PERFORM public.submit_property_consignment('alpha-form',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',p);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Per-tenant hourly quota bypassed'; END IF;

 FOREACH slug IN ARRAY ARRAY[
   'suspended-form','disabled-form','unpaid-form','hidden-form','missing-form'
 ] LOOP
  denied:=false;
  BEGIN
   PERFORM public.submit_property_consignment(slug,
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',p);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Blocked intake accepted for %',slug; END IF;
 END LOOP;
END $exercise$;
COMMIT;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.property_consignments)<>3
    OR (SELECT count(*) FROM public.property_consignments
        WHERE organization_id='11111111-1111-4111-8111-111111111111')<>2
    OR (SELECT count(*) FROM public.property_consignments
        WHERE organization_id='22222222-2222-4222-8222-222222222222')<>1
 THEN RAISE EXCEPTION 'Rejected/retried consignations changed row counts'; END IF;
 IF EXISTS (SELECT 1 FROM public.property_consignments c
   WHERE c.payload ? 'owner_name' OR c.payload ? 'owner_phone'
      OR c.payload ? 'contact_consent' OR c.payload ? 'unknown_private_field'
      OR c.contact_name<>'Propietario ficticio'
      OR c.contact_phone<>'573001234567'
      OR c.payload->>'country'<>'CO' OR c.payload->>'currency'<>'COP')
 THEN RAISE EXCEPTION 'Consignation contact separation / payload sanitation broken'; END IF;
END $verify$;
SELECT 'PASS: real consignment SQL, tenant separation, consent, retries, quotas, payload sanitation, disabled portals' AS result;
