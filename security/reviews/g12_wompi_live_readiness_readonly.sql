-- G12 / #203: Wompi LIVE production readiness — DATA-ONLY, NEVER CHARGES.
-- Execute only against official project cuitgyqrjibgwuniapmk via read-only DB connection.
-- Unknown external/legal evidence is intentionally NULL => NOT VERIFIED, never PASS.
-- NO CREATE/UPDATE/INSERT/DELETE/GRANT/REVOKE/COMMIT, no credentials, no PII.
BEGIN READ ONLY;
WITH checks AS (
  SELECT 10 AS position,'billing_tables'::text AS check_name,
     (to_regclass('public.payment_orders') IS NOT NULL
      AND to_regclass('public.payment_events') IS NOT NULL
      AND to_regclass('public.subscriptions') IS NOT NULL) AS passed,
     'Órdenes, eventos y suscripciones instalados'::text AS evidence
  UNION ALL SELECT 20,'verified_payment_rpc_restricted',
     (to_regprocedure('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)') IS NOT NULL
      AND has_function_privilege('service_role','public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)','EXECUTE')
      AND NOT has_function_privilege('anon','public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)','EXECUTE')),
     'Solo service_role puede aplicar un pago'
  UNION ALL SELECT 30,'basic_professional_prices_cop',
     (SELECT count(DISTINCT code)=2 FROM public.plans
       WHERE code IN ('BASIC','PRO') AND active=true AND billing_cycle='MONTHLY'
         AND currency='COP' AND price>0 AND price*100=trunc(price*100)),
     'Dos planes mensuales comerciales COP, precio definido por servidor'
  UNION ALL SELECT 40,'active_license_terms',
     (SELECT count(*)=1 FROM public.license_terms_versions WHERE active=true),
     'Exactamente una versión activa de términos de licencia'
  UNION ALL SELECT 50,'one_time_perpetual_excluded_from_checkout',
     (SELECT count(*)=0 FROM public.plans
       WHERE code IN ('LIFETIME','ENTERPRISE') AND active=true
         AND price>0 AND billing_cycle IN('MONTHLY','ANNUAL')),
     'Las licencias perpetuas no generan checkout periódico'
  UNION ALL SELECT 60,'commercial_activation_switch_on',
     (SELECT production_enabled AND activation_mode='VERIFIED_PAYMENT'
       FROM public.billing_activation_settings WHERE id=true),
     'Activa solo después de comprobar jurídicos, comercio y primer piloto'
  UNION ALL SELECT 70,'no_live_orders_created_yet',
     (SELECT count(*)=0 FROM public.payment_orders WHERE environment='production'),
     'Dato histórico: cero órdenes reales; no es evidencia de una compra real'
  UNION ALL SELECT 80,'eligible_new_buyer_for_controlled_pilot',
     (SELECT count(*)>0 FROM public.organizations o
       JOIN public.organization_billing_access b ON b.organization_id=o.id
       WHERE b.is_test=false AND o.status IN('ACTIVE','INACTIVE','TRIAL')
         AND NOT EXISTS(SELECT 1 FROM public.subscriptions s
           WHERE s.organization_id=o.id AND s.status='LIFETIME')),
     'Se necesita organización compradora real distinta a la vitalicia SuperAdmin'
  UNION ALL SELECT 90,'live_merchant_credentials_same_account',
     NULL::boolean,'NO VERIFICADO: cuatro secretos prod del MISMO comercio; no exponer valores'
  UNION ALL SELECT 100,'live_webhook_dashboard_registration',
     NULL::boolean,'NO VERIFICADO: Wompi dashboard PROD debe enviar eventos firmados al endpoint billing-production/events'
  UNION ALL SELECT 110,'approved_public_legal_policies',
     NULL::boolean,'NO VERIFICADO: política y condiciones definitivas aprobadas, publicadas y consentimiento auditable'
  UNION ALL SELECT 120,'real_paid_transaction_applied',
     (SELECT count(*)>0 FROM public.payment_orders
       WHERE environment='production' AND status='APPROVED' AND fulfillment_status='APPLIED'),
     'Pago auténtico confirmado por API Wompi; activación única y conciliada'
)
SELECT check_name,
  CASE WHEN passed IS TRUE THEN 'PASS'
       WHEN passed IS FALSE THEN 'FAIL'
       ELSE 'NOT_VERIFIED' END AS result,
  evidence
FROM checks ORDER BY position;
ROLLBACK;
