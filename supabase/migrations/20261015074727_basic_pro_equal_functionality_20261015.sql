-- 2026-10-15 — same available product features in BASIC and PRO.
-- Only capacity/resource quotas differ; individual user permissions still
-- require an active, explicitly assigned role and appropriate tenant checks.
-- No changes to subscriptions, licenses, operational access, billing settings,
-- organizations, role assignments, payment records, or LIFETIME.
BEGIN;
DO $$
DECLARE
  basic_id uuid;
  pro_id uuid;
  basic_count integer;
  pro_count integer;
  inserted integer;
BEGIN
  SELECT id INTO basic_id FROM public.plans
   WHERE code='BASIC' AND active AND billing_cycle='MONTHLY'
    AND currency='COP' AND price=129900 FOR UPDATE;
  SELECT id INTO pro_id FROM public.plans
   WHERE code='PRO' AND active AND billing_cycle='MONTHLY'
    AND currency='COP' AND price=299900 FOR UPDATE;
  IF basic_id IS NULL OR pro_id IS NULL THEN
    RAISE EXCEPTION 'Expected approved BASIC/PRO monthly COP catalog; no modifications made';
  END IF;
  IF (SELECT count(*) FROM public.permissions)<>47 THEN
    RAISE EXCEPTION 'Permission catalog changed; manual review required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.plan_features pf
    WHERE pf.plan_id IN (basic_id,pro_id) AND pf.feature_key NOT LIKE 'permission:%'
  ) THEN
    RAISE EXCEPTION 'Unexpected non-permission entitlement: requires review';
  END IF;
  SELECT count(*) INTO pro_count FROM public.plan_features
  WHERE plan_id=pro_id AND enabled AND feature_key LIKE 'permission:%';
  IF pro_count<>47 OR EXISTS (
    SELECT 1 FROM public.permissions p WHERE NOT EXISTS (
      SELECT 1 FROM public.plan_features pf
       WHERE pf.plan_id=pro_id AND pf.feature_key='permission:'||p.key AND pf.enabled)
  ) OR EXISTS (
    SELECT 1 FROM public.plan_features pf WHERE pf.plan_id=pro_id
      AND (NOT pf.enabled OR NOT EXISTS(
        SELECT 1 FROM public.permissions p WHERE pf.feature_key='permission:'||p.key))
  ) THEN
    RAISE EXCEPTION 'Professional plan grants incomplete/unexpected; manual review required';
  END IF;
  SELECT count(*) INTO basic_count FROM public.plan_features
   WHERE plan_id=basic_id AND enabled AND feature_key LIKE 'permission:%';
  IF basic_count NOT IN (21,47) OR EXISTS (
    SELECT 1 FROM public.plan_features pf WHERE pf.plan_id=basic_id
      AND (NOT pf.enabled OR NOT EXISTS(
        SELECT 1 FROM public.permissions p WHERE pf.feature_key='permission:'||p.key))
  ) THEN
    RAISE EXCEPTION 'Basic plan is not at its expected baseline or target';
  END IF;
  IF basic_count=47 THEN
    IF EXISTS (
      (SELECT feature_key FROM public.plan_features WHERE plan_id=basic_id AND enabled
       EXCEPT SELECT feature_key FROM public.plan_features WHERE plan_id=pro_id AND enabled)
      UNION ALL
      (SELECT feature_key FROM public.plan_features WHERE plan_id=pro_id AND enabled
       EXCEPT SELECT feature_key FROM public.plan_features WHERE plan_id=basic_id AND enabled)
    ) THEN
      RAISE EXCEPTION 'Basic and Professional entitlements differ after previous update';
    END IF;
    RETURN; -- idempotent
  END IF;
  IF EXISTS (
     SELECT feature_key FROM public.plan_features WHERE plan_id=basic_id AND enabled
      EXCEPT SELECT feature_key FROM public.plan_features WHERE plan_id=pro_id AND enabled
  ) THEN RAISE EXCEPTION 'Basic has nonstandard permissions: manual review'; END IF;

  -- Catalog access ceilings, NOT per-member grants.
  INSERT INTO public.plan_features(plan_id,feature_key,enabled)
  SELECT basic_id,pf.feature_key,true FROM public.plan_features pf
    WHERE pf.plan_id=pro_id AND pf.enabled
  ON CONFLICT(plan_id,feature_key) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted<>26 THEN
    RAISE EXCEPTION 'Expected 26 missing Basic features, found %',inserted;
  END IF;
  IF (SELECT count(*) FROM public.plan_features WHERE plan_id=basic_id AND enabled)<>47 THEN
    RAISE EXCEPTION 'Basic/Professional functionality synchronization incomplete';
  END IF;
END
$$;
COMMIT;
