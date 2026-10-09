-- APPROVED JCO COP CATALOG — REVIEW BEFORE APPLYING.
-- This migration is NOT automatically deployed to the official Supabase project.
-- Tax inclusion/exclusion is not yet specified; resolve before public checkout.
-- Existing plan IDs are preserved, keeping subscription foreign keys stable.
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
COMMIT;
