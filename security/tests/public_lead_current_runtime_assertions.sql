-- SQL-runtime regression of the currently deployed public CRM lead RPC (not PR #282).
-- This script MUST run only against the disposable synthetic fixture.
DO $grants$
BEGIN
 IF NOT has_function_privilege('anon',
      'public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)',
      'EXECUTE')
    OR NOT has_function_privilege('authenticated',
      'public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)',
      'EXECUTE')
    OR has_function_privilege('service_role',
      'public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)',
      'EXECUTE')
    OR has_table_privilege('anon','public.contacts','SELECT')
    OR has_table_privilege('anon','public.contacts','INSERT')
    OR has_table_privilege('anon','public.leads','SELECT')
    OR has_table_privilege('authenticated','public.leads','SELECT')
    OR has_table_privilege('anon','private.website_contact_consents','SELECT')
 THEN RAISE EXCEPTION 'Public RPC / private CRM privileges drifted'; END IF;
END $grants$;

-- A synthetic trigger forces failure AFTER contact and consent insertion,
-- proving SQL statement atomicity, not merely that input validation works.
CREATE FUNCTION public.reject_synthetic_lead() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $trig$
BEGIN
 IF NEW.notes LIKE '%ROLLBACK_CASE%' THEN
   RAISE EXCEPTION 'synthetic lead insert failure' USING ERRCODE='P0003';
 END IF;
 RETURN NEW;
END $trig$;
CREATE TRIGGER reject_synthetic_lead BEFORE INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.reject_synthetic_lead();

BEGIN;
SET LOCAL ROLE anon;
DO $exercise$
DECLARE ok boolean; denied boolean; slug text; n integer;
BEGIN
 -- Multiple contacts with one email in alpha demonstrate its actual hourly/email cap;
 -- beta with that SAME email remains independent.
 FOR n IN 1..4 LOOP
  SELECT public.submit_public_website_lead(
    'alpha','Test User','shared@example.invalid','3001234567',
    'Arriendo','Solicitud sintética '||n,true,'') INTO ok;
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Alpha CRM failed'; END IF;
 END LOOP;
 SELECT public.submit_public_website_lead(
    'beta','Test User','shared@example.invalid','3001234567',
    'Arriendo','Solicitud de otra inmobiliaria',true,'') INTO ok;
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Beta CRM failed'; END IF;

 -- Fifth alpha contact with same email within 24 hours must be denied.
 denied:=false;
 BEGIN
  PERFORM public.submit_public_website_lead(
    'alpha','Test User','shared@example.invalid','3001234567',
    'Arriendo','Exceso',true,'');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Email-per-tenant quota bypass'; END IF;

 -- These organizations have no active / published / paid / policy-enabled portal.
 FOREACH slug IN ARRAY ARRAY['suspended','disabled','unpaid','no-policy','not-found'] LOOP
  denied:=false;
  BEGIN
   PERFORM public.submit_public_website_lead(
     slug,'Test User','blocked@example.invalid','3001234567',
     'Arriendo','Intento prohibido',true,'');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Invalid agency accepted: %',slug; END IF;
 END LOOP;

 -- Explicit checkbox consent and valid contact information are mandatory.
 denied:=false;
 BEGIN
  PERFORM public.submit_public_website_lead(
    'beta','Test User','noconsent@example.invalid','3001234567',
    'Venta','Sin consentimiento',false,'');
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Missing consent was accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.submit_public_website_lead(
    'beta','Test User','not-an-email','3001234567',
    'Venta','Correo inválido',true,'');
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid email was accepted'; END IF;

 -- Honeypot may answer true to avoid bot probing, but MUST NOT write CRM rows.
 SELECT public.submit_public_website_lead(
   'alpha','Bot Name','honeypot@example.invalid','3001234567',
   'Venta','Mensaje oculto',true,'filled-trap') INTO ok;
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Honeypot contract changed'; END IF;

 -- Force a failure in the THIRD write (lead) and require full rollback.
 denied:=false;
 BEGIN
  PERFORM public.submit_public_website_lead(
    'beta','Test User','rollback@example.invalid','3001234567',
    'Venta','ROLLBACK_CASE',true,'');
 EXCEPTION WHEN SQLSTATE 'P0003' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Synthetic lead failure was not raised'; END IF;
END $exercise$;
COMMIT;

DO $verify$
DECLARE alpha uuid:='11111111-1111-4111-8111-111111111111';
        beta uuid:='22222222-2222-4222-8222-222222222222';
BEGIN
 IF (SELECT count(*) FROM public.contacts)<>5
    OR (SELECT count(*) FROM public.leads)<>5
    OR (SELECT count(*) FROM private.website_contact_consents)<>5
    OR (SELECT count(*) FROM public.contacts WHERE organization_id=alpha)<>4
    OR (SELECT count(*) FROM public.contacts WHERE organization_id=beta)<>1
 THEN RAISE EXCEPTION 'Rejected request produced CRM row or accepted request failed'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.contacts c
   JOIN public.leads l ON l.contact_id=c.id
   JOIN private.website_contact_consents consent ON consent.contact_id=c.id
   WHERE c.organization_id<>l.organization_id
      OR c.organization_id<>consent.organization_id
      OR consent.policy_url<>('https://example.invalid/'||
           (CASE WHEN c.organization_id=alpha THEN 'alpha' ELSE 'beta' END)||
           '/privacidad')
      OR c.source<>'WEBSITE' OR l.status<>'NEW' OR l.priority<>'MEDIUM'
      OR c.email<>'shared@example.invalid'
 ) THEN RAISE EXCEPTION 'Cross-tenant CRM association or policy receipt drift'; END IF;
 IF EXISTS (SELECT 1 FROM public.contacts WHERE email IN (
   'rollback@example.invalid','honeypot@example.invalid',
   'noconsent@example.invalid','blocked@example.invalid'))
 THEN RAISE EXCEPTION 'Rejected/rolled back request wrote a contact'; END IF;
 IF EXISTS (SELECT 1 FROM public.leads l LEFT JOIN public.contacts c ON c.id=l.contact_id
            WHERE c.id IS NULL OR c.organization_id<>l.organization_id)
 THEN RAISE EXCEPTION 'Orphaned or cross-tenant lead'; END IF;
 IF EXISTS (SELECT 1 FROM private.website_contact_consents consent
            LEFT JOIN public.contacts c ON c.id=consent.contact_id
            WHERE c.id IS NULL OR c.organization_id<>consent.organization_id)
 THEN RAISE EXCEPTION 'Orphaned or cross-tenant consent'; END IF;
END $verify$;

-- Check the authenticated role can use the same public RPC without table SELECT.
BEGIN;
SET LOCAL ROLE authenticated;
DO $exercise$
DECLARE ok boolean;
BEGIN
 SELECT public.submit_public_website_lead(
  'beta','Authenticated Test','auth@example.invalid','3001234567',
  'Administración','Autenticado sin permiso CRM directo',true,'') INTO ok;
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Authenticated RPC access broken'; END IF;
END $exercise$;
ROLLBACK;

SELECT 'PASS: real public CRM SQL; anon isolation; consent; policy; quota; honeypot; atomic rollback; authenticated API' AS result;
