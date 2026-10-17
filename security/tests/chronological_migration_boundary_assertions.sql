-- This assertion runs specifically AFTER the 19:40 public catalog migration
-- and BEFORE the 19:55 stricter private inventory RLS migration.
-- It enforces a safe migration boundary in the actual filename timestamp
-- order, even when tenant traffic exists between independently committed DDL.
-- CI only: fake data, never run on production.
DO $jco_order$
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class
         WHERE oid='public.properties'::regclass)
    OR has_table_privilege('anon','public.properties','SELECT')
    OR has_table_privilege('anon','public.properties','INSERT')
    OR has_table_privilege('anon','public.properties','UPDATE')
    OR has_table_privilege('anon','public.properties','DELETE')
 THEN RAISE EXCEPTION
    'Chronological migration boundary is unsafe: anonymous property grants survive catalog creation';
 END IF;

 IF (SELECT count(*) FROM public.property_publications)<>0
    OR jsonb_array_length(public.get_public_agency_listings('tenant-a',24,0))<>0
    OR jsonb_array_length(public.get_public_agency_listings('tenant-b',24,0))<>0
 THEN RAISE EXCEPTION
    'Chronological migration boundary is unsafe: properties auto-published before RLS hardening';
 END IF;
END $jco_order$;
