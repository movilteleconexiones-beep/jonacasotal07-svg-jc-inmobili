-- Read-only Wompi release preflight; execute against intended backend DB before enabling webhooks.
-- A missing function indicates that payment activation has NOT been certified.
SELECT
 to_regclass('public.payment_orders') IS NOT NULL AS orders_table,
 to_regclass('public.payment_events') IS NOT NULL AS events_table,
 to_regclass('public.subscriptions') IS NOT NULL AS subscriptions_table,
 to_regprocedure('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)') IS NOT NULL AS verified_event_rpc,
 CASE WHEN to_regprocedure('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)') IS NOT NULL
 THEN has_function_privilege('service_role','public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)','EXECUTE')
 ELSE false END AS service_role_can_execute,
 CASE WHEN to_regprocedure('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text,text)') IS NOT NULL
 THEN has_function_privilege('anon','public.process_verified_payment_event(text,text,bigint,text,text,text,text,text,text)','EXECUTE')
 ELSE false END AS anonymous_can_execute;
