DO $assert$
DECLARE
  blocked boolean;
  a uuid := '00000000-0000-4000-8000-000000000001';
  b uuid := '00000000-0000-4000-8000-000000000002';
BEGIN
  IF NOT has_function_privilege('anon','public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)','EXECUTE')
    OR has_table_privilege('anon','public.contacts','INSERT')
    OR has_table_privilege('anon','public.leads','INSERT')
    OR has_table_privilege('anon','public.contacts','SELECT') THEN
    RAISE EXCEPTION 'Public intake ACL does not enforce function-only access';
  END IF;
  PERFORM public.submit_public_website_lead('alpha-agency','Ana Prueba','ana@example.test',
    '+57 300 123 4567','Administración','Consulta de prueba',true,'');
  PERFORM public.submit_public_website_lead('bravo-agency','Bruno Prueba','bruno@example.test',
    '+57 300 123 4568','Ventas','Consulta de prueba',true,'');
  IF (SELECT count(*) FROM private.website_contact_consents)<>2
    OR (SELECT count(*) FROM private.website_contact_consents
        WHERE policy_url='https://example.test/privacidad' AND consent_method='PUBLIC_FORM_CHECKBOX'
          AND consented_at IS NOT NULL)<>2
    OR EXISTS (
      SELECT 1 FROM private.website_contact_consents receipt
      JOIN public.contacts c ON c.id=receipt.contact_id
      WHERE c.organization_id<>receipt.organization_id
    )
    OR has_table_privilege('anon','private.website_contact_consents','SELECT')
    OR has_table_privilege('authenticated','private.website_contact_consents','SELECT')
  THEN RAISE EXCEPTION 'Consent proof must be tenant scoped and invisible through the Data API'; END IF;

  IF (SELECT count(*) FROM public.leads WHERE organization_id=a)<>1 OR
     (SELECT count(*) FROM public.leads WHERE organization_id=b)<>1 OR
     (SELECT count(*) FROM public.contacts WHERE organization_id=a AND source='WEBSITE')<>1 OR
     (SELECT count(*) FROM public.contacts WHERE organization_id=b AND source='WEBSITE')<>1 OR
     EXISTS (SELECT 1 FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id
             WHERE c.organization_id<>l.organization_id) THEN
    RAISE EXCEPTION 'Cross-agency lead isolation or atomic creation failed';
  END IF;

  PERFORM public.submit_public_website_lead('alpha-agency','Spam Prueba','spam@example.test',
    '+57 300 123 4567','Administración','No registrar',true,'bot-filled');
  IF (SELECT count(*) FROM public.contacts WHERE organization_id=a)<>1 THEN
    RAISE EXCEPTION 'Honeypot allowed an unwanted contact';
  END IF;
  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead('disabled-agency','Nombre Prueba','n@example.test',
      '+57 300 123 4567','Consulta','No',true,'');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Disabled public website could receive contacts'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead('policyless-agency','Nombre Prueba','n@example.test',
      '+57 300 123 4567','Consulta','No',true,'');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'An agency without a data policy received a web lead'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead('suspended-agency','Nombre Prueba','n@example.test',
      '+57 300 123 4567','Consulta','No',true,'');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Suspended tenant could receive contacts'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead('alpha-agency','Nombre Prueba','n@example.test',
      '+57 300 123 4567','Consulta','No',false,'');
  EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Lead accepted without consent'; END IF;

  -- An updated policy must not rewrite the policy previously accepted by a visitor.
  UPDATE public.organization_branding SET public_page_content =
    jsonb_set(public_page_content,'{privacyPolicyUrl}','"https://example.test/privacidad-v2"'::jsonb)
    WHERE organization_id=a;
  PERFORM public.submit_public_website_lead('alpha-agency','Ana Prueba','ana@example.test',
    '+57 300 123 4567','Administración','Mensaje 2',true,'');
  PERFORM public.submit_public_website_lead('alpha-agency','Ana Prueba','ana@example.test',
    '+57 300 123 4567','Administración','Mensaje 3',true,'');
  PERFORM public.submit_public_website_lead('alpha-agency','Ana Prueba','ana@example.test',
    '+57 300 123 4567','Administración','Mensaje 4',true,'');
  blocked:=false;
  BEGIN
    PERFORM public.submit_public_website_lead('alpha-agency','Ana Prueba','ana@example.test',
      '+57 300 123 4567','Administración','Mensaje 5',true,'');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN blocked:=true;
  END;
  IF (SELECT count(*) FROM private.website_contact_consents WHERE organization_id=a AND policy_url='https://example.test/privacidad')<>1
     OR (SELECT count(*) FROM private.website_contact_consents WHERE organization_id=a AND policy_url='https://example.test/privacidad-v2')<>3
     OR (SELECT count(*) FROM private.website_contact_consents WHERE organization_id=b AND policy_url='https://example.test/privacidad')<>1
  THEN RAISE EXCEPTION 'Tenant privacy policy history was replaced or cross-linked'; END IF;
  IF NOT blocked OR (SELECT count(*) FROM public.contacts WHERE organization_id=a)<>4
       OR (SELECT count(*) FROM public.leads WHERE organization_id=a)<>4 THEN
    RAISE EXCEPTION 'Per-address throttling or atomic integrity failed';
  END IF;
END $assert$;

-- A rejected consent must not create a private receipt either.
DO $consent_check$
BEGIN
 IF (SELECT count(*) FROM private.website_contact_consents)<>5 THEN
    RAISE EXCEPTION 'The private consent count must exactly match successful CRM contacts';
 END IF;
END $consent_check$;

-- Execute as the actual anonymous API role; only the definer RPC may write.
SET ROLE anon;
SELECT public.submit_public_website_lead('bravo-agency','Visita Anónima','visitante@example.test',
  '+57 300 123 4569','Consulta general','Solicito información',true,'') AS accepted;
RESET ROLE;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.leads
      WHERE organization_id='00000000-0000-4000-8000-000000000002')<>2 THEN
   RAISE EXCEPTION 'Anonymous API caller did not create a scoped lead';
 END IF;
END $verify$;
