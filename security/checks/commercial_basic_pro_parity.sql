-- INMOJCO #203: READ-ONLY paid SaaS catalogue contract.
-- No customer/organization/payment data is accessed. Do not modify live plans.
-- Basic and Pro have the same 47 operational capabilities; capacities differ.
-- Non-monthly legacy plans are outside this two-tier checkout scope.
WITH expected(code,users,properties) AS (
 VALUES ('BASIC',5,200), ('PRO',25,2000)
), plans_current AS (
 SELECT p.* FROM public.plans p WHERE p.active AND p.billing_cycle='MONTHLY'
), comparison AS (
 SELECT e.code, COUNT(p.id) AS matches,
   bool_and(p.max_users=e.users AND p.max_properties=e.properties
     AND p.currency='COP' AND p.price>0) AS capacity_price_ok
 FROM expected e LEFT JOIN plans_current p ON p.code=e.code
 GROUP BY e.code
), features AS (
 SELECT p.code,f.feature_key,f.enabled FROM public.plans p
 JOIN public.plan_features f ON f.plan_id=p.id
 WHERE p.active AND p.billing_cycle='MONTHLY' AND p.code IN ('BASIC','PRO')
), differences AS (
 (SELECT feature_key,enabled FROM features WHERE code='BASIC'
  EXCEPT SELECT feature_key,enabled FROM features WHERE code='PRO')
 UNION ALL
 (SELECT feature_key,enabled FROM features WHERE code='PRO'
  EXCEPT SELECT feature_key,enabled FROM features WHERE code='BASIC')
), checks AS (
 SELECT 'two_and_only_two_monthly_plans' AS check_key,
   (SELECT count(*)=2 FROM plans_current) AS ok
 UNION ALL SELECT 'basic_5_users_and_200_properties',
   (SELECT matches=1 AND capacity_price_ok IS TRUE FROM comparison WHERE code='BASIC')
 UNION ALL SELECT 'professional_25_users_and_2000_properties',
   (SELECT matches=1 AND capacity_price_ok IS TRUE FROM comparison WHERE code='PRO')
 UNION ALL SELECT 'feature_lists_identical', NOT EXISTS(SELECT 1 FROM differences)
 UNION ALL SELECT 'basic_47_enabled_features',
   (SELECT count(*)=47 AND bool_and(enabled) FROM features WHERE code='BASIC')
 UNION ALL SELECT 'professional_47_enabled_features',
   (SELECT count(*)=47 AND bool_and(enabled) FROM features WHERE code='PRO')
)
SELECT check_key,ok,CASE WHEN ok THEN 'OK' ELSE 'DRIFT' END AS verdict
FROM checks ORDER BY check_key;
