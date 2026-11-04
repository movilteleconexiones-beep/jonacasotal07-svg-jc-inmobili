-- Prove legacy schema permits duplicates and candidate fails closed.
-- Fake identities only. The CI wrapper MUST reject candidate DDL here.
INSERT INTO public.contacts(organization_id,first_name,last_name,email) VALUES
 ('11111111-1111-4111-8111-111111111111','Duplicate','Fixture','duplicate@example.test'),
 ('11111111-1111-4111-8111-111111111111','duplicate','fixture','DUPLICATE@example.test');
DO $e$
BEGIN
 IF (SELECT count(*) FROM public.contacts WHERE organization_id=
   '11111111-1111-4111-8111-111111111111')<>2
 THEN RAISE EXCEPTION 'Legacy duplicate reproduction failed'; END IF;
END $e$;
SELECT 'PASS: unguarded legacy schema accepts duplicate contact identities' AS result;
