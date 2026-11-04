\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 fixture; never executes against Supabase production.
CREATE ROLE jco_test_anon NOLOGIN;
CREATE ROLE jco_test_authenticated NOLOGIN;
CREATE ROLE jco_test_service NOLOGIN;
CREATE TABLE public.jco_privacy_probe (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL,
 private_note text NOT NULL
);
REVOKE ALL ON public.jco_privacy_probe FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.jco_privacy_probe_id_seq FROM PUBLIC;
ALTER TABLE public.jco_privacy_probe ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.jco_privacy_probe TO jco_test_authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.jco_privacy_probe TO jco_test_service;
DO $check$
BEGIN
 IF has_table_privilege('jco_test_anon','public.jco_privacy_probe','SELECT')
 OR has_table_privilege('jco_test_anon','public.jco_privacy_probe','INSERT')
 OR has_table_privilege('jco_test_authenticated','public.jco_privacy_probe','INSERT')
 OR has_sequence_privilege('jco_test_authenticated','public.jco_privacy_probe_id_seq','USAGE')
 THEN RAISE EXCEPTION 'Unexpected anonymous/member write or sequence privilege'; END IF;
 IF NOT has_table_privilege('jco_test_authenticated','public.jco_privacy_probe','SELECT')
 THEN RAISE EXCEPTION 'Expected read privilege absent'; END IF;
END $check$;
-- Enable a tenant-scoped read rule and confirm tenant A cannot see tenant B.
CREATE POLICY tenant_read ON public.jco_privacy_probe FOR SELECT TO jco_test_authenticated
 USING (organization_id = nullif(current_setting('jco.tenant',true),'')::uuid);
INSERT INTO public.jco_privacy_probe(organization_id,private_note) VALUES
 ('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','tenant-A'),
 ('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb','tenant-B');
GRANT USAGE ON SCHEMA public TO jco_test_authenticated;
SET ROLE jco_test_authenticated;
SET jco.tenant = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.jco_privacy_probe)<>1
 OR (SELECT min(private_note) FROM public.jco_privacy_probe)<>'tenant-A'
 THEN RAISE EXCEPTION 'Tenant separation failed'; END IF;
END $verify$;
RESET ROLE;
SELECT 'Explicit grants and tenant RLS regression passed' AS result;
