-- Real PostgreSQL constraint assertions, no production tenant information.
INSERT INTO public.leads(id,organization_id,contact_id,property_id) VALUES
('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.deals(id,organization_id,contact_id,property_id) VALUES
('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.commissions(id,organization_id,deal_id) VALUES
('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','ffffffff-ffff-4fff-8fff-ffffffffffff');

-- A known ID in a different organization cannot be used in any link.
DO $checks$
BEGIN
  BEGIN
    INSERT INTO public.leads VALUES('20202020-2020-4020-8020-202020202020','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL);
    RAISE EXCEPTION 'Cross-tenant lead contact accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.leads VALUES('30303030-3030-4030-8030-303030303030','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    RAISE EXCEPTION 'Cross-tenant lead property accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.deals VALUES('40404040-4040-4040-8040-404040404040','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    RAISE EXCEPTION 'Cross-tenant deal contact accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.deals VALUES('50505050-5050-4050-8050-505050505050','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    RAISE EXCEPTION 'Cross-tenant deal property accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commissions VALUES('60606060-6060-4060-8060-606060606060','22222222-2222-4222-8222-222222222222','ffffffff-ffff-4fff-8fff-ffffffffffff');
    RAISE EXCEPTION 'Cross-tenant commission deal accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.deals SET organization_id='22222222-2222-4222-8222-222222222222'
      WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffff';
    RAISE EXCEPTION 'Cross-tenant deal transfer accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$checks$;

-- Nullable lead property retains the tenant when its referenced property is deleted.
INSERT INTO public.leads(id,organization_id,contact_id,property_id) VALUES
('80808080-8080-4080-8080-808080808080','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
DELETE FROM public.properties WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
DO $assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id='80808080-8080-4080-8080-808080808080'
      AND organization_id='11111111-1111-4111-8111-111111111111'
      AND property_id IS NULL
  ) THEN RAISE EXCEPTION 'Lead property deletion damaged organization identity'; END IF;
END
$assertions$;

-- Existing RESTRICT/CASCADE semantics still work.
DELETE FROM public.deals WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffff';
DO $cleanup$
BEGIN
  IF EXISTS(SELECT 1 FROM public.commissions WHERE id='77777777-7777-4777-8777-777777777777') THEN
    RAISE EXCEPTION 'Deleting a deal did not cascade its commission';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN
    ('public.leads'::regclass,'public.deals'::regclass,'public.commissions'::regclass)) <> 5 THEN
    RAISE EXCEPTION 'Expected exactly one FK per commercial relation';
  END IF;
END
$cleanup$;
