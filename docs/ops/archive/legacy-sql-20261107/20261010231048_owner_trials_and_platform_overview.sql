-- Audited owner trials and a SuperAdmin-only monthly overview.
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
  SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active AND currency='COP'
    AND billing_cycle='MONTHLY' AND code IN ('PRO','ENTERPRISE') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose a complete monthly trial plan'; END IF;
  SELECT array_agg(substr(feature_key,12) ORDER BY feature_key) INTO keys FROM public.plan_features
    WHERE plan_id=plan.id AND enabled AND feature_key LIKE 'permission:%';
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

CREATE OR REPLACE FUNCTION public.platform_organization_overview(month_limit integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF month_limit IS NULL OR month_limit NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Invalid month range'; END IF;
  WITH member_counts AS (SELECT organization_id,count(*) FILTER(WHERE status='ACTIVE') AS member_count
      FROM public.organization_members GROUP BY organization_id),
    property_counts AS (SELECT organization_id,count(*) AS property_count FROM public.properties GROUP BY organization_id),
    owners AS (SELECT m.organization_id,CASE WHEN count(DISTINCT m.user_id)=1 THEN min(m.user_id::text)::uuid END AS owner_user_id
      FROM public.organization_members m JOIN public.member_roles mr ON mr.organization_member_id=m.id
      JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id AND r.active AND r.key='ORGANIZATION_OWNER'
      WHERE m.status='ACTIVE' GROUP BY m.organization_id),
    rows AS (SELECT o.id AS organization_id,o.name AS organization_name,o.slug AS organization_slug,
      o.status AS organization_status,o.created_at,
      to_char(o.created_at AT TIME ZONE 'America/Bogota','YYYY-MM') AS registration_month,
      CASE WHEN o.status='ACTIVE' AND NOT jco_private.operational_access(o.id) THEN 'EXPIRED' ELSE o.status END AS access_status,
      coalesce(b.is_test,false) AS is_test,
      coalesce(mc.member_count,0) AS member_count,coalesce(pc.property_count,0) AS property_count,
      s.status AS subscription_status,s.billing_mode,pl.name AS plan_name,
      coalesce(b.manual_access_until,s.current_period_end) AS access_until,ow.owner_user_id
      FROM public.organizations o LEFT JOIN public.organization_billing_access b ON b.organization_id=o.id
      LEFT JOIN public.subscriptions s ON s.organization_id=o.id LEFT JOIN public.plans pl ON pl.id=coalesce(o.plan_id,s.plan_id)
      LEFT JOIN member_counts mc ON mc.organization_id=o.id LEFT JOIN property_counts pc ON pc.organization_id=o.id
      LEFT JOIN owners ow ON ow.organization_id=o.id),
    months AS (SELECT to_char(m,'YYYY-MM') AS month FROM generate_series(
      date_trunc('month',now() AT TIME ZONE 'America/Bogota')-make_interval(months=>month_limit-1),
      date_trunc('month',now() AT TIME ZONE 'America/Bogota'),interval '1 month') m),
    monthly AS (SELECT m.month,count(r.organization_id) AS registered,
      count(r.organization_id) FILTER(WHERE r.access_status='ACTIVE') AS active_now,
      count(r.organization_id) FILTER(WHERE r.access_status='INACTIVE') AS inactive_now,
      count(r.organization_id) FILTER(WHERE r.access_status='TRIAL') AS pending_now,
      count(r.organization_id) FILTER(WHERE r.access_status='SUSPENDED') AS suspended_now,
      count(r.organization_id) FILTER(WHERE r.access_status='EXPIRED') AS expired_now,
      count(r.organization_id) FILTER(WHERE r.is_test) AS tests,
      (SELECT count(*) FROM rows accumulated WHERE accumulated.registration_month<=m.month) AS accumulated
      FROM months m LEFT JOIN rows r ON r.registration_month=m.month GROUP BY m.month)
  SELECT jsonb_build_object('timezone','America/Bogota','generated_at',now(),
    'organizations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at DESC,organization_id) FROM rows r),'[]'::jsonb),
    'totals',(SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE access_status='ACTIVE'),
      'inactive',count(*) FILTER(WHERE access_status='INACTIVE'),'pending',count(*) FILTER(WHERE access_status='TRIAL'),
      'suspended',count(*) FILTER(WHERE access_status='SUSPENDED'),'expired',count(*) FILTER(WHERE access_status='EXPIRED'),
      'tests',count(*) FILTER(WHERE is_test)) FROM rows),
    'monthly',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY month DESC) FROM monthly m),'[]'::jsonb)) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_organization_overview(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_organization_overview(integer) TO authenticated;

-- Old installations also expose rental operations. Apply the same commercial
-- restriction while retaining each table's existing tenant and role policies.
DO $$ DECLARE t text; definition text; BEGIN
  FOREACH t IN ARRAY ARRAY['leases','rent_payments','owner_statements','maintenance_requests'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=t AND policyname='jco_commercial_access') THEN
      EXECUTE format('CREATE POLICY jco_commercial_access ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING (jco_private.operational_access(organization_id)) WITH CHECK (jco_private.operational_access(organization_id))',t);
    END IF;
  END LOOP;
  definition:=pg_get_functiondef('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure);
  definition:=replace(definition,'status IN (''SUSPENDED'',''TERMINATED'')','status IN (''SUSPENDED'',''CANCELLED'',''TERMINATED'')');
  EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
