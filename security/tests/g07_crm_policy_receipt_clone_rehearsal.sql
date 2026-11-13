-- G07 QA ONLY: concatenate AFTER approved policy candidate DDL,
-- replacing the candidate's terminating COMMIT with this file.
-- The single SQL session MUST remain in BEGIN and end in ROLLBACK.
-- Never execute on production or on the SuperAdmin agency.
DO $qa$
DECLARE
 v_org uuid;v_foreign uuid;v_contact uuid;v_lead uuid;
 v_version text;v_hash text;
 v_url constant text:='https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf';
BEGIN
 SELECT o.id INTO v_org FROM public.organizations o JOIN public.organization_billing_access b
 ON b.organization_id=o.id AND b.is_test WHERE o.slug='sistema-inmobiliario-jco';
 SELECT o.id INTO v_foreign FROM public.organizations o JOIN public.organization_billing_access b
 ON b.organization_id=o.id AND b.is_test WHERE o.slug='qa-finance-96-foreign-20261113';
 IF v_org IS NULL OR v_foreign IS NULL OR v_org=v_foreign OR
 EXISTS(SELECT 1 FROM private.consignment_policy_approvals WHERE organization_id IN(v_org,v_foreign))
 THEN RAISE EXCEPTION 'G07 QA requires two isolated tenants and no pre-existing approval'; END IF;

 BEGIN
  INSERT INTO private.website_lead_consents(lead_id,organization_id,contact_id,request_id,payload_sha256,policy_url)
  VALUES(gen_random_uuid(),v_org,gen_random_uuid(),gen_random_uuid(),decode(repeat('a',64),'hex'),v_url);
  RAISE EXCEPTION 'G07 SECURITY FAILURE: no-approval receipt accepted';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'approved_public_policy_required' THEN RAISE; END IF;
 END;

 -- An entirely fictional QA-only approval; transaction rolls back everything.
 INSERT INTO private.consignment_policy_approvals
 (organization_id,policy_url,policy_version,approved_document_sha256,approval_reference,approved_at)
 VALUES(v_org,v_url,'1.0',repeat('b',64),'QA-G07-ROLLBACK',now());

 INSERT INTO public.contacts(organization_id,first_name,email,phone,source,notes)
 VALUES(v_org,'QA Consent Rehearsal','g07-rehearsal@example.invalid','3001234567','WEBSITE','Synthetic rollback-only')
 RETURNING id INTO v_contact;

 INSERT INTO public.leads(organization_id,contact_id,status,priority,notes)
 VALUES(v_org,v_contact,'NEW','MEDIUM','Synthetic rollback-only')
 RETURNING id INTO v_lead;

 INSERT INTO private.website_lead_consents
 (lead_id,organization_id,contact_id,request_id,payload_sha256,policy_url)
 VALUES(v_lead,v_org,v_contact,gen_random_uuid(),decode(repeat('c',64),'hex'),v_url);

 SELECT receipt.policy_version,receipt.approved_document_sha256
 INTO v_version,v_hash FROM private.website_lead_consents receipt WHERE receipt.lead_id=v_lead;
 IF v_version<>'1.0' OR v_hash<>repeat('b',64)
 THEN RAISE EXCEPTION 'G07 SECURITY FAILURE: immutable version or SHA not snapshotted'; END IF;

 BEGIN
  INSERT INTO private.website_lead_consents(lead_id,organization_id,contact_id,request_id,payload_sha256,policy_url)
  VALUES(gen_random_uuid(),v_foreign,gen_random_uuid(),gen_random_uuid(),decode(repeat('d',64),'hex'),v_url);
  RAISE EXCEPTION 'G07 SECURITY FAILURE: foreign tenant used QA approval';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'approved_public_policy_required' THEN RAISE; END IF;
 END;

 UPDATE private.consignment_policy_approvals SET revoked_at=now() WHERE organization_id=v_org;
 BEGIN
  INSERT INTO private.website_lead_consents(lead_id,organization_id,contact_id,request_id,payload_sha256,policy_url)
  VALUES(gen_random_uuid(),v_org,gen_random_uuid(),gen_random_uuid(),decode(repeat('e',64),'hex'),v_url);
  RAISE EXCEPTION 'G07 SECURITY FAILURE: revoked policy accepted';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'approved_public_policy_required' THEN RAISE; END IF;
 END;
END $qa$;
ROLLBACK;
SELECT 'PASS: G07 policy required, approved hash snapshotted, cross-tenant/revoked denied, all QA rolled back' AS evidence;
