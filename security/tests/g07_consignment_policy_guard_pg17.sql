\set ON_ERROR_STOP on
-- G07 #370: run after fixture + exact REVIEW_ONLY candidate in disposable PG17.
DO $test$
DECLARE
  org_a uuid:='11111111-1111-1111-1111-111111111111';
  org_b uuid:='22222222-2222-2222-2222-222222222222';
  request_a uuid:='10000000-0000-4000-8000-000000000071';
  policy_a text:='https://www.inmojco.com/politicas/agency-a-2026.pdf';
  denied boolean;
  original_reference jsonb;
  attempt jsonb;
  before_count bigint;
  submission_id uuid;
BEGIN
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-a') IS NULL,
    'An enabled site cannot collect without an approved policy');
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-b') IS NULL,
    'Different tenant without an approval remains inaccessible');
  denied:=false;
  BEGIN
    PERFORM public.submit_property_consignment('tenant-a',request_a,public.consignment_test_payload());
  EXCEPTION WHEN no_data_found THEN denied:=true;
  END;
  PERFORM public.consignment_test_assert(denied,'No approval blocks anonymous payload writes');
  PERFORM public.consignment_test_assert(
    (SELECT count(*)=0 FROM public.property_consignments),
    'Blocked intake must leave no PII behind');

  -- Malicious generic homepage cannot be approved just by changing the switch.
  denied:=false;
  BEGIN
    INSERT INTO private.consignment_policy_approvals
      (organization_id,policy_url,policy_version,approved_document_sha256,approval_reference,approved_at)
    VALUES(org_a,'https://www.inmojco.com','v1',repeat('a',64),'QA-LOCAL-APPROVAL',now());
  EXCEPTION WHEN check_violation THEN denied:=true;
  END;
  PERFORM public.consignment_test_assert(denied,'Homepage cannot be an approved policy');

  INSERT INTO private.consignment_policy_approvals
    (organization_id,policy_url,policy_version,approved_document_sha256,approval_reference,approved_at)
  VALUES(org_a,policy_a,'2026-11-v1',repeat('a',64),'QA-LOCAL-APPROVAL-ONLY',now());

  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-a') IS NULL,
    'Even a valid approval is rejected unless the published link matches exactly');
  UPDATE public.organization_branding SET
    public_page_content=jsonb_build_object('privacyPolicyUrl',policy_a)
  WHERE organization_id=org_a;
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-a')->>'policy_url'=policy_a,
    'Approved PDF link must be returned to the public consent form');
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-a')->>'policy_version'='2026-11-v1',
    'Approved policy version must reach the public consent form');
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-b') IS NULL,
    'Tenant B must remain closed with tenant A approved');

  denied:=false;
  BEGIN
    PERFORM public.submit_property_consignment('tenant-a',gen_random_uuid(),
      public.consignment_test_payload()||'{"contact_consent":false}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  PERFORM public.consignment_test_assert(denied,'Explicit consent required on submit');

  original_reference:=public.submit_property_consignment(
    'tenant-a',request_a,public.consignment_test_payload());
  PERFORM public.consignment_test_assert(original_reference ? 'reference',
    'Return reference only and no contact details');

  SELECT c.id INTO submission_id FROM public.property_consignments c
    WHERE c.organization_id=org_a AND c.request_id=request_a;
  PERFORM public.consignment_test_assert(submission_id IS NOT NULL,'Consignment was inserted');
  PERFORM public.consignment_test_assert(
    EXISTS(SELECT 1 FROM private.consignment_policy_receipts receipt
      WHERE receipt.consignment_id=submission_id
        AND receipt.organization_id=org_a
        AND receipt.request_id=request_a
        AND receipt.policy_url=policy_a
        AND receipt.policy_version='2026-11-v1'
        AND octet_length(receipt.payload_sha256)=32),
    'Per-request policy receipt must be transactionally linked and private');
  PERFORM public.consignment_test_assert(
    public.submit_property_consignment('tenant-a',request_a,public.consignment_test_payload())=original_reference,
    'Retry with original request is idempotent');
  PERFORM public.consignment_test_assert(
    (SELECT count(*)=1 FROM public.property_consignments) AND
    (SELECT count(*)=1 FROM private.consignment_policy_receipts),
    'Idempotent retry must not duplicate PII or policy receipts');

  denied:=false;
  BEGIN
    PERFORM public.submit_property_consignment(
      'tenant-a',request_a,public.consignment_test_payload()||'{"price":1234567}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  PERFORM public.consignment_test_assert(denied,'Changed retry payload must be rejected');

  UPDATE private.consignment_policy_approvals SET revoked_at=now()
   WHERE organization_id=org_a;
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-a') IS NULL,
    'Revocation immediately hides site regardless of enabled=true');
  denied:=false;
  BEGIN
    PERFORM public.submit_property_consignment('tenant-a',gen_random_uuid(),
      public.consignment_test_payload());
  EXCEPTION WHEN no_data_found THEN denied:=true;
  END;
  PERFORM public.consignment_test_assert(denied,'Revoked policy blocks new payloads');
  PERFORM public.consignment_test_assert(
    (SELECT count(*)=1 FROM private.consignment_policy_receipts),
    'Revocation retains historical consent evidence');

  -- A mismatched link for the approved tenant must fail closed.
  UPDATE private.consignment_policy_approvals SET revoked_at=NULL
    WHERE organization_id=org_a;
  UPDATE public.organization_branding SET public_page_content =
    jsonb_build_object('privacyPolicyUrl','https://www.inmojco.com')
    WHERE organization_id=org_a;
  PERFORM public.consignment_test_assert(
    public.get_public_property_intake_site('tenant-a') IS NULL,
    'Changing public URL back to homepage must not re-enable intake');
  UPDATE public.organization_branding SET public_page_content =
    jsonb_build_object('privacyPolicyUrl',policy_a)
    WHERE organization_id=org_a;

  PERFORM public.consignment_test_assert(
    NOT has_table_privilege('anon','private.consignment_policy_receipts','SELECT')
    AND NOT has_table_privilege('authenticated','private.consignment_policy_approvals','INSERT')
    AND NOT has_table_privilege('authenticated','private.consignment_policy_receipts','UPDATE'),
    'Private approval and consent receipt ACL');
END $test$;

-- Atomicity test: a failed consent receipt must roll back the submission.
CREATE FUNCTION public.g07_reject_receipt_qa()
RETURNS trigger LANGUAGE plpgsql AS $qa$
BEGIN RAISE EXCEPTION 'receipt_rejected_for_qa' USING ERRCODE='23514'; END;
$qa$;
CREATE TRIGGER g07_reject_receipt_qa
BEFORE INSERT ON private.consignment_policy_receipts
FOR EACH ROW EXECUTE FUNCTION public.g07_reject_receipt_qa();

DO $test$
DECLARE before_rows bigint; denied boolean:=false;
BEGIN
 SELECT count(*) INTO before_rows FROM public.property_consignments;
 BEGIN
   PERFORM public.submit_property_consignment('tenant-a',gen_random_uuid(),
     public.consignment_test_payload());
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 PERFORM public.consignment_test_assert(denied,'Fault-injected receipt insert must fail');
 PERFORM public.consignment_test_assert(
   (SELECT count(*)=before_rows FROM public.property_consignments),
   'Receipt failure must roll back any public consignment/PII insert');
END $test$;
DROP TRIGGER g07_reject_receipt_qa ON private.consignment_policy_receipts;
DROP FUNCTION public.g07_reject_receipt_qa();

SET ROLE anon;
DO $anonymous$
DECLARE got jsonb;
BEGIN
  got:=public.get_public_property_intake_site('tenant-a');
  PERFORM public.consignment_test_assert(
    got->>'policy_version'='2026-11-v1',
    'Anonymous caller sees approved version without internal legal metadata');
  PERFORM public.consignment_test_assert(
    NOT got ? 'approved_document_sha256'
    AND NOT got ? 'approval_reference',
    'Public response must not expose legal/approval metadata');
  BEGIN
    PERFORM 1 FROM public.property_consignments LIMIT 1;
    RAISE EXCEPTION 'Anonymous SELECT of consignments must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $anonymous$;
RESET ROLE;
SELECT 'G07 PASS: legal approval, consent receipt, revocation and atomicity verified' AS result;
