DO $$
DECLARE
 v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM public.plans;
 IF v_count <> 7 THEN RAISE EXCEPTION 'Expected 7 plans, got %',v_count; END IF;
 IF EXISTS (
   SELECT 1 FROM (VALUES
    ('BASIC','MONTHLY',104900::numeric),
    ('PRO','MONTHLY',194900::numeric),
    ('ENTERPRISE','MONTHLY',389900::numeric),
    ('BASIC_ANNUAL','ANNUAL',1039000::numeric),
    ('PRO_ANNUAL','ANNUAL',1949000::numeric),
    ('ENTERPRISE_ANNUAL','ANNUAL',3899000::numeric),
    ('LIFETIME','ONE_TIME',6490000::numeric)
   ) AS expected(code,cycle,amount)
   LEFT JOIN public.plans p ON p.code=expected.code
   WHERE p.code IS NULL OR p.billing_cycle<>expected.cycle
     OR p.price<>expected.amount OR p.currency<>'COP'
 ) THEN RAISE EXCEPTION 'Approved COP catalog does not match expected prices'; END IF;
 RAISE NOTICE 'Approved COP pricing catalog: 7/7 verified';
END $$;
