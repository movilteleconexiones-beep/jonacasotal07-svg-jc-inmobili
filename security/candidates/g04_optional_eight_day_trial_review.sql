-- G04 / #203: optional one-time eight-day SaaS trial.
-- No trial is started automatically when a company registers.
-- Paid verification supersedes trial immediately (existing Wompi fulfillment).
-- Rollout UI remains gated until independently certified.
CREATE OR REPLACE FUNCTION jco_private.operational_access(target_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    JOIN public.organization_billing_access b ON b.organization_id=o.id
    WHERE o.id=target_org AND o.status='ACTIVE' AND (
      NOT b.requires_payment OR b.manual_access_until > now() OR EXISTS (
        SELECT 1 FROM public.subscriptions s
        JOIN public.organization_licenses l ON l.organization_id=s.organization_id
        WHERE s.organization_id=o.id AND s.status='ACTIVE'
          AND s.current_period_start <= now() AND s.current_period_end > now()
          AND l.license_type='SAAS' AND l.status='ACTIVE'
          AND l.starts_at <= now() AND l.ends_at > now()) OR EXISTS (
        SELECT 1 FROM public.subscriptions s
        JOIN public.organization_licenses l ON l.organization_id=s.organization_id
        WHERE s.organization_id=o.id AND s.status='LIFETIME'
          AND s.billing_mode='LIFETIME' AND s.current_period_end IS NULL
          AND l.license_type='LIFETIME' AND l.status='ACTIVE'
          AND l.starts_at <= now() AND l.ends_at IS NULL)
      OR (b.requires_payment AND NOT b.is_test AND EXISTS (
        SELECT 1 FROM public.subscriptions s
        JOIN public.organization_licenses l ON l.organization_id=s.organization_id
        WHERE s.organization_id=o.id AND s.status='TRIAL'
          AND s.billing_mode='SAAS_MONTHLY'
          AND s.current_period_start <= now()
          AND s.current_period_end > now()
          AND s.trial_ends_at = s.current_period_end
          AND s.trial_ends_at IS NOT NULL
          AND l.license_type='SAAS' AND l.status='ACTIVE'
          AND l.starts_at <= now() AND l.ends_at >= s.trial_ends_at
      ))
    ));
$function$;

CREATE OR REPLACE FUNCTION public.billing_start_eight_day_trial(
  target_org uuid, target_plan uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' SET lock_timeout TO '5s'
AS $function$
DECLARE
  actor uuid := auth.uid();
  account public.organization_billing_access%ROWTYPE;
  existing public.subscriptions%ROWTYPE;
  contract public.organization_licenses%ROWTYPE;
  plan public.plans%ROWTYPE;
  terms_id uuid;
  permissions text[];
  started timestamptz := transaction_timestamp();
  expires timestamptz;
BEGIN
  IF actor IS NULL OR NOT jco_private.billing_owner(target_org) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
  END IF;
  -- Never launch an eight-day trial before the customer can purchase a real plan.
  -- VITE_* browser feature flags cannot protect this privileged RPC.
  IF NOT EXISTS (SELECT 1 FROM public.billing_activation_settings
                 WHERE id=true AND production_enabled IS TRUE) THEN
    RAISE EXCEPTION 'Eight-day trial not released yet' USING ERRCODE='42501';
  END IF;
  -- A tenant lock serializes initial trial, checkout state, and owner acceptance.
  PERFORM 1 FROM public.organizations
   WHERE id=target_org AND status IN ('ACTIVE','INACTIVE') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization is not eligible' USING ERRCODE='23514';
  END IF;
  SELECT * INTO account FROM public.organization_billing_access
   WHERE organization_id=target_org FOR UPDATE;
  IF account.organization_id IS NULL OR NOT account.requires_payment
     OR account.is_test OR account.manual_access_until IS NOT NULL THEN
    RAISE EXCEPTION 'Trial is not available for this account' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.subscriptions
    WHERE organization_id=target_org FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    -- Network retry returns the SAME fixed expiry; never grants another period.
    IF existing.status='TRIAL' AND existing.plan_id=target_plan
       AND existing.trial_ends_at IS NOT NULL THEN
      RETURN existing.trial_ends_at;
    END IF;
    RAISE EXCEPTION 'Trial was previously used or contract is active' USING ERRCODE='23514';
  END IF;
  -- One trial per owner, even if they register another company.
  IF EXISTS (SELECT 1 FROM public.audit_log a WHERE a.actor_user_id=actor
             AND a.action='billing.trial_started')
     OR EXISTS (SELECT 1 FROM public.subscriptions s
          JOIN public.organization_members m ON m.organization_id=s.organization_id
          WHERE m.user_id=actor AND s.trial_ends_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.payment_orders po
          WHERE po.organization_id=target_org AND po.status='APPROVED')
  THEN
    RAISE EXCEPTION 'Trial already used or verified payment exists' USING ERRCODE='23514';
  END IF;
  SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active
    AND billing_cycle='MONTHLY' AND code IN ('BASIC','PRO') AND currency='COP' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trial plan unavailable' USING ERRCODE='23514'; END IF;
  IF NOT jco_private.plan_capacity_fits(target_org,target_plan) THEN
    RAISE EXCEPTION 'Plan capacity exceeded' USING ERRCODE='23514';
  END IF;
  SELECT * INTO contract FROM public.organization_licenses
    WHERE organization_id=target_org FOR UPDATE;
  IF contract.id IS NULL OR contract.license_type<>'SAAS'
    OR contract.status NOT IN ('PENDING','ACTIVE') OR contract.ends_at IS NOT NULL THEN
    RAISE EXCEPTION 'Existing contract requires review' USING ERRCODE='23514';
  END IF;
  SELECT id INTO terms_id FROM public.license_terms_versions WHERE active
    ORDER BY effective_date DESC,created_at DESC LIMIT 1;
  IF terms_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.license_acceptances a
    WHERE a.organization_id=target_org AND a.accepted_by=actor AND a.terms_version_id=terms_id
  ) THEN
    RAISE EXCEPTION 'Accept current terms before a trial' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(substr(feature_key,12) ORDER BY feature_key) INTO permissions
    FROM public.plan_features WHERE plan_id=target_plan AND enabled
      AND feature_key LIKE 'permission:%';
  IF coalesce(cardinality(permissions),0)=0 THEN
    RAISE EXCEPTION 'Missing commercial permissions' USING ERRCODE='23514';
  END IF;

  expires := started + interval '8 days';
  INSERT INTO public.subscriptions(
    organization_id,plan_id,status,billing_mode,
    started_at,current_period_start,current_period_end,trial_ends_at
  ) VALUES(target_org,target_plan,'TRIAL','SAAS_MONTHLY',started,started,expires,expires);
  UPDATE public.organization_licenses
    SET status='ACTIVE',starts_at=started,ends_at=expires,
        terms_version_id=terms_id,updated_at=now()
    WHERE organization_id=target_org;
  UPDATE public.organization_billing_access
    SET allowed_permissions=permissions, updated_at=now()
    WHERE organization_id=target_org;
  UPDATE public.organizations
    SET status='ACTIVE',plan_id=target_plan,updated_at=now()
    WHERE id=target_org;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(target_org,actor,'billing.trial_started','organization',target_org,
       jsonb_build_object('plan_id',target_plan,'trial_days',8,'started_at',started,'expires_at',expires));
  RETURN expires;
END;
$function$;

-- PostgreSQL defaults EXECUTE to PUBLIC. Force an explicit role-bound RPC.
REVOKE ALL ON FUNCTION public.billing_start_eight_day_trial(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_start_eight_day_trial(uuid,uuid) TO authenticated;
