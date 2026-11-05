-- Runs only in disposable PostgreSQL 17 CI after the existing CRM security suite.
-- Never run against production. All contact names and addresses are synthetic.
DO $test$
DECLARE
  alpha uuid := '00000000-0000-4000-8000-000000000001';
  bravo uuid := '00000000-0000-4000-8000-000000000002';
  nora_id uuid;
  original_receipts bigint;
  blocked boolean;
BEGIN
  SELECT count(*) INTO original_receipts FROM private.website_contact_consents;
  IF original_receipts<>6 THEN
    RAISE EXCEPTION 'Fixture expectation: six legacy receipts required, got %',original_receipts;
  END IF;

  -- The original fixture changed alpha's published privacy policy to v2.
  PERFORM public.submit_public_website_lead('alpha-agency','Nora Prueba','nora@example.test',
    '+57 300 123 4567','Ventas','Primera consulta',true,'');
  SELECT id INTO nora_id FROM public.contacts
   WHERE organization_id=alpha AND lower(email)='nora@example.test';
  IF nora_id IS NULL THEN RAISE EXCEPTION 'First contact missing'; END IF;

  PERFORM public.submit_public_website_lead('alpha-agency','Nora Prueba','NORA@example.test',
    '+57 300 123 4567','Administración','Segunda consulta',true,'');
  IF (SELECT count(*) FROM public.contacts WHERE organization_id=alpha
        AND lower(email)='nora@example.test')<>1
     OR (SELECT count(*) FROM public.leads WHERE contact_id=nora_id)<>2
     OR (SELECT count(*) FROM private.website_lead_consents WHERE contact_id=nora_id)<>2
  THEN
    RAISE EXCEPTION 'Repeated valid inquiry must reuse one contact and persist two leads/consents';
  END IF;

  -- A change in published privacy URL must not rewrite prior consent proof.
  UPDATE public.organization_branding
     SET public_page_content=jsonb_set(public_page_content,
       '{privacyPolicyUrl}','"https://example.test/privacidad-v3"'::jsonb)
   WHERE organization_id=alpha;
  PERFORM public.submit_public_website_lead('alpha-agency','Nora Prueba','nora@example.test',
    '+57 300 123 4567','Ventas','Tercera consulta',true,'');
  PERFORM public.submit_public_website_lead('alpha-agency','Nora Prueba','nora@example.test',
    '+57 300 123 4567','Ventas','Cuarta consulta',true,'');

  IF (SELECT count(*) FROM private.website_lead_consents
      WHERE contact_id=nora_id AND policy_url='https://example.test/privacidad-v2')<>2
     OR (SELECT count(*) FROM private.website_lead_consents
      WHERE contact_id=nora_id AND policy_url='https://example.test/privacidad-v3')<>2
  THEN RAISE EXCEPTION 'Event privacy policy URL was lost or altered'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead('alpha-agency','Nora Prueba','nora@example.test',
      '+57 300 123 4567','Ventas','Quinta consulta bloqueada',true,'');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN blocked:=true;
  END;
  IF NOT blocked OR (SELECT count(*) FROM public.leads WHERE contact_id=nora_id)<>4
     OR (SELECT count(*) FROM private.website_lead_consents WHERE contact_id=nora_id)<>4
  THEN
    RAISE EXCEPTION 'Per-address rate limits must count inquiries, not distinct CRM contacts';
  END IF;

  -- Existing manually registered customers are reused without changing their
  -- phone, source or recorded identity; only a fresh lead is added.
  INSERT INTO public.contacts(organization_id,first_name,last_name,email,phone,source)
  VALUES(alpha,'Laura','Manual','laura.manual@example.test','3001111111','MANUAL');
  PERFORM public.submit_public_website_lead('alpha-agency','Laura Manual','laura.manual@example.test',
    '+57 300 123 4567','Administración','Consulta desde la web',true,'');
  IF (SELECT count(*) FROM public.contacts
      WHERE organization_id=alpha AND email='laura.manual@example.test')<>1
     OR (SELECT count(*) FROM public.contacts
      WHERE organization_id=alpha AND email='laura.manual@example.test'
        AND source='MANUAL' AND phone='3001111111')<>1
     OR (SELECT count(*) FROM private.website_lead_consents event
      JOIN public.contacts c ON c.id=event.contact_id
      WHERE c.email='laura.manual@example.test' AND event.organization_id=alpha)<>1
  THEN RAISE EXCEPTION 'Existing manual client was duplicated or overwritten'; END IF;

  -- A shared email with a different full name does not merge individuals.
  PERFORM public.submit_public_website_lead('alpha-agency','Ana Compartida','shared@example.test',
    '+57 300 123 4567','Consulta','Primera persona',true,'');
  PERFORM public.submit_public_website_lead('alpha-agency','Luis Compartido','shared@example.test',
    '+57 300 123 4567','Consulta','Otra persona',true,'');
  IF (SELECT count(*) FROM public.contacts WHERE organization_id=alpha AND email='shared@example.test')<>2
  THEN RAISE EXCEPTION 'Shared mailbox merged distinct named customers'; END IF;

  -- Two different tenants can independently have the same name and email.
  PERFORM public.submit_public_website_lead('bravo-agency','Nora Prueba','nora@example.test',
    '+57 300 123 4567','Consulta','Otra inmobiliaria',true,'');
  IF (SELECT count(*) FROM public.contacts WHERE organization_id=bravo AND email='nora@example.test')<>1
     OR EXISTS (
       SELECT 1 FROM private.website_lead_consents receipt
         JOIN public.leads l ON l.id=receipt.lead_id
         JOIN public.contacts c ON c.id=receipt.contact_id
       WHERE receipt.organization_id<>l.organization_id
          OR l.organization_id<>c.organization_id
     )
  THEN RAISE EXCEPTION 'Lead/consent crossed agency boundary'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead('alpha-agency','Sin Consentimiento','no@example.test',
      '+57 300 123 4567','Consulta','No registrar',false,'');
  EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true;
  END;
  IF NOT blocked OR EXISTS (
    SELECT 1 FROM public.contacts WHERE organization_id=alpha AND email='no@example.test'
  ) THEN RAISE EXCEPTION 'Consent is mandatory before contact creation'; END IF;

  -- Legacy historical receipts must remain unmodified by the new workflow.
  IF (SELECT count(*) FROM private.website_contact_consents)<>original_receipts
  THEN RAISE EXCEPTION 'Legacy consent proofs were modified'; END IF;

  IF has_table_privilege('anon','private.website_lead_consents','SELECT')
     OR has_table_privilege('authenticated','private.website_lead_consents','SELECT')
     OR has_table_privilege('anon','public.contacts','INSERT')
     OR has_table_privilege('anon','public.leads','INSERT')
  THEN RAISE EXCEPTION 'Private consents or direct CRM writes are exposed to public roles'; END IF;
END $test$;

-- A public anonymous caller must still be allowed to submit the protected RPC.
SET ROLE anon;
SELECT public.submit_public_website_lead('bravo-agency','Visitante Nuevo','visitante2@example.test',
  '+57 300 123 4569','Consulta general','Registro aislado',true,'') AS accepted;
RESET ROLE;

-- Force a failure after a new contact and lead are inserted:
-- whole RPC must roll back all three writes, leaving no orphan personal data.
ALTER TABLE private.website_lead_consents
  ADD CONSTRAINT website_lead_consents_test_reject CHECK (
    policy_url <> 'https://example.test/privacidad-v3'
  ) NOT VALID;
DO $rollback_test$
DECLARE blocked boolean:=false;
BEGIN
  BEGIN
    PERFORM public.submit_public_website_lead('alpha-agency','Error Simulado','rollback@example.test',
      '+57 300 123 4567','Consulta','Provocar rollback',true,'');
  EXCEPTION WHEN check_violation THEN blocked:=true;
  END;
  IF NOT blocked OR EXISTS(
    SELECT 1 FROM public.contacts WHERE email='rollback@example.test'
  ) OR EXISTS (
    SELECT 1 FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id
      WHERE c.email='rollback@example.test'
  ) THEN
    RAISE EXCEPTION 'A failed consent INSERT must roll back contact and lead together';
  END IF;
END $rollback_test$;
ALTER TABLE private.website_lead_consents
  DROP CONSTRAINT website_lead_consents_test_reject;

-- Accepted evidence cannot be edited or deleted, even via the table owner.
-- Use fictional rows in the throwaway PG17 CI database only.
DO $immutable$
DECLARE
  target_lead uuid;
  original_url text;
  original_count bigint;
  update_rejected boolean := false;
  delete_rejected boolean := false;
BEGIN
  SELECT lead_id, policy_url INTO target_lead, original_url
    FROM private.website_lead_consents ORDER BY consented_at, lead_id LIMIT 1;
  IF target_lead IS NULL THEN RAISE EXCEPTION 'Missing synthetic consent for immutable check'; END IF;
  SELECT count(*) INTO original_count FROM private.website_lead_consents;
  BEGIN
    UPDATE private.website_lead_consents SET policy_url='https://example.test/rewritten'
      WHERE lead_id=target_lead;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN update_rejected:=true;
  END;
  BEGIN
    DELETE FROM private.website_lead_consents WHERE lead_id=target_lead;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN delete_rejected:=true;
  END;
  IF NOT update_rejected OR NOT delete_rejected OR
     (SELECT count(*) FROM private.website_lead_consents)<>original_count OR
     (SELECT policy_url FROM private.website_lead_consents WHERE lead_id=target_lead)
        IS DISTINCT FROM original_url
  THEN
    RAISE EXCEPTION 'Accepted per-inquiry consent is not immutable';
  END IF;
END $immutable$;

SELECT 'PASS: tenant-scoped contact reuse, per-inquiry private consent, spam bounds and rollback' AS result;
