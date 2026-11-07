-- Restricted, audited reconciliation of previously VERIFIED Wompi sandbox
-- trial payments that were blocked by the old PRO-TRIAL -> BASIC rule.
-- Deliberately NOT exposed to anon, authenticated or service_role.
-- Must be invoked as postgres by an authorized operator after review.
BEGIN;

CREATE OR REPLACE FUNCTION jco_private.reconcile_verified_sandbox_trial_payment(
  target_order uuid,
  reconciliation_reason text
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $reconcile$
DECLARE
  payment public.payment_orders%ROWTYPE;
  org public.organizations%ROWTYPE;
  account public.organization_billing_access%ROWTYPE;
  existing public.subscriptions%ROWTYPE;
  license public.organization_licenses%ROWTYPE;
  settings public.billing_activation_settings%ROWTYPE;
  plan public.plans%ROWTYPE;
  signed_event public.payment_events%ROWTYPE;
  period_start timestamptz;
  period_end timestamptz;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Restricted operator only' USING ERRCODE = '42501';
  END IF;
  IF reconciliation_reason IS NULL
     OR length(btrim(reconciliation_reason)) < 20
     OR length(reconciliation_reason) > 500 THEN
    RAISE EXCEPTION 'A specific reconciliation reason (20-500 characters) is required';
  END IF;

  -- Lock the payment FIRST: concurrent reconciliations serialize here.
  SELECT * INTO payment FROM public.payment_orders
    WHERE id = target_order FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF payment.status = 'APPROVED'
     AND payment.fulfillment_status = 'APPLIED' THEN
    RETURN 'already_applied';
  END IF;
  IF payment.environment <> 'sandbox'
     OR payment.status <> 'APPROVED'
     OR payment.fulfillment_status <> 'REVIEW_REQUIRED'
     OR payment.review_reason <> 'contract_review'
     OR payment.provider <> 'WOMPI'
     OR payment.currency <> 'COP'
     OR payment.billing_mode NOT IN ('SAAS_MONTHLY', 'SAAS_ANNUAL')
     OR payment.provider_transaction_id IS NULL
     OR payment.approved_at IS NULL
     OR payment.approved_at > payment.expires_at
     OR payment.approved_at + interval '1 month' <= now()
     OR payment.terms_version_id IS NULL
     OR payment.permission_keys IS NULL
  THEN
    RAISE EXCEPTION 'Order is not an eligible verified sandbox trial payment';
  END IF;

  SELECT * INTO org FROM public.organizations
    WHERE id = payment.organization_id FOR UPDATE;
  SELECT * INTO account FROM public.organization_billing_access
    WHERE organization_id = payment.organization_id FOR UPDATE;
  SELECT * INTO existing FROM public.subscriptions
    WHERE organization_id = payment.organization_id FOR UPDATE;
  SELECT * INTO license FROM public.organization_licenses
    WHERE organization_id = payment.organization_id FOR UPDATE;
  SELECT * INTO settings FROM public.billing_activation_settings
    WHERE id = true;
  SELECT * INTO plan FROM public.plans WHERE id = payment.plan_id;

  IF org.id IS NULL OR org.status NOT IN ('ACTIVE', 'TRIAL', 'INACTIVE')
     OR account.organization_id IS NULL
     OR NOT account.is_test OR NOT account.requires_payment
     OR settings.id IS NULL OR NOT settings.sandbox_enabled
     OR settings.production_enabled OR settings.activation_mode <> 'VERIFIED_PAYMENT'
     OR plan.id IS NULL OR NOT plan.active OR plan.code NOT IN ('BASIC','PRO')
     OR plan.currency <> payment.currency
     OR payment.amount_in_cents <> (plan.price * 100)::bigint
     OR existing.id IS NULL OR existing.status <> 'TRIAL'
     OR existing.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
     OR license.id IS NULL OR license.license_type <> 'SAAS'
     OR license.status <> 'ACTIVE'
  THEN
    RAISE EXCEPTION 'Organization, commercial terms or subscription are not eligible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.license_acceptances la
    WHERE la.organization_id = org.id
      AND la.organization_license_id = license.id
      AND la.terms_version_id = payment.terms_version_id
      AND la.accepted_at <= payment.approved_at
  ) THEN
    RAISE EXCEPTION 'Original license acceptance could not be verified';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_orders p
    WHERE p.organization_id = org.id AND p.id <> payment.id
      AND p.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Other approved order requires manual review';
  END IF;

  SELECT * INTO signed_event FROM public.payment_events pe
    WHERE pe.payment_order_id = payment.id
      AND pe.provider = 'WOMPI'
      AND pe.reported_status = 'APPROVED'
      AND pe.signature_valid
      AND pe.provider_transaction_id = payment.provider_transaction_id
      AND pe.payload_sha256 ~ '^[a-f0-9]{64}$'
      AND pe.provider_event_id ~ '^[a-f0-9]{64}$'
    ORDER BY pe.created_at LIMIT 1;
  IF signed_event.id IS NULL OR
     (SELECT count(*) FROM public.payment_events e WHERE e.payment_order_id=payment.id) <> 1
  THEN
    RAISE EXCEPTION 'Signed and unique Wompi event was not found';
  END IF;

  -- Historical entitlement begins at the ORIGINAL verified approval timestamp.
  -- Do not extend a paid month with free TRIAL days or issue a second payment.
  period_start := payment.approved_at;
  period_end := period_start + CASE
    WHEN payment.billing_mode = 'SAAS_MONTHLY'
      THEN interval '1 month' ELSE interval '1 year' END;

  UPDATE public.subscriptions
    SET plan_id = payment.plan_id,
        status = 'ACTIVE',
        billing_mode = payment.billing_mode,
        started_at = period_start,
        current_period_start = period_start,
        current_period_end = period_end,
        trial_ends_at = NULL,
        cancelled_at = NULL,
        updated_at = now()
    WHERE id = existing.id;

  UPDATE public.organization_licenses
    SET status = 'ACTIVE', starts_at = period_start,
        ends_at = period_end, updated_at = now()
    WHERE id = license.id;

  UPDATE public.organization_billing_access
    SET requires_payment = true,
        allowed_permissions = payment.permission_keys,
        manual_access_until = NULL,
        updated_at = now()
    WHERE organization_id = org.id;

  UPDATE public.organizations
    SET status = 'ACTIVE', plan_id = payment.plan_id, updated_at = now()
    WHERE id = org.id;

  UPDATE public.payment_orders
    SET fulfillment_status = 'APPLIED', review_reason = NULL,
        updated_at = now()
    WHERE id = payment.id AND status = 'APPROVED'
      AND fulfillment_status = 'REVIEW_REQUIRED';

  INSERT INTO public.audit_log (organization_id,action,entity_type,entity_id,metadata)
    VALUES (org.id,'billing.sandbox_trial_reconciled','payment_order',payment.id,
      jsonb_build_object(
        'prior_fulfillment', 'REVIEW_REQUIRED',
        'prior_review_reason', 'contract_review',
        'environment','sandbox',
        'signed_event_id',signed_event.id,
        'plan_id', payment.plan_id,
        'period_start',period_start,
        'period_end',period_end,
        'reason',btrim(reconciliation_reason),
        'operator',current_user
      ));

  RETURN 'applied';
END;
$reconcile$;

REVOKE ALL ON FUNCTION jco_private.reconcile_verified_sandbox_trial_payment(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
-- postgres (function owner) retains execution privileges.
COMMIT;
