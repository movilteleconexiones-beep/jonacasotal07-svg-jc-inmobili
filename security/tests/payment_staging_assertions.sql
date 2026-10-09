-- Execute only after fixture and migrations 0026, 0027, 0028 in isolated DB.
DO $$
DECLARE r text;
BEGIN
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 BEGIN
  PERFORM public.process_verified_payment_event('ORDER_TEST_0001','tx1',100000,'COP',
   'APPROVED','sandbox','event1',repeat('a',64));
  RAISE EXCEPTION 'SECURITY FAILURE: authenticated role could call RPC';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'SECURITY FAILURE:%' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 INSERT INTO public.payment_orders(organization_id,plan_id,billing_mode,reference,
  amount_in_cents,expires_at)
 VALUES ('22222222-2222-4222-8222-222222222222',
 '11111111-1111-4111-8111-111111111111','SAAS_MONTHLY','ORDER_TEST_0001',100000,now()+interval '1 day');

 r:=public.process_verified_payment_event('ORDER_TEST_0001','tx1',100000,'COP',
   'APPROVED','sandbox','event1',repeat('a',64));
 IF r <> 'processed' THEN RAISE EXCEPTION 'Expected processed, got %',r; END IF;
 IF (SELECT count(*) FROM public.subscriptions WHERE organization_id=
  '22222222-2222-4222-8222-222222222222' AND status='ACTIVE') <> 1
 THEN RAISE EXCEPTION 'Subscription not activated'; END IF;
 IF (SELECT count(*) FROM public.subscriptions WHERE organization_id=
  '33333333-3333-4333-8333-333333333333') <> 0
 THEN RAISE EXCEPTION 'Cross tenant subscription activated'; END IF;

 r:=public.process_verified_payment_event('ORDER_TEST_0001','tx1',100000,'COP',
   'APPROVED','sandbox','event1',repeat('a',64));
 IF r <> 'duplicate' THEN RAISE EXCEPTION 'Expected duplicate, got %',r; END IF;
 IF (SELECT count(*) FROM public.payment_events) <> 1
 THEN RAISE EXCEPTION 'Duplicate event inserted'; END IF;

 INSERT INTO public.payment_orders(organization_id,plan_id,billing_mode,reference,
  amount_in_cents,expires_at)
 VALUES ('33333333-3333-4333-8333-333333333333',
 '11111111-1111-4111-8111-111111111111','SAAS_MONTHLY','ORDER_TEST_0002',100000,now()+interval '1 day');
 r:=public.process_verified_payment_event('ORDER_TEST_0002','tx2',99999,'COP',
   'APPROVED','sandbox','event2',repeat('b',64));
 IF r <> 'mismatch' THEN RAISE EXCEPTION 'Wrong amount accepted: %',r; END IF;
 IF (SELECT count(*) FROM public.subscriptions) <> 1
 THEN RAISE EXCEPTION 'Mismatched payment activated tenant'; END IF;
 -- A paid event must not reactivate a suspended organization.
 UPDATE public.organizations SET status='SUSPENDED'
 WHERE id='33333333-3333-4333-8333-333333333333';
 r:=public.process_verified_payment_event('ORDER_TEST_0002','tx2',100000,'COP',
   'APPROVED','sandbox','event3',repeat('c',64));
 IF r <> 'organization_inactive' THEN
   RAISE EXCEPTION 'Suspended organization was not blocked: %',r;
 END IF;
 IF (SELECT status FROM public.organizations
    WHERE id='33333333-3333-4333-8333-333333333333') <> 'SUSPENDED'
 THEN RAISE EXCEPTION 'Suspended organization reactivated'; END IF;
 IF (SELECT count(*) FROM public.payment_events) <> 1
 THEN RAISE EXCEPTION 'Suspended organization payment event recorded'; END IF;
 -- An APPROVED event for an expired order cannot grant a subscription.
 INSERT INTO public.payment_orders(organization_id,plan_id,billing_mode,reference,
  amount_in_cents,expires_at)
 VALUES ('33333333-3333-4333-8333-333333333333',
 '11111111-1111-4111-8111-111111111111','SAAS_MONTHLY','ORDER_TEST_EXPIRED',100000,now()-interval '1 hour');
 UPDATE public.organizations SET status='ACTIVE'
 WHERE id='33333333-3333-4333-8333-333333333333';
 r:=public.process_verified_payment_event('ORDER_TEST_EXPIRED','tx_expired',100000,'COP',
   'APPROVED','sandbox','event_expired',repeat('d',64));
 IF r <> 'expired_order' THEN RAISE EXCEPTION 'Expired order accepted: %',r; END IF;
 IF EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=
   '33333333-3333-4333-8333-333333333333')
 THEN RAISE EXCEPTION 'Expired order activated subscription'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_events WHERE provider_event_id='event_expired')
 THEN RAISE EXCEPTION 'Expired order incorrectly recorded as processed'; END IF;
 RAISE NOTICE 'Payment PostgreSQL integration checks passed';
END $$;
