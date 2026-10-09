-- Run only on isolated PostgreSQL fixture, after migration 0031.
DO $$ BEGIN
 IF public.can_create_tenant_payment_order('22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'unauthenticated accepted'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
DO $$ BEGIN
 IF NOT public.can_create_tenant_payment_order('22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'authorized member rejected'; END IF;
 IF public.can_create_tenant_payment_order('33333333-3333-4333-8333-333333333333') THEN RAISE EXCEPTION 'cross-tenant accepted'; END IF;
END $$;
UPDATE public.member_permissions SET effect='DENY';
DO $$ BEGIN
 IF public.can_create_tenant_payment_order('22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'explicit deny bypassed'; END IF;
END $$;
UPDATE public.member_permissions SET effect='ALLOW';
UPDATE public.organization_members SET status='INACTIVE';
DO $$ BEGIN
 IF public.can_create_tenant_payment_order('22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'inactive member accepted'; END IF;
END $$;
UPDATE public.organization_members SET status='ACTIVE';
UPDATE public.organizations SET status='INACTIVE';
DO $$ BEGIN
 IF public.can_create_tenant_payment_order('22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'inactive tenant accepted'; END IF;
END $$;
