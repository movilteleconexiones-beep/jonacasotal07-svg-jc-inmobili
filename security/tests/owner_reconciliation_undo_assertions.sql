-- This entire test database is isolated from Supabase production.
SELECT set_config('jco_test.organization','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('jco_test.actor','10101010-1010-4010-8010-101010101010',false);
SET ROLE authenticated;

DO $test$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.revert_owner_draft_reconciliation(
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-0000-4000-8000-000000000001',
      'Reject unsupported legacy reversal'
    );
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Legacy reconciliation without history was reverted'; END IF;
END
$test$;

DO $test$
DECLARE net numeric;
BEGIN
  net:=public.reconcile_owner_draft_statement_audited(
    '11111111-1111-4111-8111-111111111111',
    'cccccccc-0000-4000-8000-000000000001');
  IF net<>1290000 THEN RAISE EXCEPTION 'Wrong recalculated owner net %',net; END IF;
END
$test$;

DO $test$
DECLARE net numeric;
BEGIN
  net:=public.revert_owner_draft_reconciliation(
    '11111111-1111-4111-8111-111111111111',
    'cccccccc-0000-4000-8000-000000000001',
    'The deduction was entered for a different billing period');
  IF net<>1310000 THEN RAISE EXCEPTION 'Previous draft value not restored'; END IF;
END
$test$;

DO $test$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.revert_owner_draft_reconciliation(
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-0000-4000-8000-000000000001',
      'Prevent repeating reversal twice'
    );
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Undo was accepted twice'; END IF;
END
$test$;

SELECT public.reconcile_owner_draft_statement_audited(
  '11111111-1111-4111-8111-111111111111',
  'cccccccc-0000-4000-8000-000000000001');

-- The agent is a tenant member but is not an ADMIN. Undo is prohibited.
SELECT set_config('jco_test.actor','20202020-2020-4020-8020-202020202020',false);
DO $test$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.revert_owner_draft_reconciliation(
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-0000-4000-8000-000000000001',
      'Agent attempted unauthorized owner reversal'
    );
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Agent was able to revert'; END IF;
END
$test$;

SELECT set_config('jco_test.actor','10101010-1010-4010-8010-101010101010',false);
DO $test$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.revert_owner_draft_reconciliation(
      '22222222-2222-4222-8222-222222222222',
      'cccccccc-0000-4000-8000-000000000002',
      'Cross tenant reversal must be refused'
    );
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-org reversal succeeded'; END IF;
END
$test$;

-- The approved deduction changes while statement stays a draft. Its
-- underlying source fingerprint changes and undo must fail closed.
UPDATE public.owner_statement_deductions
  SET status='VOIDED',void_reason='Corrected invoice assignment'
  WHERE statement_id='cccccccc-0000-4000-8000-000000000001'
    AND status='APPROVED';
DO $test$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.revert_owner_draft_reconciliation(
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-0000-4000-8000-000000000001',
      'The underlying deduction changed and the undo must not proceed'
    );
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale reconciliation was reverted'; END IF;
END
$test$;
SELECT public.reconcile_owner_draft_statement_audited(
 '11111111-1111-4111-8111-111111111111',
 'cccccccc-0000-4000-8000-000000000001');

-- Never undo generated or paid owner statements.
RESET ROLE;
UPDATE public.owner_statements SET status='GENERATED'
 WHERE id='cccccccc-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $test$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.revert_owner_draft_reconciliation(
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-0000-4000-8000-000000000001',
      'Generated owner statement must remain immutable'
    );
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Generated owner statement reverted'; END IF;
END
$test$;
RESET ROLE;

DO $audit$
DECLARE
  n integer;
  snapshot jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.audit_log
   WHERE entity_id='cccccccc-0000-4000-8000-000000000001'
     AND action='owner_statement.reconciled';
  IF n<>3 THEN RAISE EXCEPTION 'Expected 3 audit revisions, found %',n; END IF;
  SELECT count(*) INTO n FROM public.audit_log
   WHERE entity_id='cccccccc-0000-4000-8000-000000000001'
     AND action='owner_statement.reverted';
  IF n<>1 THEN RAISE EXCEPTION 'Expected 1 undo audit, found %',n; END IF;
  IF (SELECT count(*) FROM public.owner_statement_deductions)<>1 OR
     (SELECT count(*) FROM public.rent_payments)<>1 THEN
    RAISE EXCEPTION 'Undo deleted a payment or deduction record'; END IF;
  SELECT metadata INTO snapshot FROM public.audit_log
    WHERE action='owner_statement.reverted' LIMIT 1;
  IF snapshot->>'reason' IS NULL OR snapshot->>'reversed_event' IS NULL THEN
    RAISE EXCEPTION 'Missing audit reason or reversed event link'; END IF;
END
$audit$;
SELECT 'PASS: audited recalculation, draft-only admin reversal, source hash, tenant isolation and immutable receipts' AS result;
