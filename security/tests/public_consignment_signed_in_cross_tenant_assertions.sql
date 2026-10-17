\set ON_ERROR_STOP on

-- Public intake follows the visited, enabled agency, never the visitor's
-- private tenant. Run after the existing consignment and portal RLS fixtures.
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;

DO $jco_cross_tenant$
DECLARE
  a_receipt jsonb;
  b_receipt jsonb;
  shared_request_id uuid := 'f0000000-0000-4000-8000-000000000185';
BEGIN
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-a')->>'company_name'='Tenant A',
    'public branding must follow A even while authenticated as B');

  a_receipt := public.submit_property_consignment(
    'tenant-a', shared_request_id,
    public.consignment_test_payload() || jsonb_build_object('owner_phone','3151234001'));
  b_receipt := public.submit_property_consignment(
    'tenant-b', shared_request_id,
    public.consignment_test_payload() || jsonb_build_object('owner_phone','3151234002'));

  PERFORM public.consignment_test_assert(
    a_receipt ? 'reference' AND b_receipt ? 'reference'
    AND a_receipt->>'reference' <> b_receipt->>'reference',
    'same request UUID in two public sites must produce independent receipts');

  PERFORM public.consignment_test_assert(
    (SELECT count(*)=1 FROM public.property_consignments
     WHERE request_id=shared_request_id
       AND organization_id='22222222-2222-2222-2222-222222222222'),
    'B session sees only the consignment submitted to B');

  PERFORM public.consignment_test_assert(
    a_receipt=public.submit_property_consignment(
      'tenant-a', shared_request_id,
      public.consignment_test_payload() || jsonb_build_object('owner_phone','3151234001')),
    'retry to A remains idempotent even from B session');
END $jco_cross_tenant$;
RESET ROLE;

SELECT public.consignment_test_assert(
  (SELECT count(*)=2 FROM public.property_consignments
   WHERE request_id='f0000000-0000-4000-8000-000000000185'),
  'two separate tenant-scoped submissions are persisted');
SELECT public.consignment_test_assert(
  (SELECT count(DISTINCT organization_id)=2 FROM public.property_consignments
   WHERE request_id='f0000000-0000-4000-8000-000000000185'),
  'B visitor cannot redirect A public intake to B');
SELECT public.consignment_test_assert(
  (SELECT count(*)=1 FROM public.property_consignments
   WHERE request_id='f0000000-0000-4000-8000-000000000185'
     AND organization_id='11111111-1111-1111-1111-111111111111'
     AND contact_phone='3151234001'),
  'A receives only its targeted contact');

SELECT 'Signed-in public consignment tenant boundary passed' AS result;
