-- PostgreSQL 17 disposable DB only; candidate must be applied first.
DO $verification$
DECLARE blocked boolean;
 org_a uuid:='11111111-1111-4111-8111-111111111111';
 org_b uuid:='22222222-2222-4222-8222-222222222222';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_indexes
   WHERE schemaname='public' AND tablename='contacts'
     AND indexname='jco_contacts_tenant_email_name_unique'
     AND indexdef LIKE 'CREATE UNIQUE INDEX%')
 THEN RAISE EXCEPTION 'Tenant contact identity UNIQUE index missing'; END IF;

 INSERT INTO public.contacts(organization_id,first_name,last_name,email)
 VALUES (org_a,'Andrea','Cliente','andrea@example.test');
 -- Same name/email in another inmobiliaria must remain independent.
 INSERT INTO public.contacts(organization_id,first_name,last_name,email)
 VALUES (org_b,'Andrea','Cliente','andrea@example.test');
 -- Distinct people in one agency may share the same email.
 INSERT INTO public.contacts(organization_id,first_name,last_name,email)
 VALUES (org_a,'David','Cliente','andrea@example.test');
 -- Null email cannot safely establish identity; keep legacy behavior.
 INSERT INTO public.contacts(organization_id,first_name,last_name,email)
 VALUES (org_a,'Invitado','Sin correo',NULL),
        (org_a,'Invitado','Sin correo',NULL);

 blocked:=false;
 BEGIN
  INSERT INTO public.contacts(organization_id,first_name,last_name,email)
  VALUES(org_a,' ANDREA ','cliente ',' ANDREA@EXAMPLE.TEST ');
 EXCEPTION WHEN unique_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Same normalized identity INSERT was accepted'; END IF;

 -- A correction must not turn another person into a duplicate identity.
 blocked:=false;
 BEGIN
   UPDATE public.contacts SET first_name='Andrea'
   WHERE organization_id=org_a AND first_name='David'
     AND email='andrea@example.test';
 EXCEPTION WHEN unique_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Same normalized identity UPDATE was accepted'; END IF;

 IF (SELECT count(*) FROM public.contacts WHERE organization_id=org_a)<>4
 OR (SELECT count(*) FROM public.contacts WHERE organization_id=org_b)<>1
 THEN RAISE EXCEPTION 'Rejected duplicate mutated existing rows'; END IF;

 IF has_table_privilege('anon','public.contacts','INSERT')
 THEN RAISE EXCEPTION 'Anonymous direct contact write unexpectedly allowed'; END IF;
END $verification$;

-- The exact same normalized identity is blocked under authenticated role.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('app.tenant_id',
  '11111111-1111-4111-8111-111111111111',true);
DO $staff$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.contacts(organization_id,first_name,last_name,email)
  VALUES('11111111-1111-4111-8111-111111111111','ANDREA','CLIENTE',
    'andrea@example.test');
 EXCEPTION WHEN unique_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Staff bypassed duplicate identity index'; END IF;
END $staff$;
ROLLBACK;
SELECT 'PASS: tenant identity index rejects duplicate INSERT/UPDATE; shared email and other agencies valid' AS result;
