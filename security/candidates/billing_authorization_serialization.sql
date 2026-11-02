-- DRAFT: never apply to production. This is a candidate protocol for
-- a *reviewed* Supabase staging branch after reconciling migration #104.
-- Does not enable Wompi checkout, subscriptions or production billing.
--
-- Permission writers must take the same authorization lock as order creation.
-- A BEFORE ROW trigger can run after PostgreSQL has acquired its target row
-- lock: a competing order may cause a detectable deadlock (40P01), which
-- aborts an operation rather than authorizing a stale payment order.
BEGIN;

CREATE SCHEMA IF NOT EXISTS jco_private;

-- Serialize all changes to authorization-bearing rows. Organization IDs are
-- collected from both OLD and NEW and from role memberships; this handles
-- shared roles across tenants and org changes without relying on the client.
CREATE OR REPLACE FUNCTION jco_private.lock_billing_authorization_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog'
AS $guard$
DECLARE
  v_member_ids uuid[] := ARRAY[]::uuid[];
  v_role_ids uuid[] := ARRAY[]::uuid[];
  v_org_ids uuid[] := ARRAY[]::uuid[];
  v_org uuid;
BEGIN
  IF TG_TABLE_NAME='organization_members' THEN
    IF TG_OP<>'INSERT' THEN
      v_member_ids:=array_append(v_member_ids,OLD.id);
      v_org_ids:=array_append(v_org_ids,OLD.organization_id);
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_member_ids:=array_append(v_member_ids,NEW.id);
      v_org_ids:=array_append(v_org_ids,NEW.organization_id);
    END IF;
  ELSIF TG_TABLE_NAME IN ('member_permissions','member_roles') THEN
    IF TG_OP<>'INSERT' THEN
      v_member_ids:=array_append(v_member_ids,OLD.organization_member_id);
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_member_ids:=array_append(v_member_ids,NEW.organization_member_id);
    END IF;
    IF TG_TABLE_NAME='member_roles' THEN
      IF TG_OP<>'INSERT' THEN v_role_ids:=array_append(v_role_ids,OLD.role_id); END IF;
      IF TG_OP<>'DELETE' THEN v_role_ids:=array_append(v_role_ids,NEW.role_id); END IF;
    END IF;
  ELSIF TG_TABLE_NAME='role_permissions' THEN
    IF TG_OP<>'INSERT' THEN v_role_ids:=array_append(v_role_ids,OLD.role_id); END IF;
    IF TG_OP<>'DELETE' THEN v_role_ids:=array_append(v_role_ids,NEW.role_id); END IF;
  ELSIF TG_TABLE_NAME='roles' THEN
    IF TG_OP<>'INSERT' THEN
      v_role_ids:=array_append(v_role_ids,OLD.id);
      v_org_ids:=array_append(v_org_ids,OLD.organization_id);
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_role_ids:=array_append(v_role_ids,NEW.id);
      v_org_ids:=array_append(v_org_ids,NEW.organization_id);
    END IF;
  ELSIF TG_TABLE_NAME='organizations' THEN
    IF TG_OP<>'INSERT' THEN v_org_ids:=array_append(v_org_ids,OLD.id); END IF;
    IF TG_OP<>'DELETE' THEN v_org_ids:=array_append(v_org_ids,NEW.id); END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported billing authorization mutation: %',TG_TABLE_NAME
      USING ERRCODE='42501';
  END IF;

  SELECT array_agg(DISTINCT org_id ORDER BY org_id) INTO v_org_ids FROM (
    SELECT unnest(v_org_ids) AS org_id
    UNION ALL
    SELECT m.organization_id FROM public.organization_members m
      WHERE m.id=ANY(v_member_ids)
    UNION ALL
    SELECT r.organization_id FROM public.roles r WHERE r.id=ANY(v_role_ids)
    UNION ALL
    SELECT m.organization_id FROM public.member_roles mr
      JOIN public.organization_members m ON m.id=mr.organization_member_id
      WHERE mr.role_id=ANY(v_role_ids)
  ) AS affected WHERE org_id IS NOT NULL;

  IF v_org_ids IS NOT NULL THEN
    FOREACH v_org IN ARRAY v_org_ids LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('inmojco.billing.manage'),
        pg_catalog.hashtext(v_org::text)
      );
      -- Every order uses the identical org lock for authorization reads.
      PERFORM 1 FROM public.organizations WHERE id=v_org FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown organization in billing authorization change'
          USING ERRCODE='23503';
      END IF;
    END LOOP;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION jco_private.lock_billing_authorization_mutation()
  FROM PUBLIC,anon,authenticated;

-- Lock all three mutations (INSERT/UPDATE/DELETE); a plain direct DML
-- statement or a privileged RPC modifying the tables must still serialize.
DO $triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'organizations','organization_members','member_permissions','member_roles',
    'roles','role_permissions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS jco_billing_auth_lock ON public.%I',v_table);
    EXECUTE format(
      'CREATE TRIGGER jco_billing_auth_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION jco_private.lock_billing_authorization_mutation()',v_table);
  END LOOP;
END;
$triggers$;

-- The permission catalog entry identifies the authorization itself.
-- Replacing/removing billing.manage would bypass all existing role grants.
CREATE OR REPLACE FUNCTION jco_private.guard_billing_permission_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $guard$
BEGIN
  IF TG_OP<>'INSERT' AND OLD.key='billing.manage' THEN
    IF TG_OP='DELETE' OR NEW.key IS DISTINCT FROM OLD.key
      OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'billing.manage is a protected permission'
        USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION jco_private.guard_billing_permission_catalog()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS jco_billing_permission_catalog_guard ON public.permissions;
CREATE TRIGGER jco_billing_permission_catalog_guard
BEFORE UPDATE OR DELETE ON public.permissions FOR EACH ROW
EXECUTE FUNCTION jco_private.guard_billing_permission_catalog();

-- Candidate replacement for unpublished 0032, with synchronized authorization
-- across all permission-table mutation paths. Server-derived COP prices only.
CREATE OR REPLACE FUNCTION public.create_authorized_sandbox_payment_order(
  p_organization_id uuid,p_plan_code text,p_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog'
AS $rpc$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_order_id uuid;
  v_billing_mode text;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501';
  END IF;
  IF (now() AT TIME ZONE 'America/Bogota')::date >= DATE '2027-01-01' THEN
    RAISE EXCEPTION 'Tax configuration required' USING ERRCODE='23514';
  END IF;
  IF p_reference !~ '^JCO_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Invalid order reference' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('inmojco.billing.manage'),
    pg_catalog.hashtext(p_organization_id::text)
  );
  PERFORM 1 FROM public.organizations
    WHERE id=p_organization_id AND status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inactive or unknown organization' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id=p_organization_id AND user_id=auth.uid()
      AND status='ACTIVE' FOR SHARE
  ) OR NOT public.has_org_permission(p_organization_id,'billing.manage') THEN
    RAISE EXCEPTION 'Billing permission denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_plan FROM public.plans
    WHERE code=p_plan_code AND active=true AND currency='COP'
      AND price>0 AND billing_cycle IN ('MONTHLY','ANNUAL')
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='23514'; END IF;
  v_billing_mode:=CASE WHEN v_plan.billing_cycle='MONTHLY'
    THEN 'SAAS_MONTHLY' ELSE 'SAAS_ANNUAL' END;
  INSERT INTO public.payment_orders(
    organization_id,plan_id,billing_mode,provider,environment,
    reference,amount_in_cents,currency,status,expires_at
  ) VALUES (
    p_organization_id,v_plan.id,v_billing_mode,'WOMPI','sandbox',
    p_reference,(v_plan.price*100)::bigint,'COP','PENDING',
    now()+interval '30 minutes'
  ) RETURNING id INTO v_order_id;
  RETURN v_order_id;
END;
$rpc$;
REVOKE ALL ON FUNCTION public.create_authorized_sandbox_payment_order(uuid,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_authorized_sandbox_payment_order(uuid,text,text)
  TO authenticated;
COMMIT;
