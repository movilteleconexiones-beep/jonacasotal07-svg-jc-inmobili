-- Commercial access is separate from membership and platform administration.
-- Existing organizations retain their access. New organizations require payment
-- or an explicit, audited SuperAdmin approval. Payment environments start OFF.
BEGIN;

CREATE SCHEMA IF NOT EXISTS jco_private;
REVOKE ALL ON SCHEMA jco_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA jco_private TO authenticated, service_role;

CREATE TABLE public.billing_activation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  activation_mode text NOT NULL DEFAULT 'VERIFIED_PAYMENT'
    CHECK (activation_mode IN ('VERIFIED_PAYMENT','MANUAL')),
  sandbox_enabled boolean NOT NULL DEFAULT false,
  production_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.billing_activation_settings(id) VALUES(true);
ALTER TABLE public.billing_activation_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_activation_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.billing_activation_settings TO authenticated;
GRANT ALL ON public.billing_activation_settings TO service_role;
CREATE POLICY billing_settings_read ON public.billing_activation_settings
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.organization_billing_access (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  requires_payment boolean NOT NULL DEFAULT true,
  is_test boolean NOT NULL DEFAULT false,
  manual_access_until timestamptz,
  allowed_permissions text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.organization_billing_access(organization_id,requires_payment)
  SELECT id,false FROM public.organizations;
ALTER TABLE public.organization_billing_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_billing_access FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_billing_access TO authenticated;
GRANT ALL ON public.organization_billing_access TO service_role;
CREATE POLICY billing_access_read ON public.organization_billing_access
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id) OR public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id=auth.uid() AND active
      AND admin_level IN ('SUPER_ADMIN','PLATFORM_OWNER'));
$$;

CREATE FUNCTION jco_private.operational_access(target_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
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
          AND l.starts_at <= now() AND l.ends_at > now())));
$$;
REVOKE ALL ON FUNCTION jco_private.operational_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION jco_private.operational_access(uuid) TO authenticated,service_role;

CREATE FUNCTION jco_private.member_permission(target_org uuid,permission_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH member AS (
    SELECT id FROM public.organization_members
    WHERE organization_id=target_org AND user_id=auth.uid() AND status='ACTIVE'
  ), requested AS (SELECT id FROM public.permissions WHERE key=permission_key),
  overrides AS (
    SELECT mp.effect FROM public.member_permissions mp
    JOIN member m ON m.id=mp.organization_member_id
    JOIN requested p ON p.id=mp.permission_id
  )
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM member) AND CASE
    WHEN EXISTS(SELECT 1 FROM overrides WHERE effect='DENY') THEN false
    WHEN EXISTS(SELECT 1 FROM overrides WHERE effect='ALLOW') THEN true
    ELSE EXISTS (
      SELECT 1 FROM member m
      JOIN public.member_roles mr ON mr.organization_member_id=m.id
      JOIN public.roles r ON r.id=mr.role_id AND r.active
        AND (r.organization_id=target_org OR r.organization_id IS NULL)
      JOIN public.role_permissions rp ON rp.role_id=r.id
      JOIN requested p ON p.id=rp.permission_id)
  END;
$$;
REVOKE ALL ON FUNCTION jco_private.member_permission(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.has_org_permission(target_org uuid,permission_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jco_private.operational_access(target_org)
    AND jco_private.member_permission(target_org,permission_key)
    AND EXISTS (
      SELECT 1 FROM public.organization_billing_access b WHERE b.organization_id=target_org
        AND (NOT b.requires_payment OR permission_key=ANY(b.allowed_permissions)));
$$;
REVOKE ALL ON FUNCTION public.has_org_permission(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid,text) TO authenticated,service_role;

CREATE FUNCTION jco_private.billing_owner(target_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members m
    JOIN public.member_roles mr ON mr.organization_member_id=m.id
    JOIN public.roles r ON r.id=mr.role_id AND r.active AND r.organization_id=m.organization_id
    WHERE m.organization_id=target_org AND m.user_id=auth.uid() AND m.status='ACTIVE'
      AND r.key='ORGANIZATION_OWNER');
$$;
REVOKE ALL ON FUNCTION jco_private.billing_owner(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION jco_private.pending_organization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  NEW.status:='TRIAL';
  RETURN NEW;
END;
$$;
CREATE TRIGGER jco_pending_organization BEFORE INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION jco_private.pending_organization();

CREATE FUNCTION jco_private.initialize_billing_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.organization_billing_access(organization_id) VALUES(NEW.id);
  INSERT INTO public.organization_licenses(organization_id,license_type,status)
    VALUES(NEW.id,'SAAS','PENDING') ON CONFLICT(organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER jco_initialize_billing AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION jco_private.initialize_billing_access();
REVOKE ALL ON FUNCTION jco_private.pending_organization(),jco_private.initialize_billing_access()
  FROM PUBLIC,anon,authenticated;

-- Restrictive policies also cover permissive legacy member/portal policies.
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','properties','leads','appointments','deals','activities',
    'ai_usage','import_jobs','property_owners','documents','commissions','portal_access_links',
    'property_consignments'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY jco_commercial_access ON public.%I AS RESTRICTIVE
        FOR ALL TO authenticated USING (jco_private.operational_access(organization_id))
        WITH CHECK (jco_private.operational_access(organization_id))',t);
    END IF;
  END LOOP;
END $policies$;

CREATE TABLE public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  idempotency_key uuid NOT NULL,
  billing_mode text NOT NULL CHECK(billing_mode IN ('SAAS_MONTHLY','SAAS_ANNUAL')),
  provider text NOT NULL DEFAULT 'WOMPI' CHECK(provider='WOMPI'),
  environment text NOT NULL CHECK(environment IN ('sandbox','production')),
  reference text NOT NULL UNIQUE CHECK(reference ~ '^[A-Za-z0-9_-]{8,100}$'),
  amount_in_cents bigint NOT NULL CHECK(amount_in_cents > 0),
  currency text NOT NULL DEFAULT 'COP' CHECK(currency='COP'),
  permission_keys text[] NOT NULL,
  terms_version_id uuid NOT NULL REFERENCES public.license_terms_versions(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DECLINED','VOIDED','ERROR')),
  fulfillment_status text NOT NULL DEFAULT 'PENDING' CHECK(fulfillment_status IN ('PENDING','APPLIED','REVIEW_REQUIRED','NO_ACCESS')),
  review_reason text,
  provider_transaction_id text UNIQUE,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,idempotency_key),
  CHECK((status='APPROVED' AND approved_at IS NOT NULL AND provider_transaction_id IS NOT NULL)
    OR (status <> 'APPROVED' AND approved_at IS NULL))
);
CREATE INDEX payment_orders_org_idx ON public.payment_orders(organization_id,created_at DESC);
CREATE INDEX payment_orders_plan_idx ON public.payment_orders(plan_id);
CREATE INDEX payment_orders_creator_idx ON public.payment_orders(created_by);
CREATE INDEX payment_orders_terms_idx ON public.payment_orders(terms_version_id);
CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id uuid NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'WOMPI' CHECK(provider='WOMPI'),
  provider_event_id text NOT NULL,
  provider_transaction_id text NOT NULL,
  reported_status text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT true CHECK(signature_valid),
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);
CREATE INDEX payment_events_order_idx ON public.payment_events(payment_order_id,created_at DESC);
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_orders,public.payment_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_orders TO authenticated;
GRANT ALL ON public.payment_orders,public.payment_events TO service_role;
CREATE POLICY payment_orders_tenant_read ON public.payment_orders FOR SELECT TO authenticated
  USING(public.is_platform_admin() OR jco_private.billing_owner(organization_id));
GRANT EXECUTE ON FUNCTION jco_private.billing_owner(uuid) TO authenticated;

CREATE FUNCTION public.billing_get_access(target_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_org_member(target_org) OR public.is_platform_admin())
    THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('requires_payment',b.requires_payment,'is_test',b.is_test,
    'operational',jco_private.operational_access(o.id),'status',o.status,
    'can_manage_billing',jco_private.billing_owner(o.id),'plan_id',o.plan_id,
    'permissions',coalesce((SELECT jsonb_agg(p.key) FROM public.permissions p
      WHERE public.has_org_permission(o.id,p.key)),'[]'::jsonb),
    'terms_accepted',EXISTS(SELECT 1 FROM public.license_acceptances a
      WHERE a.organization_id=o.id AND a.accepted_by=auth.uid() AND a.terms_version_id=(
        SELECT id FROM public.license_terms_versions WHERE active
        ORDER BY effective_date DESC,created_at DESC LIMIT 1)),
    'period_end',s.current_period_end,'subscription_status',s.status)
  INTO result FROM public.organizations o
  JOIN public.organization_billing_access b ON b.organization_id=o.id
  LEFT JOIN public.subscriptions s ON s.organization_id=o.id WHERE o.id=target_org;
  RETURN result;
END;
$$;

CREATE FUNCTION public.billing_accept_terms(target_org uuid,target_terms uuid,user_agent text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE terms public.license_terms_versions%ROWTYPE; license_id uuid;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=target_org FOR UPDATE;
  IF NOT jco_private.billing_owner(target_org) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO terms FROM public.license_terms_versions WHERE active
    ORDER BY effective_date DESC,created_at DESC LIMIT 1;
  IF terms.id IS NULL OR terms.id IS DISTINCT FROM target_terms THEN RAISE EXCEPTION 'Terms changed; reload'; END IF;
  SELECT id INTO license_id FROM public.organization_licenses WHERE organization_id=target_org;
  IF license_id IS NULL THEN
    INSERT INTO public.organization_licenses(organization_id,license_type,status)
      VALUES(target_org,'SAAS','PENDING') RETURNING id INTO license_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.license_acceptances WHERE organization_id=target_org
      AND terms_version_id=terms.id AND accepted_by=auth.uid()) THEN
    INSERT INTO public.license_acceptances(organization_id,organization_license_id,terms_version_id,
      accepted_by,terms_snapshot,acceptance_user_agent)
    VALUES(target_org,license_id,terms.id,auth.uid(),terms.terms_markdown,left(user_agent,512));
  END IF;
END;
$$;
REVOKE INSERT,UPDATE,DELETE ON public.license_acceptances FROM anon,authenticated;

CREATE FUNCTION public.billing_create_order(target_org uuid,target_plan uuid,target_environment text,request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org public.organizations%ROWTYPE; account public.organization_billing_access%ROWTYPE;
  plan public.plans%ROWTYPE; settings public.billing_activation_settings%ROWTYPE;
  terms_id uuid; order_row public.payment_orders%ROWTYPE; keys text[];
BEGIN
  SELECT * INTO org FROM public.organizations WHERE id=target_org FOR UPDATE;
  IF request_key IS NULL OR NOT jco_private.billing_owner(target_org)
    THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=target_org;
  SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;
  IF org.status NOT IN ('ACTIVE','TRIAL') THEN RAISE EXCEPTION 'Organization suspended or inactive'; END IF;
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
      (s.status='ACTIVE' AND s.current_period_end>now() AND s.plan_id<>target_plan)))
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
$$;

CREATE OR REPLACE FUNCTION public.process_verified_payment_event(
  p_reference text,p_transaction_id text,p_amount_in_cents bigint,p_currency text,
  p_status text,p_environment text,p_event_id text,p_payload_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payment public.payment_orders%ROWTYPE; org public.organizations%ROWTYPE;
  account public.organization_billing_access%ROWTYPE; existing public.subscriptions%ROWTYPE;
  settings public.billing_activation_settings%ROWTYPE; start_at timestamptz; end_at timestamptz;
  reason text; prior_event public.payment_events%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('APPROVED','DECLINED','VOIDED','ERROR')
    OR p_event_id IS NULL OR p_event_id !~ '^[a-f0-9]{64}$'
    OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR nullif(p_transaction_id,'') IS NULL THEN RETURN 'mismatch'; END IF;
  SELECT * INTO payment FROM public.payment_orders WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF payment.environment IS DISTINCT FROM p_environment OR payment.amount_in_cents IS DISTINCT FROM p_amount_in_cents
    OR payment.currency IS DISTINCT FROM p_currency OR (payment.provider_transaction_id IS NOT NULL
      AND payment.provider_transaction_id<>p_transaction_id) THEN RETURN 'mismatch'; END IF;
  SELECT * INTO prior_event FROM public.payment_events WHERE provider='WOMPI' AND provider_event_id=p_event_id;
  IF FOUND THEN
    IF prior_event.payment_order_id=payment.id AND prior_event.provider_transaction_id=p_transaction_id
      AND prior_event.reported_status=p_status THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;
  -- Approved payments are immutable. Reversal events go to reconciliation.
  IF payment.status<>'PENDING' THEN RETURN 'conflict'; END IF;
  SELECT * INTO org FROM public.organizations WHERE id=payment.organization_id FOR UPDATE;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=org.id;
  SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;
  IF p_status='APPROVED' THEN
    SELECT * INTO existing FROM public.subscriptions WHERE organization_id=org.id FOR UPDATE;
    reason:=CASE
      WHEN payment.expires_at<=now() THEN 'expired_order'
      WHEN org.status NOT IN ('ACTIVE','TRIAL') THEN 'organization_inactive'
      WHEN p_environment='sandbox' AND (NOT settings.sandbox_enabled OR NOT account.is_test) THEN 'sandbox_isolation'
      WHEN p_environment='production' AND (NOT settings.production_enabled OR account.is_test) THEN 'production_disabled'
      WHEN settings.activation_mode='MANUAL' THEN 'manual_approval'
      WHEN existing.id IS NOT NULL AND (existing.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
        OR existing.status IN ('LIFETIME','SUSPENDED','CANCELLED')
        OR (existing.current_period_end>now() AND existing.plan_id IS DISTINCT FROM payment.plan_id)) THEN 'contract_review'
      WHEN EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=org.id
        AND (license_type<>'SAAS' OR status IN ('SUSPENDED','TERMINATED'))) THEN 'license_review'
      ELSE NULL END;
    IF reason IS NULL THEN
      start_at:=CASE WHEN existing.status='ACTIVE' AND existing.current_period_end>now()
        THEN existing.current_period_start ELSE now() END;
      end_at:=greatest(now(),coalesce(existing.current_period_end,now()))+
        CASE WHEN payment.billing_mode='SAAS_MONTHLY' THEN interval '1 month' ELSE interval '1 year' END;
    END IF;
  END IF;
  -- A verified payment is recorded even if its fulfillment needs review.
  INSERT INTO public.payment_events(payment_order_id,provider_event_id,provider_transaction_id,
    reported_status,payload_sha256) VALUES(payment.id,p_event_id,p_transaction_id,p_status,p_payload_sha256);
  UPDATE public.payment_orders SET status=p_status,provider_transaction_id=p_transaction_id,
    approved_at=CASE WHEN p_status='APPROVED' THEN now() END,
    fulfillment_status=CASE WHEN p_status<>'APPROVED' THEN 'NO_ACCESS' WHEN reason IS NULL THEN 'APPLIED' ELSE 'REVIEW_REQUIRED' END,
    review_reason=reason,updated_at=now() WHERE id=payment.id;
  IF p_status='APPROVED' AND reason IS NULL THEN
    INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
      VALUES(org.id,payment.plan_id,'ACTIVE',payment.billing_mode,start_at,end_at)
      ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='ACTIVE',billing_mode=excluded.billing_mode,
        current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
        cancelled_at=NULL,updated_at=now();
    INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
      VALUES(org.id,'SAAS','ACTIVE',start_at,end_at) ON CONFLICT(organization_id) DO UPDATE SET
        status='ACTIVE',starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
    UPDATE public.organization_billing_access SET requires_payment=true,allowed_permissions=payment.permission_keys,
      manual_access_until=NULL,updated_at=now() WHERE organization_id=org.id;
    UPDATE public.organizations SET status='ACTIVE',plan_id=payment.plan_id,updated_at=now() WHERE id=org.id;
    INSERT INTO public.audit_log(organization_id,action,entity_type,entity_id,metadata)
      VALUES(org.id,'billing.payment_activated','payment_order',payment.id,
        jsonb_build_object('plan_id',payment.plan_id,'environment',p_environment,'period_end',end_at));
  END IF;
  RETURN 'processed';
END;
$$;

CREATE FUNCTION public.billing_admin_action(target_org uuid,action text,reason text,target_plan uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan public.plans%ROWTYPE; end_at timestamptz; keys text[];
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF reason IS NULL OR length(trim(reason))<10 OR length(reason)>1000 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=target_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found'; END IF;
  IF action='SUSPEND' THEN
    UPDATE public.organizations SET status='SUSPENDED',updated_at=now() WHERE id=target_org;
  ELSIF action='MARK_TEST' THEN
    IF EXISTS(SELECT 1 FROM public.organization_billing_access WHERE organization_id=target_org AND
      (NOT requires_payment OR manual_access_until>now())) OR EXISTS(SELECT 1 FROM public.subscriptions
        WHERE organization_id=target_org AND status='ACTIVE') THEN RAISE EXCEPTION 'Only unactivated tenants can become test tenants'; END IF;
    UPDATE public.organization_billing_access SET is_test=true,updated_at=now() WHERE organization_id=target_org;
  ELSIF action='APPROVE' THEN
    SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active AND billing_cycle IN ('MONTHLY','ANNUAL');
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an available monthly or annual plan'; END IF;
    IF EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=target_org AND license_type<>'SAAS')
      THEN RAISE EXCEPTION 'Dedicated licenses require a separate contract'; END IF;
    SELECT array_agg(substr(feature_key,12)) INTO keys FROM public.plan_features
      WHERE plan_id=target_plan AND enabled AND feature_key LIKE 'permission:%';
    IF coalesce(cardinality(keys),0)=0 THEN RAISE EXCEPTION 'Plan permissions not configured'; END IF;
    end_at:=now()+CASE WHEN plan.billing_cycle='MONTHLY' THEN interval '1 month' ELSE interval '1 year' END;
    UPDATE public.organization_billing_access SET manual_access_until=end_at,allowed_permissions=keys,
      updated_at=now() WHERE organization_id=target_org;
    UPDATE public.organizations SET status='ACTIVE',plan_id=target_plan,updated_at=now() WHERE id=target_org;
  ELSE RAISE EXCEPTION 'Unsupported administrative action'; END IF;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(target_org,auth.uid(),'billing.admin_'||lower(action),'organization',target_org,
      jsonb_build_object('reason',trim(reason),'plan_id',target_plan));
END;
$$;

CREATE FUNCTION public.billing_admin_set_mode(mode text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF mode IS NULL OR mode NOT IN ('MANUAL','VERIFIED_PAYMENT') THEN RAISE EXCEPTION 'Invalid mode'; END IF;
  UPDATE public.billing_activation_settings SET activation_mode=mode,updated_at=now() WHERE id=true;
  INSERT INTO public.audit_log(actor_user_id,action,entity_type,metadata)
    VALUES(auth.uid(),'billing.activation_mode_changed','platform',jsonb_build_object('mode',mode));
END;
$$;

-- Remove the old, unaudited path; the browser now uses billing_admin_action.
REVOKE ALL ON FUNCTION public.platform_set_subscription(uuid,text,text,text) FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.billing_get_access(uuid),public.billing_accept_terms(uuid,uuid,text),
  public.billing_create_order(uuid,uuid,text,uuid),public.billing_admin_action(uuid,text,text,uuid),
  public.billing_admin_set_mode(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_get_access(uuid),public.billing_accept_terms(uuid,uuid,text),
  public.billing_create_order(uuid,uuid,text,uuid),public.billing_admin_action(uuid,text,text,uuid),
  public.billing_admin_set_mode(text) TO authenticated;
REVOKE ALL ON FUNCTION public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_verified_payment_event(text,text,bigint,text,text,text,text,text) TO service_role;

-- Storage uses the object path, never the organization's display name.
-- Remove the legacy image write rules that authorized any signed-in user.
DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Permitir eliminar imagenes a usuarios autenticados" ON storage.objects;
    DROP POLICY IF EXISTS "Permitir subir imagenes a usuarios autenticados" ON storage.objects;
    DROP POLICY IF EXISTS org_docs_storage_select ON storage.objects;
    DROP POLICY IF EXISTS org_docs_storage_insert ON storage.objects;
    DROP POLICY IF EXISTS org_docs_storage_delete ON storage.objects;
    CREATE POLICY org_docs_storage_select ON storage.objects FOR SELECT TO authenticated
      USING(bucket_id='organization-documents' AND EXISTS(SELECT 1 FROM public.organizations o
        WHERE o.id::text=split_part(objects.name,'/',1) AND public.has_org_permission(o.id,'documents.view')));
    CREATE POLICY org_docs_storage_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK(bucket_id='organization-documents' AND EXISTS(SELECT 1 FROM public.organizations o
        WHERE o.id::text=split_part(objects.name,'/',1) AND public.has_org_permission(o.id,'documents.upload')));
    CREATE POLICY org_docs_storage_delete ON storage.objects FOR DELETE TO authenticated
      USING(bucket_id='organization-documents' AND EXISTS(SELECT 1 FROM public.organizations o
        WHERE o.id::text=split_part(objects.name,'/',1) AND public.has_org_permission(o.id,'documents.delete')));
    CREATE POLICY jco_property_image_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK(bucket_id='propiedades' AND EXISTS(SELECT 1 FROM public.organizations o
        WHERE o.id::text=split_part(objects.name,'/',1) AND public.has_org_permission(o.id,'properties.edit')));
    CREATE POLICY jco_property_image_delete ON storage.objects FOR DELETE TO authenticated
      USING(bucket_id='propiedades' AND EXISTS(SELECT 1 FROM public.organizations o
        WHERE o.id::text=split_part(objects.name,'/',1) AND public.has_org_permission(o.id,'properties.edit')));
  END IF;
END $storage$;
NOTIFY pgrst,'reload schema';
-- Serialize tenant counters so two concurrent inserts cannot exceed a plan.
CREATE FUNCTION jco_private.enforce_plan_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account public.organization_billing_access%ROWTYPE; plan public.plans%ROWTYPE; used bigint;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=NEW.organization_id;
  IF NOT account.requires_payment THEN RETURN NEW; END IF;
  SELECT p.* INTO plan FROM public.plans p JOIN public.organizations o ON o.plan_id=p.id WHERE o.id=NEW.organization_id;
  IF TG_TABLE_NAME='properties' THEN
    IF plan.max_properties IS NOT NULL THEN
      SELECT count(*) INTO used FROM public.properties WHERE organization_id=NEW.organization_id AND id<>NEW.id;
      IF used>=plan.max_properties THEN RAISE EXCEPTION 'Property limit reached'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='organization_members' THEN
    IF NEW.status='ACTIVE' AND plan.max_users IS NOT NULL THEN
      SELECT count(*) INTO used FROM public.organization_members WHERE organization_id=NEW.organization_id AND status='ACTIVE' AND id<>NEW.id;
      IF used>=plan.max_users THEN RAISE EXCEPTION 'User limit reached'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION jco_private.enforce_plan_limit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER jco_property_plan_limit BEFORE INSERT OR UPDATE OF organization_id ON public.properties
  FOR EACH ROW EXECUTE FUNCTION jco_private.enforce_plan_limit();
CREATE TRIGGER jco_user_plan_limit BEFORE INSERT OR UPDATE OF status,organization_id ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION jco_private.enforce_plan_limit();

-- Billing-owner revocation and checkout share the same organization lock.
CREATE FUNCTION jco_private.serialize_billing_authorization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_org uuid; new_org uuid;
BEGIN
  IF TG_TABLE_NAME='member_roles' THEN
    IF TG_OP<>'INSERT' THEN
      SELECT organization_id INTO old_org FROM public.organization_members WHERE id=OLD.organization_member_id;
    END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT organization_id INTO new_org FROM public.organization_members WHERE id=NEW.organization_member_id;
    END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN old_org:=OLD.organization_id; END IF;
    IF TG_OP<>'DELETE' THEN new_org:=NEW.organization_id; END IF;
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=old_org OR id=new_org ORDER BY id FOR UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION jco_private.serialize_billing_authorization() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER jco_billing_auth_lock BEFORE INSERT OR UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION jco_private.serialize_billing_authorization();
CREATE TRIGGER jco_billing_auth_lock BEFORE INSERT OR UPDATE OR DELETE ON public.member_roles
  FOR EACH ROW EXECUTE FUNCTION jco_private.serialize_billing_authorization();
CREATE TRIGGER jco_billing_auth_lock BEFORE INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION jco_private.serialize_billing_authorization();
COMMIT;
