-- Insert an extra organization and a private property that only its staff can read.
INSERT INTO public.organizations(id,status,plan_id)
VALUES ('abababab-abab-4bab-8bab-abababababab','ACTIVE','11111111-1111-4111-8111-111111111111');
INSERT INTO public.properties(id,organization_id)
VALUES ('fefefefe-fefe-4fef-8fef-fefefefefefe','abababab-abab-4bab-8bab-abababababab');

-- Reproduce the production risk: a broad legacy portal helper and SELECT
-- policy accidentally advertise every row, despite a tenant-specific UI.
CREATE OR REPLACE FUNCTION public.has_portal_property(target_property uuid)
 RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE POLICY properties_unintended_legacy_allow ON public.properties
 FOR SELECT TO authenticated USING (true);
-- A valid staff user can read both before the new defense-in-depth guard.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SET ROLE authenticated;
DO $test$ BEGIN
 IF (SELECT COUNT(*) FROM public.properties) <> 2 THEN
   RAISE EXCEPTION 'Expected to reproduce the broad property read prior to fix';
 END IF;
END $test$;
RESET ROLE;
