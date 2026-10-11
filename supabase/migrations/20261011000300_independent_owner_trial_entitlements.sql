-- An authorized no-charge trial is independent of commercial prices/currency.
-- Snapshot supported product permissions only for the isolated test tenant.
-- Existing plans, prices, features and paid contracts are unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.billing_admin_authorize_trial(
  target_org uuid,target_owner uuid,target_plan uuid,trial_days integer,reason text
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan public.plans%ROWTYPE; keys text[]; end_at timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF trial_days IS NULL OR trial_days NOT BETWEEN 1 AND 30 OR reason IS NULL
    OR length(trim(reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Invalid trial authorization'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=target_org AND status IN ('ACTIVE','TRIAL') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_members m
      JOIN auth.users u ON u.id=m.user_id AND u.email_confirmed_at IS NOT NULL
      JOIN public.member_roles mr ON mr.organization_member_id=m.id
      JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id
      WHERE m.organization_id=target_org AND m.user_id=target_owner AND m.status='ACTIVE'
        AND r.active AND r.key='ORGANIZATION_OWNER') THEN
    RAISE EXCEPTION 'Verified organization owner required';
  END IF;
  IF EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=target_owner AND active)
    OR EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=target_org
      AND (license_type<>'SAAS' OR status IN ('SUSPENDED','CANCELLED','TERMINATED')))
    OR EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=target_org
      AND status IN ('ACTIVE','LIFETIME','SUSPENDED','CANCELLED'))
    OR EXISTS(SELECT 1 FROM public.payment_orders WHERE organization_id=target_org
      AND environment='production' AND status='APPROVED') THEN
    RAISE EXCEPTION 'Commercial or platform account cannot become a trial';
  END IF;
  SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active
    AND billing_cycle='MONTHLY' AND code IN ('PRO','ENTERPRISE') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose a complete monthly trial plan'; END IF;
  SELECT array_agg(p.key ORDER BY p.key) INTO keys FROM public.permissions p
    WHERE p.key ~ '^(properties|clients|leads|appointments|deals|users|roles|settings|documents|owners|commissions|reports|leases|rent_payments|owner_statements|maintenance)\.';
  IF coalesce(cardinality(keys),0)=0 THEN RAISE EXCEPTION 'Plan permissions unavailable'; END IF;
  end_at:=now()+make_interval(days=>trial_days);
  UPDATE public.organization_billing_access SET requires_payment=true,is_test=true,
    manual_access_until=end_at,allowed_permissions=keys,updated_at=now() WHERE organization_id=target_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing account unavailable'; END IF;
  INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
    VALUES(target_org,'SAAS','ACTIVE',now(),end_at) ON CONFLICT(organization_id) DO UPDATE SET
      status='ACTIVE',starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
  INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end,trial_ends_at)
    VALUES(target_org,plan.id,'TRIAL','SAAS_MONTHLY',now(),end_at,end_at)
    ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='TRIAL',billing_mode='SAAS_MONTHLY',
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
      trial_ends_at=excluded.trial_ends_at,updated_at=now();
  UPDATE public.organizations SET status='ACTIVE',plan_id=plan.id,updated_at=now() WHERE id=target_org;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(target_org,auth.uid(),'billing.owner_trial_authorized','organization',target_org,
      jsonb_build_object('owner_user_id',target_owner,'plan_id',plan.id,'ends_at',end_at,'reason',trim(reason),'payment_received',false));
  RETURN end_at;
END;
$$;
REVOKE ALL ON FUNCTION public.billing_admin_authorize_trial(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_admin_authorize_trial(uuid,uuid,uuid,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

