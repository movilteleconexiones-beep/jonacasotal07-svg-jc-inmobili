-- Dedicated isolated PostgreSQL fixture. Do not run against production.
-- Run after rent_entry_fixture and the core 20261012 financial migrations.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner_id text,
  metadata jsonb,
  UNIQUE(bucket_id,name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;

\i supabase/migrations/20261014082000_private_rent_receipt_supports.sql

CREATE FUNCTION pg_temp.must_fail_evidence(sql text,expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN
  EXECUTE sql;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE;
 END;
 IF actual IS DISTINCT FROM expected_state THEN
   RAISE EXCEPTION 'Expected %, received % for %',
     expected_state,coalesce(actual,'SUCCESS'),sql;
 END IF;
END;
$$;

SELECT set_config('jco_test.organization','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('jco_test.actor','99999999-9999-4999-8999-999999999999',false);
SET ROLE authenticated;

SELECT public.create_tenant_rent_period(
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2026-10-01') AS payment_id \gset
SELECT set_config('jco_test.evidence_payment',:'payment_id',false);
SELECT set_config('jco_test.evidence_key','88888888-8888-4888-8888-888888888888',false);
SELECT set_config('jco_test.evidence_path',
 '11111111-1111-4111-8111-111111111111/'||
 current_setting('jco_test.evidence_payment')||'/'||
 '99999999-9999-4999-8999-999999999999/'||
 current_setting('jco_test.evidence_key')||'/comprobante.pdf',false);

-- A different user cannot upload private proof using this actor's folder.
SELECT set_config('jco_test.actor','88888888-8888-4888-8888-888888888887',false);
SELECT pg_temp.must_fail_evidence($$
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 VALUES ('jco-rent-receipts-private',current_setting('jco_test.evidence_path'),
  current_setting('jco_test.actor'),
  '{"size":1234,"mimetype":"application/pdf"}'::jsonb)
$$,'42501');
SELECT set_config('jco_test.actor','99999999-9999-4999-8999-999999999999',false);

-- Malicious cross-tenant upload path is denied by storage policy.
SELECT pg_temp.must_fail_evidence($$
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 VALUES ('jco-rent-receipts-private',
  '22222222-2222-4222-8222-222222222222/'||
  current_setting('jco_test.evidence_payment')||'/'||
  current_setting('jco_test.actor')||'/'||
  current_setting('jco_test.evidence_key')||'/comprobante.pdf',
  current_setting('jco_test.actor'),
  '{"size":1234,"mimetype":"application/pdf"}'::jsonb)
$$,'42501');

-- Missing proof, invalid extension and another actor's path cannot register money.
SELECT pg_temp.must_fail_evidence($$
 SELECT public.record_tenant_rent_receipt_with_evidence(
  '11111111-1111-4111-8111-111111111111',
  current_setting('jco_test.evidence_payment')::uuid,
  150000,'BANK_TRANSFER','TR-ABONO-001',
  current_setting('jco_test.evidence_key')::uuid,
  current_setting('jco_test.evidence_path'))
$$,'23514');
SELECT pg_temp.must_fail_evidence($$
 SELECT public.record_tenant_rent_receipt_with_evidence(
  '11111111-1111-4111-8111-111111111111',
  current_setting('jco_test.evidence_payment')::uuid,
  150000,'BANK_TRANSFER','TR-ABONO-001',
  current_setting('jco_test.evidence_key')::uuid,
  replace(current_setting('jco_test.evidence_path'),'.pdf','.html'))
$$,'22023');
SELECT pg_temp.must_fail_evidence($$
 SELECT public.record_tenant_rent_receipt_with_evidence(
  '11111111-1111-4111-8111-111111111111',
  current_setting('jco_test.evidence_payment')::uuid,
  150000,'BANK_TRANSFER','TR-ABONO-001',
  current_setting('jco_test.evidence_key')::uuid,
  replace(current_setting('jco_test.evidence_path'),
    '/99999999-9999-4999-8999-999999999999/',
    '/88888888-8888-4888-8888-888888888887/'))
$$,'42501');

DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM public.rent_receipts)
 OR EXISTS(SELECT 1 FROM public.rent_payments
   WHERE id=current_setting('jco_test.evidence_payment')::uuid AND paid_amount<>0)
 THEN RAISE EXCEPTION 'Rejected evidence should never credit a receipt'; END IF;
END
$check$;

INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
VALUES ('jco-rent-receipts-private',current_setting('jco_test.evidence_path'),
 current_setting('jco_test.actor'),
 '{"size":1234,"mimetype":"application/pdf"}'::jsonb);

SELECT public.record_tenant_rent_receipt_with_evidence(
 '11111111-1111-4111-8111-111111111111',
 current_setting('jco_test.evidence_payment')::uuid,
 150000,'BANK_TRANSFER','TR-ABONO-001',
 current_setting('jco_test.evidence_key')::uuid,
 current_setting('jco_test.evidence_path')) AS evidence_receipt_id \gset
SELECT set_config('jco_test.evidence_receipt',:'evidence_receipt_id',false);

SELECT public.record_tenant_rent_receipt_with_evidence(
 '11111111-1111-4111-8111-111111111111',
 current_setting('jco_test.evidence_payment')::uuid,
 150000,'BANK_TRANSFER','TR-ABONO-001',
 current_setting('jco_test.evidence_key')::uuid,
 current_setting('jco_test.evidence_path')) AS evidence_retry_id \gset
SELECT set_config('jco_test.evidence_retry',:'evidence_retry_id',false);

DO $check$
BEGIN
 IF current_setting('jco_test.evidence_receipt')<>current_setting('jco_test.evidence_retry') THEN
   RAISE EXCEPTION 'Evidence retry created another receipt';
 END IF;
 IF (SELECT count(*) FROM public.rent_receipts)<>1
  OR (SELECT count(*) FROM public.rent_receipt_supports)<>1
  OR NOT EXISTS(SELECT 1 FROM public.rent_receipt_supports
    WHERE receipt_id=current_setting('jco_test.evidence_receipt')::uuid
     AND storage_path=current_setting('jco_test.evidence_path'))
  OR NOT EXISTS(SELECT 1 FROM public.rent_payments
    WHERE id=current_setting('jco_test.evidence_payment')::uuid AND paid_amount=150000)
 THEN RAISE EXCEPTION 'Evidence and money were not saved atomically'; END IF;
END
$check$;

-- New proof under the same idempotency key must be rejected.
SELECT pg_temp.must_fail_evidence($$
 SELECT public.record_tenant_rent_receipt_with_evidence(
  '11111111-1111-4111-8111-111111111111',
  current_setting('jco_test.evidence_payment')::uuid,
  150000,'BANK_TRANSFER','TR-ABONO-001',
  current_setting('jco_test.evidence_key')::uuid,
  replace(current_setting('jco_test.evidence_path'),'comprobante.pdf','comprobante.jpg'))
$$,'23514');

-- Linked evidence is immutable and cannot be removed by the uploader.
SELECT pg_temp.must_fail_evidence($$
 UPDATE public.rent_receipt_supports SET storage_path='tampered'
 WHERE receipt_id=current_setting('jco_test.evidence_receipt')::uuid
$$,'42501');
DELETE FROM storage.objects WHERE bucket_id='jco-rent-receipts-private'
  AND name=current_setting('jco_test.evidence_path');
DO $check$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.objects
   WHERE bucket_id='jco-rent-receipts-private'
     AND name=current_setting('jco_test.evidence_path'))
 THEN RAISE EXCEPTION 'Linked proof was deleted'; END IF;
END
$check$;

-- Reader permission is a separate gate from payment entry.
SELECT set_config('jco_test.denied_permission','rent_payments.view',false);
DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM public.rent_receipt_supports) THEN
   RAISE EXCEPTION 'Private proof leaked without finance view permission';
 END IF;
END
$check$;
SELECT set_config('jco_test.denied_permission','',false);
RESET ROLE;
