-- Per-tenant logo assets: A can upload only its own prefix.
SELECT public.consignment_test_assert(
 (SELECT public FROM storage.buckets WHERE id='jco-agency-logos'), 'logos are deliberately public');
SELECT public.consignment_test_assert(
 (SELECT file_size_limit FROM storage.buckets WHERE id='jco-agency-logos')=2097152,
 'logos limited to 2MB');
SELECT public.consignment_test_assert(
 NOT has_table_privilege('anon','public.agency_custom_domains','SELECT'),
 'domain ownership table cannot be listed anonymously');
SELECT public.consignment_test_assert(
 NOT has_table_privilege('authenticated','public.agency_custom_domains','UPDATE'),
 'ordinary staff cannot mark a domain verified or active');

SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
SET ROLE authenticated;
SELECT 'AUTH PROBE' AS phase, current_user AS sql_role, auth.uid() AS identity,
 public.has_org_permission('11111111-1111-1111-1111-111111111111','settings.edit') AS has_edit,
 jco_private.is_internal_staff('11111111-1111-1111-1111-111111111111') AS staff,
 ('11111111-1111-1111-1111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}[.](png|jpg|webp)(id,bucket_id,name) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','jco-agency-logos',
 '11111111-1111-1111-1111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png');
DO $t$ BEGIN
 BEGIN
  INSERT INTO storage.objects(id,bucket_id,name) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','jco-agency-logos',
   '22222222-2222-2222-2222-222222222222/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png');
  RAISE EXCEPTION 'Cross-tenant logo upload unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $t$;
DO $t$ BEGIN
 BEGIN
  INSERT INTO storage.objects(id,bucket_id,name) VALUES
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','jco-agency-logos',
   '11111111-1111-1111-1111-111111111111/ffffffff-ffff-4fff-8fff-ffffffffffff.svg');
  RAISE EXCEPTION 'SVG upload unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $t$;

SELECT public.consignment_test_assert(
 public.request_agency_custom_domain('11111111-1111-1111-1111-111111111111',
 'www.agencia-a.com')->>'status'='PENDING_DNS',
 'agency A can only request PENDING_DNS');
SELECT public.consignment_test_assert(
 public.get_my_agency_custom_domain('11111111-1111-1111-1111-111111111111')->>'hostname'='www.agencia-a.com',
 'agency A sees its own request');
DO $t$ BEGIN
 BEGIN
  PERFORM public.request_agency_custom_domain('11111111-1111-1111-1111-111111111111','www.inmojco.com');
  RAISE EXCEPTION 'Central INMOJCO domain must be reserved';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END $t$;
DO $t$ BEGIN
 BEGIN
  PERFORM public.request_agency_custom_domain('22222222-2222-2222-2222-222222222222','www.agencia-b.com');
  RAISE EXCEPTION 'A cannot claim B domain';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 public.get_my_agency_custom_domain('11111111-1111-1111-1111-111111111111') IS NULL,
 'B cannot read A domain request');
DO $t$ BEGIN
 BEGIN
  PERFORM public.request_agency_custom_domain('22222222-2222-2222-2222-222222222222','www.agencia-a.com');
  RAISE EXCEPTION 'B cannot claim an already registered hostname';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $t$;
RESET ROLE;
) AS valid_path;
INSERT INTO storage.objects(id,bucket_id,name) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','jco-agency-logos',
 '11111111-1111-1111-1111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png');
DO $t$ BEGIN
 BEGIN
  INSERT INTO storage.objects(id,bucket_id,name) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','jco-agency-logos',
   '22222222-2222-2222-2222-222222222222/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png');
  RAISE EXCEPTION 'Cross-tenant logo upload unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $t$;
DO $t$ BEGIN
 BEGIN
  INSERT INTO storage.objects(id,bucket_id,name) VALUES
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','jco-agency-logos',
   '11111111-1111-1111-1111-111111111111/ffffffff-ffff-4fff-8fff-ffffffffffff.svg');
  RAISE EXCEPTION 'SVG upload unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $t$;

SELECT public.consignment_test_assert(
 public.request_agency_custom_domain('11111111-1111-1111-1111-111111111111',
 'www.agencia-a.com')->>'status'='PENDING_DNS',
 'agency A can only request PENDING_DNS');
SELECT public.consignment_test_assert(
 public.get_my_agency_custom_domain('11111111-1111-1111-1111-111111111111')->>'hostname'='www.agencia-a.com',
 'agency A sees its own request');
DO $t$ BEGIN
 BEGIN
  PERFORM public.request_agency_custom_domain('11111111-1111-1111-1111-111111111111','www.inmojco.com');
  RAISE EXCEPTION 'Central INMOJCO domain must be reserved';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END $t$;
DO $t$ BEGIN
 BEGIN
  PERFORM public.request_agency_custom_domain('22222222-2222-2222-2222-222222222222','www.agencia-b.com');
  RAISE EXCEPTION 'A cannot claim B domain';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 public.get_my_agency_custom_domain('11111111-1111-1111-1111-111111111111') IS NULL,
 'B cannot read A domain request');
DO $t$ BEGIN
 BEGIN
  PERFORM public.request_agency_custom_domain('22222222-2222-2222-2222-222222222222','www.agencia-a.com');
  RAISE EXCEPTION 'B cannot claim an already registered hostname';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $t$;
RESET ROLE;
