-- Approved 2026 COP catalog and permissions; no live charging is enabled.
BEGIN;


UPDATE public.plans SET
  name = 'JCO Básico',
  description = 'Plan Básico mensual. Límites y funciones sujetos a validación de producto.',
  billing_cycle = 'MONTHLY', price = 104900, currency = 'COP',
  updated_at = now()
WHERE code = 'BASIC';

UPDATE public.plans SET
  name = 'JCO Profesional',
  description = 'Plan Profesional mensual. Límites y funciones sujetos a validación de producto.',
  billing_cycle = 'MONTHLY', price = 194900, currency = 'COP',
  updated_at = now()
WHERE code = 'PRO';

UPDATE public.plans SET
  name = 'JCO Empresarial',
  description = 'Plan Empresarial mensual desde este precio; servicios personalizados por contrato.',
  billing_cycle = 'MONTHLY', price = 389900, currency = 'COP',
  updated_at = now()
WHERE code = 'ENTERPRISE';

UPDATE public.plans SET
  name = 'JCO Vitalicio',
  description = 'Pago único sujeto a contrato y aceptación legal; mantenimiento por separado. No activación automática.',
  billing_cycle = 'ONE_TIME', price = 6490000, currency = 'COP',
  updated_at = now()
WHERE code = 'LIFETIME';

INSERT INTO public.plans (code,name,description,billing_cycle,price,currency,active)
VALUES
  ('BASIC_ANNUAL','JCO Básico Anual','Suscripción anual JCO Básico.','ANNUAL',1039000,'COP',true),
  ('PRO_ANNUAL','JCO Profesional Anual','Suscripción anual JCO Profesional.','ANNUAL',1949000,'COP',true),
  ('ENTERPRISE_ANNUAL','JCO Empresarial Anual','Suscripción anual JCO Empresarial, desde este precio.','ANNUAL',3899000,'COP',true)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  billing_cycle=EXCLUDED.billing_cycle,
  price=EXCLUDED.price,
  currency=EXCLUDED.currency,
  updated_at=now();

-- Do not alter organizations, subscriptions, licenses or customer records.

-- Annual plans share the approved monthly plan limits.
UPDATE public.plans a SET max_users=m.max_users,max_properties=m.max_properties,
 max_storage_mb=m.max_storage_mb,ai_credits=m.ai_credits
FROM public.plans m WHERE a.code=m.code||'_ANNUAL';
-- Module grants are entitlements, never platform administrator roles.
INSERT INTO public.plan_features(plan_id,feature_key,enabled)
SELECT pl.id,'permission:'||p.key,true FROM public.plans pl CROSS JOIN public.permissions p
WHERE pl.code IN ('BASIC','BASIC_ANNUAL','PRO','PRO_ANNUAL','ENTERPRISE','ENTERPRISE_ANNUAL')
 AND (
  p.key ~ '^(properties|clients|leads|appointments|deals|users|roles|settings)\.'
  OR (pl.code NOT IN ('BASIC','BASIC_ANNUAL') AND p.key ~ '^(documents|owners|commissions|reports)\.'))
ON CONFLICT(plan_id,feature_key) DO NOTHING;
-- Preserve commercial fields on the principal organization and all existing contracts.
COMMIT;
