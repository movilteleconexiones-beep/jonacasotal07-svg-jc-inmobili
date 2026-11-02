-- DO NOT USE IN PRODUCTION. Disposable PostgreSQL fixture only.
-- A consent must reference the exact lead + contact within its own agency.
DO $tenant_fk_test$
DECLARE
  alpha uuid := '00000000-0000-4000-8000-000000000001';
  beta uuid := '00000000-0000-4000-8000-000000000002';
  alpha_lead uuid;
  alpha_contact uuid;
  alpha_other_contact uuid;
  beta_lead uuid;
  beta_contact uuid;
  n_before bigint;
  denied boolean;
BEGIN
  SELECT l.id,l.contact_id INTO alpha_lead,alpha_contact
    FROM public.leads l WHERE l.organization_id=alpha LIMIT 1;
  SELECT l.id,l.contact_id INTO beta_lead,beta_contact
    FROM public.leads l WHERE l.organization_id=beta LIMIT 1;
  SELECT c.id INTO alpha_other_contact
    FROM public.contacts c WHERE c.organization_id=alpha AND c.id<>alpha_contact LIMIT 1;
  IF alpha_lead IS NULL OR beta_lead IS NULL OR alpha_other_contact IS NULL THEN
    RAISE EXCEPTION 'Fixture missing synthetic contacts/leads for FK test';
  END IF;
  SELECT count(*) INTO n_before FROM private.website_lead_consents;

  -- A record from beta cannot be written with alpha ownership.
  denied:=false;
  BEGIN
    INSERT INTO private.website_lead_consents
      (lead_id,organization_id,contact_id,request_id,payload_sha256,policy_url)
    VALUES(beta_lead,alpha,beta_contact,
      '88888888-0000-4000-8000-000000000001',
      pg_catalog.decode(pg_catalog.repeat('ab',32),'hex'),
      'https://example.test/privacidad');
  EXCEPTION WHEN foreign_key_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant lead consent unexpectedly accepted'; END IF;

  -- A beta customer cannot be inserted as the alpha lead customer.
  denied:=false;
  BEGIN
    INSERT INTO private.website_lead_consents
      (lead_id,organization_id,contact_id,request_id,payload_sha256,policy_url)
    VALUES(alpha_lead,alpha,beta_contact,
      '88888888-0000-4000-8000-000000000002',
      pg_catalog.decode(pg_catalog.repeat('bc',32),'hex'),
      'https://example.test/privacidad');
  EXCEPTION WHEN foreign_key_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant contact consent unexpectedly accepted'; END IF;

  -- Even inside the same tenant, a lead cannot receive another person's consent.
  denied:=false;
  BEGIN
    INSERT INTO private.website_lead_consents
      (lead_id,organization_id,contact_id,request_id,payload_sha256,policy_url)
    VALUES(alpha_lead,alpha,alpha_other_contact,
      '88888888-0000-4000-8000-000000000003',
      pg_catalog.decode(pg_catalog.repeat('cd',32),'hex'),
      'https://example.test/privacidad');
  EXCEPTION WHEN foreign_key_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Consent matched a different contact from the same agency'; END IF;

  IF (SELECT count(*) FROM private.website_lead_consents) <> n_before
     OR EXISTS (SELECT 1 FROM private.website_lead_consents receipt
       JOIN public.leads lead ON lead.id=receipt.lead_id
       JOIN public.contacts contact ON contact.id=receipt.contact_id
       WHERE receipt.organization_id <> lead.organization_id
          OR receipt.organization_id <> contact.organization_id
          OR lead.contact_id <> contact.id)
  THEN
    RAISE EXCEPTION 'Rejected consent modified evidence or existing receipts are inconsistent';
  END IF;

  IF NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_constraint co
     JOIN pg_catalog.pg_class cl ON cl.oid=co.conrelid
     JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace
     WHERE n.nspname='private' AND cl.relname='website_lead_consents'
       AND co.conname='website_lead_consents_tenant_lead_fk'
       AND co.contype='f'
  ) THEN RAISE EXCEPTION 'Exact lead-consent composite FK missing'; END IF;
END $tenant_fk_test$;
SELECT 'PASS: tenant and exact-lead contact cannot be mismatched in consent evidence' AS result;
