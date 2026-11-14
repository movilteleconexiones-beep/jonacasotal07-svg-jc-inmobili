-- G14 emergency revert; DO NOT run without incident approval.
-- Removing this guard reopens a reproducible cross-tenant role assignment defect.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Trusted operator required'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid='public.member_roles'::regclass
     AND t.tgname='y_jco_member_role_tenant_guard' AND t.tgenabled='O'
 ) THEN RAISE EXCEPTION 'Expected enabled G14 trigger missing; no blind rollback'; END IF;
END $preflight$;
DROP TRIGGER y_jco_member_role_tenant_guard ON public.member_roles;
DROP FUNCTION jco_private.guard_member_role_same_tenant();
COMMIT;
