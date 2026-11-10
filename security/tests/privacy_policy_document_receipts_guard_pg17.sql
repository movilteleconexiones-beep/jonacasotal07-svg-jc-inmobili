-- Disposable PG17 integration after CRM dedupe and idempotency fixtures.
-- Does not edit any real agency identity or person.
DO $policy$
DECLARE
  bravo uuid := '00000000-0000-4000-8000-000000000002';
  bad_urls text[] := ARRAY[
    'https://www.inmojco.com',
    'https://www.inmojco.com/',
    'https://inmojco.com/#policy',
    'https://www.inmojco.com/?legal=yes',
    'https://www.inmojco.com/app',
    'https://www.inmojco.com/inmobiliaria/bravo-agency',
    'https://www.inmojco.com/politicas/'
  ];
  current_bad text;
  before_contacts bigint;
  before_leads bigint;
  before_receipts bigint;
  blocked boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='website_lead_consents_not_platform_page')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='website_contact_consents_not_platform_page')
  THEN RAISE EXCEPTION 'Expected private receipt guards have not been installed'; END IF;

  SELECT count(*) INTO before_contacts FROM public.contacts WHERE organization_id=bravo;
  SELECT count(*) INTO before_leads FROM public.leads WHERE organization_id=bravo;
  SELECT count(*) INTO before_receipts FROM private.website_lead_consents WHERE organization_id=bravo;

  FOREACH current_bad IN ARRAY bad_urls LOOP
    UPDATE public.organization_branding
    SET public_page_content=pg_catalog.jsonb_set(
      public_page_content, '{privacyPolicyUrl}', pg_catalog.to_jsonb(current_bad))
    WHERE organization_id=bravo;
    blocked:=false;
    BEGIN
      PERFORM public.submit_public_website_lead_once(
        'bravo-agency','Aviso Inexistente','homepage-no-consent@example.test',
        '+57 300 123 4567','Consulta','No crear datos personales',true,'',
        pg_catalog.gen_random_uuid());
    EXCEPTION WHEN check_violation THEN blocked:=true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'Homepage or unrelated route was accepted as legal notice: %',current_bad;
    END IF;
    IF (SELECT count(*) FROM public.contacts WHERE organization_id=bravo)<>before_contacts
      OR (SELECT count(*) FROM public.leads WHERE organization_id=bravo)<>before_leads
      OR (SELECT count(*) FROM private.website_lead_consents WHERE organization_id=bravo)<>before_receipts
    THEN RAISE EXCEPTION 'Unapproved public call left partial CRM data after blocked URL: %',current_bad;
    END IF;
  END LOOP;

  -- A genuine dedicated policy-document path remains usable once approved.
  UPDATE public.organization_branding
  SET public_page_content=pg_catalog.jsonb_set(
    public_page_content,'{privacyPolicyUrl}',
    '"https://www.inmojco.com/politicas/bravo-agency.pdf"'::jsonb)
  WHERE organization_id=bravo;
  PERFORM public.submit_public_website_lead_once(
    'bravo-agency','Aviso Publicado','valid-policy@example.test',
    '+57 300 123 4567','Consulta','Portal autorizado',true,'',
    pg_catalog.gen_random_uuid());
  IF (SELECT count(*) FROM public.contacts WHERE organization_id=bravo)<>before_contacts+1
    OR (SELECT count(*) FROM public.leads WHERE organization_id=bravo)<>before_leads+1
    OR (SELECT count(*) FROM private.website_lead_consents WHERE organization_id=bravo)<>before_receipts+1
    OR NOT EXISTS (SELECT 1 FROM private.website_lead_consents
       WHERE organization_id=bravo
         AND policy_url='https://www.inmojco.com/politicas/bravo-agency.pdf')
  THEN RAISE EXCEPTION 'Valid, scoped policy path was blocked or did not store immutable consent'; END IF;
  IF has_table_privilege('anon','private.website_lead_consents','INSERT')
    OR has_table_privilege('anon','private.website_contact_consents','INSERT')
  THEN RAISE EXCEPTION 'Anonymous role bypasses the protected consent write path'; END IF;
END $policy$;

SELECT 'PASS: invalid platform links roll back CRM writes, dedicated policy URL permits scoped intake' AS result;
