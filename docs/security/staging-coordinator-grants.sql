-- PROPUESTA NO APLICADA. Ejecutar únicamente después de respaldo/restauración
-- comprobados (#214), conciliación de migraciones (#104) y ensayo en staging.
-- Habilita cobros ordinarios a coordinadores activos (MANAGER), sin tocar AGENT.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE key='rent_payments.create')
     OR NOT EXISTS (SELECT 1 FROM public.permissions WHERE key='rent_payments.view') THEN
    RAISE EXCEPTION 'Missing required rent_payments permissions';
  END IF;
END $$;
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM public.roles r
JOIN public.permissions p ON p.key IN ('rent_payments.create','rent_payments.view')
WHERE r.key='MANAGER' AND r.active AND r.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id=r.id AND rp.permission_id=p.id);
-- Fail if any active AGENT role has these financial permissions.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.roles r
  JOIN public.role_permissions rp ON rp.role_id=r.id
  JOIN public.permissions p ON p.id=rp.permission_id
  WHERE r.key='AGENT' AND r.active
    AND p.key IN ('rent_payments.create','rent_payments.view')
 ) THEN RAISE EXCEPTION 'An active AGENT has unexpected rent payment permission'; END IF;
END $$;
COMMIT;
