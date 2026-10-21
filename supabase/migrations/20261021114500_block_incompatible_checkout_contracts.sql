-- Guard contract/plan compatibility before redirecting a user to pay.
-- A currently valid TRIAL period with a different plan must not generate
-- a pending checkout that is inevitably trapped in contract_review on payment.
-- Preserve the existing terms, permissions, environment, idempotency and tax gates.
BEGIN;
CREATE OR REPLACE FUNCTION public.billing_create_order(target_org uuid, target_plan uuid, target_environment text, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE org public.organizations%ROWTYPE; account public.organization_billing_access%ROWTYPE;
  plan public.plans%ROWTYPE; settings public.billing_activation_settings%ROWTYPE;
  terms_id uuid; order_row public.payment_orders%ROWTYPE; keys text[];
BEGIN
  SELECT * INTO org FROM public.organizations WHERE id=target_org FOR UPDATE;
  IF request_key IS NULL OR NOT jco_private.billing_owner(target_org)
    THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=target_org;
  SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;
  IF org.status NOT IN ('ACTIVE','INACTIVE','TRIAL') THEN RAISE EXCEPTION 'Organization suspended or inactive'; END IF;
  IF target_environment NOT IN ('sandbox','production') OR target_environment IS NULL
    OR (target_environment='sandbox' AND (NOT settings.sandbox_enabled OR NOT account.is_test))
    OR (target_environment='production' AND (NOT settings.production_enabled OR account.is_test))
    THEN RAISE EXCEPTION 'Payments unavailable for this environment'; END IF;
  IF (now() AT TIME ZONE 'America/Bogota')::date >= date '2027-01-01'
    THEN RAISE EXCEPTION 'Tax configuration required'; END IF;
  SELECT * INTO order_row FROM public.payment_orders WHERE organization_id=target_org AND idempotency_key=request_key;
  IF FOUND THEN
    IF order_row.plan_id<>target_plan OR order_row.environment<>target_environment THEN RAISE EXCEPTION 'Request key conflict'; END IF;
    RETURN to_jsonb(order_row)-'permission_keys';
  END IF;
  SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active FOR SHARE;
  IF plan.id IS NULL OR plan.currency<>'COP' OR plan.price<=0 OR plan.price*100<>trunc(plan.price*100)
    OR plan.price*100>9007199254740991 OR plan.billing_cycle NOT IN ('MONTHLY','ANNUAL')
    THEN RAISE EXCEPTION 'Plan unavailable for automatic checkout'; END IF;
  IF EXISTS(SELECT 1 FROM public.subscriptions s WHERE organization_id=target_org AND
    (billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL') OR
      s.status IN ('LIFETIME','SUSPENDED','CANCELLED') OR
      (s.current_period_end>now() AND s.plan_id<>target_plan)))
    THEN RAISE EXCEPTION 'Plan change requires administrative review'; END IF;
  SELECT id INTO terms_id FROM public.license_terms_versions WHERE active ORDER BY effective_date DESC,created_at DESC LIMIT 1;
  IF terms_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.license_acceptances WHERE organization_id=target_org
    AND terms_version_id=terms_id AND accepted_by=auth.uid()) THEN RAISE EXCEPTION 'Accept current terms first'; END IF;
  SELECT array_agg(substr(feature_key,12) ORDER BY feature_key) INTO keys FROM public.plan_features
    WHERE plan_id=target_plan AND enabled AND feature_key LIKE 'permission:%';
  IF coalesce(cardinality(keys),0)=0 THEN RAISE EXCEPTION 'Plan permissions not configured'; END IF;
  IF (SELECT count(*) FROM public.payment_orders WHERE organization_id=target_org
    AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Too many payment attempts'; END IF;
  INSERT INTO public.payment_orders(organization_id,plan_id,created_by,idempotency_key,billing_mode,
    environment,reference,amount_in_cents,permission_keys,terms_version_id,expires_at)
  VALUES(target_org,target_plan,auth.uid(),request_key,
    CASE WHEN plan.billing_cycle='MONTHLY' THEN 'SAAS_MONTHLY' ELSE 'SAAS_ANNUAL' END,
    target_environment,'JCO_'||replace(gen_random_uuid()::text,'-',''),(plan.price*100)::bigint,keys,terms_id,now()+interval '30 minutes')
  RETURNING * INTO order_row;
  RETURN to_jsonb(order_row)-'permission_keys';
END;
$function$;
COMMIT;
