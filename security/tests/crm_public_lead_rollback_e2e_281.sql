-- #281 Public website CRM end-to-end check, verified 2026-11-07.
-- Execute manually only against the designated TEST agency.
-- Simulated anonymous SQL role, not a real browser or independent session.
-- All mutations, including temporary test privacy URL, are inside BEGIN/ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='35s';

DO $prep$
DECLARE v_org uuid;
BEGIN
 SELECT o.id INTO STRICT v_org
 FROM public.organizations o
 JOIN public.organization_billing_access ba ON ba.organization_id=o.id AND ba.is_test
 WHERE o.slug='sistema-inmobiliario-jco' AND o.status='ACTIVE';

 IF NOT jco_private.operational_access(v_org) THEN
  RAISE EXCEPTION 'Test tenant not licensed';
 END IF;

 -- The test agency currently lacks a public privacy URL; supply a deliberately
 -- non-working synthetic HTTPS URL only for the lifetime of this transaction.
 UPDATE public.organization_branding
 SET public_page_content=jsonb_set(
   coalesce(public_page_content,'{}'::jsonb),'{privacyPolicyUrl}',
   to_jsonb('https://qa-policy.example.invalid/consent'::text),true)
 WHERE organization_id=v_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Test branding missing'; END IF;

 PERFORM set_config('jco.qa.crm_org',v_org::text,true);
 PERFORM set_config('jco.qa.crm_email',
  'crm-qa-'||replace(gen_random_uuid()::text,'-','')||'@example.invalid',true);
END $prep$;

SET LOCAL ROLE anon;
DO $qa$
DECLARE v_email text:=current_setting('jco.qa.crm_email');
 r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); denied boolean;
BEGIN
 IF public.submit_public_website_lead_once(
  'sistema-inmobiliario-jco','Prueba CRM',v_email,'3001234567',
  'ARRIENDO','QA consulta uno',true,'',r1) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'First submission rejected';
 END IF;

 IF public.submit_public_website_lead_once(
  'sistema-inmobiliario-jco','Prueba CRM',v_email,'3001234567',
  'ARRIENDO','QA consulta dos',true,'',r2) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Second submission rejected';
 END IF;

 IF public.submit_public_website_lead_once(
  'sistema-inmobiliario-jco','Prueba CRM',v_email,'3001234567',
  'ARRIENDO','QA consulta uno',true,'',r1) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Idempotent retry rejected';
 END IF;

 denied:=false;
 BEGIN
  PERFORM public.submit_public_website_lead_once(
   'sistema-inmobiliario-jco','Prueba CRM',v_email,'3001234567',
   'ARRIENDO','Altered payload',true,'',r1);
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Changed payload accepted on reused ID'; END IF;

 denied:=false;
 BEGIN
  PERFORM public.submit_public_website_lead_once(
   'sistema-inmobiliario-jco','Prueba CRM',v_email,'3001234567',
   'ARRIENDO','Without consent',false,'',gen_random_uuid());
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Missing consent accepted'; END IF;
END $qa$;
RESET ROLE;

DO $assert$
DECLARE v_org uuid:=current_setting('jco.qa.crm_org')::uuid;
 v_email text:=current_setting('jco.qa.crm_email');
 n_contacts int; n_leads int; n_receipts int;
BEGIN
 SELECT count(*) INTO n_contacts FROM public.contacts c
 WHERE c.organization_id=v_org AND c.email=v_email;

 SELECT count(*) INTO n_leads FROM public.leads l
 JOIN public.contacts c ON c.id=l.contact_id
 WHERE l.organization_id=v_org AND c.organization_id=v_org AND c.email=v_email;

 SELECT count(*) INTO n_receipts FROM private.website_lead_consents r
 JOIN public.contacts c ON c.id=r.contact_id
 JOIN public.leads l ON l.id=r.lead_id AND l.organization_id=v_org
   AND l.contact_id=r.contact_id
 WHERE r.organization_id=v_org AND c.organization_id=v_org AND c.email=v_email
   AND r.policy_url='https://qa-policy.example.invalid/consent'
   AND r.consent_method='PUBLIC_FORM_CHECKBOX';

 IF n_contacts<>1 OR n_leads<>2 OR n_receipts<>2 THEN
  RAISE EXCEPTION 'CRM data mismatch: contacts %, leads %, event consents %',
   n_contacts,n_leads,n_receipts;
 END IF;
 RAISE NOTICE 'PASS: one contact, two leads, two immutable consent receipts';
END $assert$;
ROLLBACK;
SELECT 'PASS: CRM E2E reversible transaction completed' AS result;
