DO $$ BEGIN
 IF to_regprocedure('private.can_read_portal_property(uuid,uuid)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='properties'
 AND policyname='properties_select_portal_related' AND qual LIKE '%private.can_read_portal_property%')
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_ownerships'
 AND policyname='ownerships_select_portal_owner')
 OR has_function_privilege('anon','private.can_read_portal_property(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Portal recursion fix incomplete'; END IF;
END $$;
NOTIFY pgrst,'reload schema';