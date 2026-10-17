-- INMOJCO Wompi Sandbox release preflight, strictly read-only.
-- Execute against the intended Supabase project; every result must be reviewed.
-- Returns aggregate booleans and counts only. No user IDs, payment references
-- or provider secrets are selected. Never run any UPDATE as a follow-up.
BEGIN TRANSACTION READ ONLY;
WITH pending AS (
 SELECT o.id AS payment_order_id, o.organization_id, o.plan_id, o.amount_in_cents,
        o.currency,o.billing_mode,o.status,o.fulfillment_status,o.review_reason,
        o.environment,o.provider,o.provider_transaction_id,o.approved_at,o.expires_at,
        o.permission_keys,o.terms_version_id,
        a.is_test,a.requires_payment,org.status AS organization_status,
        sub.status AS subscription_status,sub.billing_mode AS subscription_mode,
        sub.plan_id AS subscription_plan_id,
        sub.current_period_end, lic.license_type,lic.status AS license_status,
        p.price,p.currency AS plan_currency,p.billing_cycle,p.active AS plan_active
 FROM public.payment_orders o
 JOIN public.organizations org ON org.id=o.organization_id
 JOIN public.organization_billing_access a ON a.organization_id=o.organization_id
 JOIN public.subscriptions sub ON sub.organization_id=o.organization_id
 JOIN public.organization_licenses lic ON lic.organization_id=o.organization_id
 JOIN public.plans p ON p.id=o.plan_id
 WHERE o.environment='sandbox' AND o.status='APPROVED'
   AND o.fulfillment_status='REVIEW_REQUIRED'
   AND o.review_reason='contract_review'
),
checks AS (
 SELECT
  (SELECT count(*) FROM pending) AS reviewed_sandbox_payments,
  (SELECT count(*) FROM public.payment_events
      WHERE reported_status='APPROVED' AND signature_valid IS TRUE
         AND processed_at IS NOT NULL) AS signed_approved_events,
  (SELECT count(*) FROM public.payment_orders
      WHERE environment='production' AND status='APPROVED') AS real_approved_orders,
  (SELECT count(*) FROM public.payment_orders
      WHERE environment='sandbox' AND status='APPROVED'
        AND fulfillment_status='APPLIED') AS sandbox_applied_orders,
  coalesce(bool_and(
   is_test IS TRUE AND organization_status IN ('ACTIVE','TRIAL')
   AND subscription_status='TRIAL' AND subscription_mode IN ('SAAS_MONTHLY','SAAS_ANNUAL')
   AND subscription_plan_id IS DISTINCT FROM plan_id AND current_period_end>now()
   AND license_type='SAAS' AND license_status='ACTIVE'
   AND provider='WOMPI' AND provider_transaction_id IS NOT NULL
   AND approved_at IS NOT NULL AND approved_at<=expires_at
   AND price*100=amount_in_cents AND currency='COP' AND plan_currency=currency
   AND plan_active IS TRUE
   AND ((billing_mode='SAAS_MONTHLY' AND billing_cycle='MONTHLY')
     OR (billing_mode='SAAS_ANNUAL' AND billing_cycle='ANNUAL'))
   AND coalesce(cardinality(permission_keys),0)>0 AND terms_version_id IS NOT NULL
   AND (SELECT count(*) FROM public.payment_events e
        WHERE e.payment_order_id=payment_order_id AND e.provider='WOMPI'
           AND e.reported_status='APPROVED' AND e.signature_valid IS TRUE
           AND e.processed_at IS NOT NULL
           AND e.provider_transaction_id=provider_transaction_id)=1
   AND (SELECT count(*) FROM public.payment_events e
        WHERE e.payment_order_id=payment_order_id)=1
  ),false) AS approved_trial_conversion_safe
 FROM pending
)
SELECT reviewed_sandbox_payments,signed_approved_events,real_approved_orders,
       sandbox_applied_orders,approved_trial_conversion_safe,
       g.sandbox_enabled,g.production_enabled,g.activation_mode,
       (reviewed_sandbox_payments=1
         AND signed_approved_events=1
         AND real_approved_orders=0
         AND sandbox_applied_orders=0
         AND approved_trial_conversion_safe
         AND g.sandbox_enabled AND NOT g.production_enabled
         AND g.activation_mode='VERIFIED_PAYMENT') AS preflight_all_green
FROM checks CROSS JOIN public.billing_activation_settings g WHERE g.id=true;
ROLLBACK;
