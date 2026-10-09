-- Isolated DB only. All negative cases must rollback and leave zero orders.
DO $$ BEGIN
 BEGIN
  PERFORM public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('a',32));
  RAISE EXCEPTION 'SECURITY: anonymous user accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'SECURITY:%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $$ BEGIN
 BEGIN
  PERFORM public.create_authorized_sandbox_payment_order('33333333-3333-4333-8333-333333333333','BASIC','JCO_'||repeat('b',32));
  RAISE EXCEPTION 'SECURITY: cross-tenant order accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'SECURITY:%' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','bad_ref');
  RAISE EXCEPTION 'SECURITY: malformed reference accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'SECURITY:%' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.payment_orders) <> 0 THEN RAISE EXCEPTION 'rejected order persisted'; END IF;
END $$;
DO $ DECLARE v_order_id uuid; BEGIN
 v_order_id:=public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('c',32));
 IF NOT EXISTS(SELECT 1 FROM public.payment_orders WHERE payment_orders.id=v_order_id AND amount_in_cents=10490000 AND environment='sandbox' AND status='PENDING' AND currency='COP')
 THEN RAISE EXCEPTION 'trusted plan amount or sandbox status invalid'; END IF;
 BEGIN
  PERFORM public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('c',32));
  RAISE EXCEPTION 'SECURITY: duplicate reference accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'SECURITY:%' THEN RAISE; END IF; END;
END $$;
UPDATE public.member_permissions SET effect='DENY';
DO $$ BEGIN
 BEGIN
  PERFORM public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('d',32));
  RAISE EXCEPTION 'SECURITY: explicit DENY bypassed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'SECURITY:%' THEN RAISE; END IF; END;
END $$;
UPDATE public.member_permissions SET effect='ALLOW';
UPDATE public.organization_members SET status='INACTIVE';
DO $$ BEGIN
 BEGIN
  PERFORM public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('e',32));
  RAISE EXCEPTION 'SECURITY: inactive member accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'SECURITY:%' THEN RAISE; END IF; END;
END $$;
UPDATE public.organization_members SET status='ACTIVE';
UPDATE public.organizations SET status='SUSPENDED';
DO $$ BEGIN
 BEGIN
  PERFORM public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('f',32));
  RAISE EXCEPTION 'SECURITY: suspended organization accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'SECURITY:%' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.payment_orders) <> 1 THEN RAISE EXCEPTION 'rejected orders were persisted'; END IF;
 RAISE NOTICE 'Atomic order isolated SQL checks passed';
END $$;
