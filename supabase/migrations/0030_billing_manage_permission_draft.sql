-- DRAFT ONLY: apply to isolated PostgreSQL and reviewed Supabase staging first.
-- Add a least-privilege billing permission; do NOT grant it to existing users or roles.
BEGIN;
INSERT INTO public.permissions (key, description)
SELECT 'billing.manage', 'Manage paid subscription orders for an authorized tenant'
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE key = 'billing.manage');
-- Fail closed if another migration introduced an unexpected duplicate.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.permissions WHERE key='billing.manage') <> 1 THEN
    RAISE EXCEPTION 'billing.manage permission catalog integrity violation';
  END IF;
END $$;
COMMIT;
