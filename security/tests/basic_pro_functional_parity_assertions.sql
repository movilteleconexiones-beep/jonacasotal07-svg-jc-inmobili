DO $$
BEGIN
 IF (SELECT count(*) FROM public.plan_features WHERE enabled AND plan_id=(SELECT id FROM public.plans WHERE code='BASIC'))<>47
 OR (SELECT count(*) FROM public.plan_features WHERE enabled AND plan_id=(SELECT id FROM public.plans WHERE code='PRO'))<>47
 THEN RAISE EXCEPTION 'Feature parity failed'; END IF;
 IF EXISTS (
  (SELECT feature_key FROM public.plan_features WHERE enabled AND plan_id=(SELECT id FROM public.plans WHERE code='BASIC')
   EXCEPT SELECT feature_key FROM public.plan_features WHERE enabled AND plan_id=(SELECT id FROM public.plans WHERE code='PRO'))
  UNION ALL
  (SELECT feature_key FROM public.plan_features WHERE enabled AND plan_id=(SELECT id FROM public.plans WHERE code='PRO')
   EXCEPT SELECT feature_key FROM public.plan_features WHERE enabled AND plan_id=(SELECT id FROM public.plans WHERE code='BASIC'))
 ) THEN RAISE EXCEPTION 'Mismatched Basic and Pro features'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.plans WHERE code='BASIC' AND price=129900 AND currency='COP'
   AND max_users=5 AND max_properties=200 AND max_storage_mb=2048 AND ai_credits=250)
 OR NOT EXISTS(SELECT 1 FROM public.plans WHERE code='PRO' AND price=299900 AND currency='COP'
   AND max_users=25 AND max_properties=2000 AND max_storage_mb=10240 AND ai_credits=2000)
 THEN RAISE EXCEPTION 'Prices or resource quotas changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.plans WHERE code='LIFETIME' AND billing_cycle='ONE_TIME' AND price=0 AND currency='USD')
 THEN RAISE EXCEPTION 'Lifetime plan modified'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_activation_settings WHERE sandbox_enabled OR production_enabled)
 THEN RAISE EXCEPTION 'Payment switches modified'; END IF;
END $$;
