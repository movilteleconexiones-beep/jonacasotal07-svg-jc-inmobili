-- Disposable PostgreSQL only. Run after schema and captured RPC definition.
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
SELECT public.create_organization_with_owner('Inmobiliaria prueba','inmo-prueba','CO');
DO $$
DECLARE v_org uuid;
BEGIN
 SELECT id INTO v_org FROM public.organizations WHERE slug='inmo-prueba';
 IF v_org IS NULL THEN RAISE EXCEPTION 'Missing organization'; END IF;
 IF (SELECT count(*) FROM public.organization_members WHERE organization_id=v_org)<>1 THEN RAISE EXCEPTION 'Missing owner membership'; END IF;
 IF (SELECT count(*) FROM public.roles WHERE organization_id=v_org AND active=true AND is_system_role=true)<>5 THEN RAISE EXCEPTION 'Incorrect initial roles'; END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE organization_id=v_org AND action='organization.created')<>1 THEN RAISE EXCEPTION 'Missing audit'; END IF;
END $$;
SELECT 'PASS: captured organization RPC basic assertions' AS result;
