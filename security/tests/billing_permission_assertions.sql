-- Run only after billing_permission_fixture.sql and draft migration, in isolated DB.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.permissions WHERE key='billing.manage') <> 1 THEN
  RAISE EXCEPTION 'billing.manage must exist exactly once'; END IF;
 IF (SELECT count(*) FROM public.permissions WHERE key='settings.edit') <> 1 THEN
  RAISE EXCEPTION 'existing permission must be preserved'; END IF;
 IF EXISTS (SELECT 1 FROM public.role_permissions) OR EXISTS (SELECT 1 FROM public.member_permissions) THEN
  RAISE EXCEPTION 'billing permission must not auto-grant'; END IF;
END $$;
