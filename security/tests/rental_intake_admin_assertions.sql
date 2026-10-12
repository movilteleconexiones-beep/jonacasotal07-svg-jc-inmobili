-- Production-safe behavior rehearsed with fake isolated PostgreSQL 17 data.
BEGIN;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.role_permissions rp
 JOIN public.roles r ON r.id=rp.role_id
 JOIN public.permissions p ON p.id=rp.permission_id
 WHERE r.key='AGENT' AND p.key IN ('leases.view','leases.create');
 IF n<>2 THEN RAISE EXCEPTION 'Agent did not receive exactly leases.view and leases.create'; END IF;
 SELECT count(*) INTO n FROM public.role_permissions rp
 JOIN public.roles r ON r.id=rp.role_id
 JOIN public.permissions p ON p.id=rp.permission_id
 WHERE r.key='AGENT' AND p.key IN ('leases.edit','rent_payments.create');
 IF n<>0 THEN RAISE EXCEPTION 'Agent could approve contracts or collect'; END IF;
END;$$;

SELECT set_config('jco_test.organization','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('jco_test.actor','d1000000-0000-4000-8000-000000000001',false);

-- No signed PDF: even ADMIN with leases.edit is denied.
DO $$
BEGIN
 UPDATE public.leases SET status='ACTIVE' WHERE id='55555555-5555-4555-8555-555555555555';
 RAISE EXCEPTION 'UNSAFE: activated without signed PDF';
EXCEPTION WHEN SQLSTATE '23514' THEN
 IF SQLERRM LIKE 'UNSAFE:%' THEN RAISE; END IF;
 IF SQLERRM NOT LIKE '%signed private PDF%' THEN RAISE; END IF;
END;$$;

INSERT INTO public.documents VALUES
 ('e1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'GENERAL','55555555-5555-4555-8555-555555555555',
  'CONTRACT','organization-documents',
  '11111111-1111-4111-8111-111111111111/leases/55555555-5555-4555-8555-555555555555/signed/f1000000-0000-4000-8000-000000000001.pdf',
  'application/pdf');
-- A metadata row alone is not proof that the PDF still exists.
DO $$
BEGIN
 UPDATE public.leases SET status='ACTIVE' WHERE id='55555555-5555-4555-8555-555555555555';
 RAISE EXCEPTION 'UNSAFE: missing private object';
EXCEPTION WHEN SQLSTATE '23514' THEN
 IF SQLERRM LIKE 'UNSAFE:%' THEN RAISE; END IF;
 IF SQLERRM NOT LIKE '%signed private PDF%' THEN RAISE; END IF;
END;$$;
INSERT INTO storage.objects VALUES(
 'organization-documents',
 '11111111-1111-4111-8111-111111111111/leases/55555555-5555-4555-8555-555555555555/signed/f1000000-0000-4000-8000-000000000001.pdf');

-- Signed PDF exists but only ADMIN may activate.
SELECT set_config('jco_test.actor','d1000000-0000-4000-8000-000000000002',false);
DO $$
BEGIN
 UPDATE public.leases SET status='ACTIVE' WHERE id='55555555-5555-4555-8555-555555555555';
 RAISE EXCEPTION 'UNSAFE: agent activated';
EXCEPTION WHEN SQLSTATE '42501' THEN
 IF SQLERRM LIKE 'UNSAFE:%' THEN RAISE; END IF;
END;$$;

-- ADMIN cannot activate twice against an already occupied property.
SELECT set_config('jco_test.actor','d1000000-0000-4000-8000-000000000001',false);
DO $$
BEGIN
 UPDATE public.leases SET status='ACTIVE' WHERE id='55555555-5555-4555-8555-555555555555';
 RAISE EXCEPTION 'UNSAFE: duplicate active lease';
EXCEPTION WHEN unique_violation THEN
 IF SQLERRM LIKE 'UNSAFE:%' THEN RAISE; END IF;
END;$$;

-- Finish former lease, then activating the signed replacement succeeds.
UPDATE public.leases SET status='FINISHED' WHERE id='33333333-3333-4333-8333-333333333333';
UPDATE public.leases SET status='ACTIVE' WHERE id='55555555-5555-4555-8555-555555555555';
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.leases WHERE id='55555555-5555-4555-8555-555555555555' AND status='ACTIVE'
 ) THEN RAISE EXCEPTION 'Admin activation did not succeed after former lease ended'; END IF;
END;$$;
ROLLBACK;
