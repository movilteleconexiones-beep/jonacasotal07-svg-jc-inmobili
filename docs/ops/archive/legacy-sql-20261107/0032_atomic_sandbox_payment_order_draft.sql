-- DRAFT ONLY: apply in reviewed Supabase staging after 0026, 0029, 0030 and 0031.
-- Authenticated, server-priced, atomic sandbox order creation. NO live payments.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_authorized_sandbox_payment_order(
 p_organization_id uuid, p_plan_code text, p_reference text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
 v_plan public.plans%ROWTYPE;
 v_order_id uuid;
 v_billing_mode text;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'Not authenticated';
 END IF;
 -- Never create new paid orders after the approved 2026 tax policy expires.
 IF (now() AT TIME ZONE 'America/Bogota')::date >= DATE '2027-01-01' THEN
   RAISE EXCEPTION 'Tax configuration required';
 END IF;
 IF p_reference !~ '^JCO_[a-f0-9]{32}$' THEN
   RAISE EXCEPTION 'Invalid order reference';
 END IF;
 -- Serialize with organization suspension and membership/permission revocation.
 PERFORM 1 FROM public.organizations
   WHERE id=p_organization_id AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inactive or unknown organization'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.organization_members
   WHERE organization_id=p_organization_id AND user_id=auth.uid() AND status='ACTIVE'
   FOR SHARE
 ) OR NOT public.has_org_permission(p_organization_id,'billing.manage') THEN
   RAISE EXCEPTION 'Billing permission denied';
 END IF;
 -- Billing permission must not be inferred from settings.edit or role labels.
 -- Lock explicit overrides/role assignments at the application transaction boundary
 -- before enabling this RPC in production (see release gate).
 SELECT * INTO v_plan FROM public.plans
   WHERE code=p_plan_code AND active=true AND currency='COP'
     AND price>0 AND billing_cycle IN ('MONTHLY','ANNUAL')
   FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable'; END IF;
 v_billing_mode := CASE WHEN v_plan.billing_cycle='MONTHLY'
   THEN 'SAAS_MONTHLY' ELSE 'SAAS_ANNUAL' END;
 INSERT INTO public.payment_orders(
   organization_id,plan_id,billing_mode,provider,environment,
   reference,amount_in_cents,currency,status,expires_at
 ) VALUES (
   p_organization_id,v_plan.id,v_billing_mode,'WOMPI','sandbox',
   p_reference,(v_plan.price*100)::bigint,'COP','PENDING',now()+interval '30 minutes'
 ) RETURNING id INTO v_order_id;
 RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_authorized_sandbox_payment_order(uuid,text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_authorized_sandbox_payment_order(uuid,text,text)
 TO authenticated;
COMMIT;
