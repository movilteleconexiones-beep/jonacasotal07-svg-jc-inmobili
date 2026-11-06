-- Genuine production owner-registration RPC + genuine billing functions, synthetic data.
-- Runs ONLY in an ephemeral PostgreSQL 17 database created in GitHub Actions.
CREATE FUNCTION pg_temp.assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'E2E FAILED: %',label; END IF; END $$;

-- Production access contract: anonymous cannot call tenant creation.
REVOKE ALL ON FUNCTION public.create_organization_with_owner(text,text,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(text,text,text) TO authenticated;
SELECT pg_temp.assert(NOT has_function_privilege('anon',
  'public.create_organization_with_owner(text,text,text)','EXECUTE'),
  'anonymous registration forbidden');
SELECT pg_temp.assert(has_function_privilege('authenticated',
  'public.create_organization_with_owner(text,text,text)','EXECUTE'),
  'authenticated customer registration allowed');

SELECT set_config('request.jwt.claim.role','authenticated',false);
-- Login A: first real onboarding transaction. No manual roles inserted.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT public.create_organization_with_owner('Inmobiliaria Ensayo A','empresa-integracion-a','CO');
SELECT pg_temp.assert((SELECT status='INACTIVE' FROM public.organizations WHERE slug='empresa-integracion-a'),
  'new organization must remain INACTIVE until verified payment');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.organization_members m
  JOIN public.organizations o ON o.id=m.organization_id
  WHERE o.slug='empresa-integracion-a' AND m.user_id=auth.uid() AND m.status='ACTIVE'),
  'first user is active founding member');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.member_roles mr
  JOIN public.organization_members m ON m.id=mr.organization_member_id
  JOIN public.roles r ON r.id=mr.role_id
  JOIN public.organizations o ON o.id=m.organization_id
  WHERE o.slug='empresa-integracion-a' AND r.key='ORGANIZATION_OWNER'
    AND r.organization_id=m.organization_id AND m.user_id=auth.uid()),
  'founding user has exactly one OWNER role in her own organization');
SELECT pg_temp.assert((SELECT count(*)=5 FROM public.roles r
  JOIN public.organizations o ON o.id=r.organization_id WHERE o.slug='empresa-integracion-a'),
  'five default roles provisioned for founding organization');
SELECT pg_temp.assert((SELECT count(*)>0 FROM public.role_permissions rp
  JOIN public.member_roles mr ON mr.role_id=rp.role_id
  JOIN public.organization_members m ON mr.organization_member_id=m.id
  WHERE m.user_id=auth.uid() AND m.organization_id=(
    SELECT id FROM public.organizations WHERE slug='empresa-integracion-a')),
  'owner inherits actual default permissions by trigger (not test-only grant)');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.organization_branding b
  JOIN public.organizations o ON o.id=b.organization_id
  WHERE o.slug='empresa-integracion-a' AND b.company_name='Inmobiliaria Ensayo A'),
  'tenant branding uses customer name');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.organization_settings s
  JOIN public.organizations o ON o.id=s.organization_id
  WHERE o.slug='empresa-integracion-a' AND s.country='CO'),
  'tenant locale and currency provisioned');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.organization_billing_access b
  JOIN public.organizations o ON o.id=b.organization_id
  WHERE o.slug='empresa-integracion-a' AND b.requires_payment),
  'tenant billing account created and requires payment');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.subscriptions
  WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='empresa-integracion-a')),
  'registration never grants a hidden trial or paid subscription');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.audit_log a
  JOIN public.organizations o ON o.id=a.organization_id
  WHERE o.slug='empresa-integracion-a' AND a.action='organization.created'
    AND a.actor_user_id=auth.uid()),
  'registration correctly audited');

-- Duplicate signup must fail atomically, never create duplicate membership or billing account.
DO $duplicate_signup$ BEGIN
  BEGIN
    PERFORM public.create_organization_with_owner('Duplicate','empresa-integracion-a','CO');
    RAISE EXCEPTION 'E2E FAILED: duplicate agency created';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $duplicate_signup$;
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.organizations WHERE slug='empresa-integracion-a'),
  'unique slug prevents duplicate onboarding');

-- Independent login B: a second company, without any SuperAdmin grants.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SELECT public.create_organization_with_owner('Inmobiliaria Ensayo B','empresa-integracion-b','CO');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.member_roles mr
  JOIN public.organization_members m ON m.id=mr.organization_member_id
  JOIN public.roles r ON r.id=mr.role_id
  JOIN public.organizations o ON o.id=m.organization_id
  WHERE o.slug='empresa-integracion-b' AND r.key='ORGANIZATION_OWNER'
    AND m.user_id=auth.uid()), 'second owner role remains independent');
SELECT pg_temp.assert(NOT jco_private.billing_owner(
    (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a')),
  'second owner cannot control first tenant billing');
SELECT pg_temp.assert(jco_private.billing_owner(
    (SELECT id FROM public.organizations WHERE slug='empresa-integracion-b')),
  'second owner controls only their agency billing');
SELECT pg_temp.assert(NOT public.is_platform_admin(),
  'organization owner never becomes platform superadmin');

-- Unauthorized owner B must fail on A's checkout, before any order is created.
DO $foreign_checkout$ BEGIN
  BEGIN
    PERFORM public.billing_create_order(
      (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),
      (SELECT id FROM public.plans WHERE code='BASIC'),
      'sandbox',gen_random_uuid());
    RAISE EXCEPTION 'E2E FAILED: cross-company checkout accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $foreign_checkout$;
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.payment_orders),
  'cross-tenant attempt creates no order');

-- Only the platform SuperAdmin may flag this synthetic account for sandbox.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT public.billing_admin_action(
 (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),
 'MARK_TEST','Synthetic onboarding payment rehearsal');
UPDATE public.billing_activation_settings
 SET sandbox_enabled=true,production_enabled=false,activation_mode='VERIFIED_PAYMENT';

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
-- Owner A accepts terms after registration; purchase is disabled until then.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $missing_terms$ BEGIN
  BEGIN
    PERFORM public.billing_create_order(
      (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),
      (SELECT id FROM public.plans WHERE code='BASIC'),
      'sandbox',gen_random_uuid());
    RAISE EXCEPTION 'E2E FAILED: checkout without terms';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Accept current terms first%' THEN RAISE; END IF;
  END;
END $missing_terms$;

SELECT public.billing_accept_terms(
  (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),
  '40000000-0000-0000-0000-000000000006','Synthetic acceptance - CI only');

SELECT public.billing_create_order(
 (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),
 (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',
 '70000000-0000-0000-0000-000000000099');
SELECT public.billing_create_order(
 (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),
 (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',
 '70000000-0000-0000-0000-000000000099');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.payment_orders
 WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='empresa-integracion-a')),
 'checkout idempotency key prevents duplicate orders');
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.subscriptions
 WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='empresa-integracion-a')),
 'pending payment does not activate modules');
SELECT pg_temp.assert(NOT public.has_org_permission(
 (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),'properties.view'),
 'unpaid owner has no access to property operations');

-- Server has already verified the Wompi signature; call trusted processor.
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT pg_temp.assert(public.process_verified_payment_event(
 (SELECT reference FROM public.payment_orders WHERE idempotency_key=
 '70000000-0000-0000-0000-000000000099'),
 'verified-fake-onboarding-transaction',
 (SELECT amount_in_cents FROM public.payment_orders WHERE idempotency_key=
 '70000000-0000-0000-0000-000000000099'),
 'COP','APPROVED','sandbox',repeat('a',64),repeat('b',64))='processed',
 'verified payment activates exactly once');
SELECT pg_temp.assert((SELECT s.status='ACTIVE' AND s.billing_mode='SAAS_MONTHLY'
   AND s.current_period_start>now()-interval '3 minutes'
   AND s.current_period_end>now()+interval '27 days'
 FROM public.subscriptions s
 JOIN public.organizations o ON s.organization_id=o.id WHERE o.slug='empresa-integracion-a'),
 'paid Basic subscription starts on verified approval');
SELECT pg_temp.assert((SELECT po.fulfillment_status='APPLIED' AND po.review_reason IS NULL
 FROM public.payment_orders po
 JOIN public.organizations o ON o.id=po.organization_id WHERE o.slug='empresa-integracion-a'),
 'payment fulfillment recorded and not stuck for review');
SELECT pg_temp.assert((SELECT status='ACTIVE' FROM public.organizations
 WHERE slug='empresa-integracion-a'), 'agency activated after payment');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.subscriptions
 WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='empresa-integracion-a')),
 'exactly one paid subscription exists');
SELECT pg_temp.assert(public.process_verified_payment_event(
 (SELECT reference FROM public.payment_orders WHERE idempotency_key=
 '70000000-0000-0000-0000-000000000099'),
 'verified-fake-onboarding-transaction',
 (SELECT amount_in_cents FROM public.payment_orders WHERE idempotency_key=
 '70000000-0000-0000-0000-000000000099'),
 'COP','APPROVED','sandbox',repeat('a',64),repeat('c',64))='duplicate',
 'replayed webhook must not duplicate activation');

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT pg_temp.assert(public.has_org_permission(
 (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),'properties.view'),
 'real owner role and paid plan combine to permit operations');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SELECT pg_temp.assert(NOT public.has_org_permission(
 (SELECT id FROM public.organizations WHERE slug='empresa-integracion-a'),'properties.view'),
 'other company owner cannot use paid customer modules');
SELECT pg_temp.assert(NOT public.has_org_permission(
 (SELECT id FROM public.organizations WHERE slug='empresa-integracion-b'),'properties.view'),
 'unpaid second agency stays gated');
SELECT pg_temp.assert((SELECT NOT production_enabled FROM public.billing_activation_settings),
 'Wompi LIVE always disabled in rehearsal');
