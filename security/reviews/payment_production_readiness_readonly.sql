-- READ ONLY. Safe to run on the official project before deploying payment migrations.
-- Returns structured blockers, never changes business data.
WITH checks AS (
 SELECT 'payment_orders_table' AS check_name,
   to_regclass('public.payment_orders') IS NOT NULL AS ready,
   'Apply migration 0026 in staging before production' AS action
 UNION ALL SELECT 'payment_events_table',
   to_regclass('public.payment_events') IS NOT NULL,
   'Apply migration 0026 in staging before production'
 UNION ALL SELECT 'subscriptions_org_unique',
   EXISTS (
     SELECT 1 FROM pg_constraint
     WHERE conrelid='public.subscriptions'::regclass
       AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (organization_id)'
   ), '0028 requires one subscription per organization'
 UNION ALL SELECT 'paid_cop_monthly_plan',
   EXISTS (SELECT 1 FROM public.plans
     WHERE active AND currency='COP' AND billing_cycle='MONTHLY' AND price>0),
   'Configure a commercial COP monthly price after approval'
 UNION ALL SELECT 'paid_cop_annual_plan',
   EXISTS (SELECT 1 FROM public.plans
     WHERE active AND currency='COP' AND billing_cycle='ANNUAL' AND price>0),
   'Configure a commercial COP annual price after approval'
)
SELECT check_name,ready,action FROM checks ORDER BY check_name;
