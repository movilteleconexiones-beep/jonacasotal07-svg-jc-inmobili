-- Isolated synthetic PostgreSQL fixture only.
-- Proves scope and idempotency of the candidate grants, NOT actual Supabase RLS.
DO $assert$
DECLARE
  active_manager_count integer;
  total_manager_grants integer;
BEGIN
  SELECT count(*) INTO active_manager_count
  FROM public.roles
  WHERE key='MANAGER' AND active AND organization_id IS NOT NULL;
  IF active_manager_count <> 2 THEN
    RAISE EXCEPTION 'Test fixture must have exactly two active organization MANAGER roles';
  END IF;

  -- Each active MANAGER of each agency receives exactly the two ordinary
  -- rent-payment permissions; the other agency's role is not modified.
  IF EXISTS (
    SELECT 1
    FROM public.roles r
    LEFT JOIN public.role_permissions rp ON rp.role_id=r.id
    LEFT JOIN public.permissions p ON p.id=rp.permission_id
    WHERE r.key='MANAGER' AND r.active AND r.organization_id IS NOT NULL
    GROUP BY r.id
    HAVING count(DISTINCT p.key) <> 2
        OR count(DISTINCT p.key) FILTER (
          WHERE p.key IN ('rent_payments.create','rent_payments.view')
        ) <> 2
  ) THEN
    RAISE EXCEPTION 'An active tenant MANAGER is missing an ordinary rent payment grant';
  END IF;

  SELECT count(*) INTO total_manager_grants
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id=rp.role_id
  WHERE r.key='MANAGER' AND r.active AND r.organization_id IS NOT NULL;
  IF total_manager_grants <> 4 THEN
    RAISE EXCEPTION 'Expected four grants total (two tenant MANAGER roles x two permissions)';
  END IF;

  -- A global role, an inactive role or an AGENT can never acquire these
  -- permissions from this grant procedure.
  IF EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id=rp.role_id
    JOIN public.permissions p ON p.id=rp.permission_id
    WHERE p.key IN ('rent_payments.create','rent_payments.view')
      AND (r.key='AGENT'
        OR (r.key='MANAGER' AND (NOT r.active OR r.organization_id IS NULL)))
  ) THEN
    RAISE EXCEPTION 'Forbidden financial grant for AGENT, inactive or global MANAGER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.role_permissions rp
    JOIN public.roles r ON r.id=rp.role_id
    WHERE r.key='ADMIN'
  ) THEN
    RAISE EXCEPTION 'The coordinator-only script changed ADMIN permissions';
  END IF;
END
$assert$;
