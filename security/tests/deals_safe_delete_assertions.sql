-- All simulated UUIDs and rows are isolated; no production data is touched.
BEGIN;
DO $$
BEGIN
 IF has_table_privilege('authenticated','public.deals','DELETE') OR
    has_table_privilege('anon','public.deals','DELETE') THEN
   RAISE EXCEPTION 'Direct deals delete privilege was not revoked';
 END IF;
 IF NOT has_function_privilege('authenticated','public.delete_unlinked_deal(uuid,uuid)','EXECUTE') OR
    has_function_privilege('anon','public.delete_unlinked_deal(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'RPC execution grants are unsafe';
 END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('jco_test.actor','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$
BEGIN
 PERFORM public.delete_unlinked_deal(
  '11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111');
 RAISE EXCEPTION 'UNSAFE: agent deleted business';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SELECT set_config('jco_test.actor','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$
BEGIN
 PERFORM public.delete_unlinked_deal(
  '22222222-2222-4222-8222-222222222222','d4444444-4444-4444-8444-444444444444');
 RAISE EXCEPTION 'UNSAFE: admin deleted other tenant';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- Even if authenticated can update a deal, other-agency contact/property IDs
-- cannot be associated through direct API writes.
DO $$
BEGIN
  BEGIN
    UPDATE public.deals
    SET contact_id='e4444444-4444-4444-8444-444444444444'
    WHERE id='d1111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'UNSAFE: cross-organization contact assigned';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.deals
    SET property_id='f4444444-4444-4444-8444-444444444444'
    WHERE id='d1111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'UNSAFE: cross-organization property assigned';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- Existing activities, commissions and completed sales must be retained.
DO $$
DECLARE deal_id uuid;
BEGIN
 FOREACH deal_id IN ARRAY ARRAY[
   'd2222222-2222-4222-8222-222222222222'::uuid,
   'd3333333-3333-4333-8333-333333333333'::uuid,
   'd5555555-5555-4555-8555-555555555555'::uuid
 ] LOOP
  BEGIN
   PERFORM public.delete_unlinked_deal(
    '11111111-1111-4111-8111-111111111111',deal_id);
   RAISE EXCEPTION 'UNSAFE: deleted dependent or closed deal %',deal_id;
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
 END LOOP;
END $$;

DO $$
BEGIN
 IF public.delete_unlinked_deal(
  '11111111-1111-4111-8111-111111111111',
  'd9999999-9999-4999-8999-999999999999'
 ) THEN RAISE EXCEPTION 'Missing deal was deleted'; END IF;

 IF NOT public.delete_unlinked_deal(
  '11111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111'
 ) THEN RAISE EXCEPTION 'Authorized admin could not delete unlinked open deal'; END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.deals WHERE id='d1111111-1111-4111-8111-111111111111') OR
    (SELECT count(*) FROM public.deals)<>4 OR
    (SELECT count(*) FROM public.activities)<>1 OR
    (SELECT count(*) FROM public.commissions)<>1 THEN
   RAISE EXCEPTION 'Deal deletion affected other rows';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.audit_log
   WHERE entity_id='d1111111-1111-4111-8111-111111111111'
     AND action='deals.delete'
     AND actor_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     AND metadata->>'operation_type'='RENT'
 ) THEN
   RAISE EXCEPTION 'Admin deletion missing audit record';
 END IF;
END $$;
ROLLBACK;
