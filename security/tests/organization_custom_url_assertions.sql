DO $assert$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  org3 uuid := '00000000-0000-4000-8000-000000000003';
BEGIN
  IF has_function_privilege('anon','public.set_organization_public_slug(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous may not update brand URL';
  END IF;
  IF NOT has_function_privilege('authenticated','public.set_organization_public_slug(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated owner is denied function execution';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',false);
  IF public.set_organization_public_slug(org1,'new-owner-portal') <> 'new-owner-portal' THEN
    RAISE EXCEPTION 'Owner could not change their own URL';
  END IF;
  IF (SELECT slug FROM public.organizations WHERE id=org2) <> 'tenant-two' THEN
    RAISE EXCEPTION 'Other organization mutated unexpectedly';
  END IF;
  IF (SELECT COUNT(*) FROM public.audit_log WHERE entity_id=org1
      AND action='organization.public_slug.updated') <> 1 THEN
    RAISE EXCEPTION 'Slug change missing audit record';
  END IF;

  -- Same slug is idempotent: no duplicate audit events.
  PERFORM public.set_organization_public_slug(org1,'new-owner-portal');
  IF (SELECT COUNT(*) FROM public.audit_log WHERE entity_id=org1) <> 1 THEN
    RAISE EXCEPTION 'Idempotent call created extra audit';
  END IF;

  BEGIN
    PERFORM public.set_organization_public_slug(org2,'stolen-org-two');
    RAISE EXCEPTION 'Cross-tenant URL change allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_organization_public_slug(org1,'tenant-two');
    RAISE EXCEPTION 'Duplicate slug accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_organization_public_slug(org1,'app');
    RAISE EXCEPTION 'Reserved URL accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000004',false);
  BEGIN
    PERFORM public.set_organization_public_slug(org1,'admin-should-not-change');
    RAISE EXCEPTION 'Non-owner administrator changed URL';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000005',false);
  BEGIN
    PERFORM public.set_organization_public_slug(org1,'inactive-should-not-change');
    RAISE EXCEPTION 'Inactive member changed URL';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',false);
  BEGIN
    PERFORM public.set_organization_public_slug(org3,'suspended-should-not-change');
    RAISE EXCEPTION 'Suspended organization changed URL';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub','',false);
  BEGIN
    PERFORM public.set_organization_public_slug(org1,'anonymous-should-not-change');
    RAISE EXCEPTION 'Unauthenticated caller changed URL';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  IF (SELECT slug FROM public.organizations WHERE id=org1) <> 'new-owner-portal'
    OR (SELECT slug FROM public.organizations WHERE id=org2) <> 'tenant-two'
    OR (SELECT slug FROM public.organizations WHERE id=org3) <> 'tenant-suspended' THEN
    RAISE EXCEPTION 'Organization URL isolation failed after negative tests';
  END IF;
END
$assert$;
