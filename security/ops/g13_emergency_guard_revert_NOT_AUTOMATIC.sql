-- EMERGENCY ONLY. G13 backward-compatible revert of THREE triggers, no data rewrites.
-- WARNING: dropping guards reopens last-owner/SuperAdmin direct-DML risk.
-- Require incident ticket, validated snapshot and admin review first.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

DO $check$
DECLARE c integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Trusted migration operator required'; END IF;
 SELECT count(*) INTO c FROM pg_trigger
  WHERE tgname IN ('z_jco_last_owner_membership_guard',
                   'z_jco_last_owner_roles_guard',
                   'z_jco_system_role_delete_guard') AND NOT tgisinternal;
 IF c<>3 THEN RAISE EXCEPTION 'G13 rollback expects exactly three guards, found %',c; END IF;
END $check$;

DROP TRIGGER z_jco_last_owner_membership_guard ON public.organization_members;
DROP TRIGGER z_jco_last_owner_roles_guard ON public.member_roles;
DROP TRIGGER z_jco_system_role_delete_guard ON public.roles;
DROP FUNCTION jco_private.guard_protected_membership_mutations();
COMMIT;
