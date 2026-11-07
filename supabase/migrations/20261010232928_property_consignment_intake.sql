DO $$ BEGIN
 IF to_regclass('private.property_intake_sites') IS NULL OR to_regclass('public.property_consignments') IS NULL
 OR to_regprocedure('public.get_public_property_intake_site(text)') IS NULL
 OR to_regprocedure('public.submit_property_consignment(text,uuid,jsonb)') IS NULL
 OR to_regprocedure('public.review_property_consignment(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'Incomplete consignment migration'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.property_consignments'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.property_intake_sites'::regclass)
 OR has_table_privilege('anon','private.property_intake_sites','SELECT')
 OR has_table_privilege('authenticated','public.property_consignments','INSERT')
 OR NOT has_function_privilege('anon','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_consignments' AND policyname='property_consignments_read')
 THEN RAISE EXCEPTION 'Consignment security incomplete'; END IF;
 IF (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='property_consignments' AND indexname IN
 ('property_consignments_org_created','property_consignments_org_phone_created','property_consignments_reviewed_by','property_consignments_property','property_consignments_contact','property_consignments_lead'))<>6 THEN RAISE EXCEPTION 'Consignment indexes incomplete'; END IF;
END $$;
NOTIFY pgrst,'reload schema';