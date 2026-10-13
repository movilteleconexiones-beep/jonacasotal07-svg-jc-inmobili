-- Production-safe, read-only access review for the INMOJCO billing platform.
-- Subscription purchasers may place their own orders through guarded RPCs,
-- but they cannot manage Wompi secrets, payment events, licenses or subscriptions.
SELECT c.relname AS financial_table,
 has_table_privilege('authenticated',c.oid,'INSERT') AS may_insert,
 has_table_privilege('authenticated',c.oid,'UPDATE') AS may_update,
 has_table_privilege('authenticated',c.oid,'DELETE') AS may_delete
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('payment_events','payment_orders','subscriptions','organization_licenses')
ORDER BY c.relname;
SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN
 ('plans','subscriptions','payment_orders','organization_licenses')
ORDER BY tablename,policyname;
SELECT proname,pg_get_functiondef(oid) LIKE '%is_platform_admin()%' AS platform_guarded
FROM pg_proc WHERE proname IN ('billing_admin_action','billing_admin_set_mode');
