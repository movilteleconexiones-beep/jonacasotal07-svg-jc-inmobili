-- Run ONLY in CI's disposable PostgreSQL 17 database, after the candidate.
-- Every identity and UUID below is synthetic. Never run on production.
DO $idempotency$
DECLARE
  alpha uuid := '00000000-0000-4000-8000-000000000001';
  beta uuid := '00000000-0000-4000-8000-000000000002';
  request_one uuid := '99999999-0000-4000-8000-000000000001';
  request_two uuid := '99999999-0000-4000-8000-000000000002';
  request_anon uuid := '99999999-0000-4000-8000-000000000003';
  contact_before bigint;
  lead_before bigint;
  receipts_before bigint;
  blocked boolean;
BEGIN
  IF NOT has_function_privilege('anon',
    'public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)',
    'EXECUTE')
  THEN RAISE EXCEPTION 'Anonymous API must call the idempotent intake RPC'; END IF;

  SELECT count(*) INTO contact_before FROM public.contacts WHERE organization_id=alpha;
  SELECT count(*) INTO lead_before FROM public.leads WHERE organization_id=alpha;
  SELECT count(*) INTO receipts_before FROM private.website_lead_consents WHERE organization_id=alpha;

  PERFORM public.submit_public_website_lead_once('alpha-agency','Cliente Reintento',
    'replay@example.test','+57 300 123 4567','Ventas','Mismo mensaje',true,'',request_one);
  -- Simulate lost response: same UUID and payload, repeated twice.
  PERFORM public.submit_public_website_lead_once('alpha-agency','Cliente Reintento',
    'replay@example.test','+57 300 123 4567','Ventas','Mismo mensaje',true,'',request_one);
  PERFORM public.submit_public_website_lead_once('alpha-agency','Cliente Reintento',
    'REPLAY@example.test','+57 300 123 4567','Ventas','Mismo mensaje',true,'',request_one);

  IF (SELECT count(*) FROM public.contacts WHERE organization_id=alpha)<>contact_before+1
   OR (SELECT count(*) FROM public.leads WHERE organization_id=alpha)<>lead_before+1
   OR (SELECT count(*) FROM private.website_lead_consents WHERE organization_id=alpha)<>receipts_before+1
   OR (SELECT count(*) FROM private.website_lead_consents
       WHERE organization_id=alpha AND request_id=request_one)<>1
  THEN RAISE EXCEPTION 'Idempotent retry created a second contact/lead/consent'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead_once('alpha-agency','Cliente Reintento',
      'replay@example.test','+57 300 123 4567','Ventas','Mensaje cambiado',true,'',request_one);
  EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true; END;
  IF NOT blocked OR (SELECT count(*) FROM public.leads WHERE organization_id=alpha)<>lead_before+1
  THEN RAISE EXCEPTION 'Same request UUID accepted a different form payload'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead_once('alpha-agency','Cliente Reintento',
      'replay@example.test','+57 300 123 4567','Ventas','Mismo mensaje',false,'',request_one);
  EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Replay bypassed mandatory consent'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead_once('alpha-agency','Cliente Reintento',
      'replay@example.test','+57 300 123 4567','Ventas','Mismo mensaje',true,'',NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Null idempotency key was accepted'; END IF;

  -- A deliberate new inquiry, even with identical fields, requires a new UUID.
  PERFORM public.submit_public_website_lead_once('alpha-agency','Cliente Reintento',
    'replay@example.test','+57 300 123 4567','Ventas','Mismo mensaje',true,'',request_two);
  IF (SELECT count(*) FROM public.contacts WHERE organization_id=alpha)<>contact_before+1
     OR (SELECT count(*) FROM public.leads WHERE organization_id=alpha)<>lead_before+2
     OR (SELECT count(*) FROM private.website_lead_consents WHERE organization_id=alpha)<>receipts_before+2
  THEN RAISE EXCEPTION 'A new request UUID must create a separate valid opportunity'; END IF;

  -- Same request UUID is independent across organizations.
  PERFORM public.submit_public_website_lead_once('bravo-agency','Cliente Reintento',
    'replay@example.test','+57 300 123 4567','Ventas','Mismo mensaje',true,'',request_one);
  IF (SELECT count(*) FROM private.website_lead_consents
      WHERE organization_id=beta AND request_id=request_one)<>1
  THEN RAISE EXCEPTION 'One organization suppressed a distinct tenant request'; END IF;

  -- The stored fingerprint contains only 32-byte SHA-256 digests.
  IF EXISTS (SELECT 1 FROM private.website_lead_consents
     WHERE pg_catalog.octet_length(payload_sha256)<>32)
  THEN RAISE EXCEPTION 'Stored request fingerprint is malformed'; END IF;

  -- Public roles still have no read access to event-level receipts.
  IF has_table_privilege('anon','private.website_lead_consents','SELECT')
    OR has_table_privilege('authenticated','private.website_lead_consents','SELECT')
  THEN RAISE EXCEPTION 'Idempotency evidence exposed to API roles'; END IF;
END $idempotency$;

SET ROLE anon;
SELECT public.submit_public_website_lead_once('bravo-agency','Solicitud Anónima',
  'anon-replay@example.test','+57 300 123 4567','Consulta','Un mensaje',true,'',
  '99999999-0000-4000-8000-000000000003'::uuid) AS accepted;
SELECT public.submit_public_website_lead_once('bravo-agency','Solicitud Anónima',
  'anon-replay@example.test','+57 300 123 4567','Consulta','Un mensaje',true,'',
  '99999999-0000-4000-8000-000000000003'::uuid) AS retry_accepted;
RESET ROLE;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id
    WHERE c.email='anon-replay@example.test')<>1 THEN
    RAISE EXCEPTION 'Anonymous replay created duplicate lead';
  END IF;
END $verify$;

SELECT 'PASS: repeated UUID single-flight, conflict protection, tenant scoping and anonymous RPC' AS result;
