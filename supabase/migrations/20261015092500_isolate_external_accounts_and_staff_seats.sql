-- External-only members never consume operational seats, nor inherit broad CRM RLS.
-- Every mixed-role account (including CLIENT+ADMIN/OWNER) still uses one seat.
-- Existing subscription/plan prices, invoices and license terms are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION jco_private.is_external_only_member(p_member uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.organization_members m
   JOIN public.member_roles mr ON mr.organization_member_id=m.id
   JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id
   WHERE m.id=p_member AND r.key='CLIENT' AND r.active
 ) AND NOT EXISTS (
   SELECT 1 FROM public.organization_members m
   JOIN public.member_roles mr ON mr.organization_member_id=m.id
   JOIN public.roles r ON r.id=mr.role_id
   WHERE m.id=p_member AND (r.key IS DISTINCT FROM 'CLIENT'
       OR r.organization_id IS DISTINCT FROM m.organization_id)
 ) AND NOT EXISTS(
   SELECT 1 FROM public.member_permissions mp WHERE mp.organization_member_id=p_member
    AND mp.effect='ALLOW'
 ) AND NOT EXISTS(
   SELECT 1 FROM public.organization_members m
   JOIN public.member_roles mr ON mr.organization_member_id=m.id
   JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id
   JOIN public.role_permissions rp ON rp.role_id=r.id
   WHERE m.id=p_member AND r.key='CLIENT'
 );
$$;

CREATE OR REPLACE FUNCTION jco_private.is_internal_staff(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.organization_members m
  WHERE m.organization_id=p_org AND m.user_id=(SELECT auth.uid())
    AND m.status='ACTIVE' AND (
      EXISTS(
       SELECT 1 FROM public.member_roles mr
       JOIN public.roles r ON r.id=mr.role_id
       WHERE mr.organization_member_id=m.id AND r.active
        AND r.organization_id=p_org AND r.key IS DISTINCT FROM 'CLIENT'
      ) OR EXISTS(
       SELECT 1 FROM public.member_permissions mp
       WHERE mp.organization_member_id=m.id AND mp.effect='ALLOW'
      )
    )
 );
$$;
REVOKE ALL ON FUNCTION jco_private.is_internal_staff(uuid),jco_private.is_external_only_member(uuid) FROM PUBLIC,anon,authenticated;
-- The RLS policy invokes this narrowly scoped boolean predicate directly:
-- authenticated must have EXECUTE, while the raw membership-classifier stays private.
GRANT EXECUTE ON FUNCTION jco_private.is_internal_staff(uuid) TO authenticated;

-- Current commercial broad policy was allowing the whole tenant by operational
-- status alone. Restrict it to real staff and never grant external portal access.
DO $$
DECLARE t text; n int :=0;
BEGIN
 FOR t IN SELECT tablename FROM pg_policies WHERE schemaname='public'
   AND policyname='jco_commercial_access' ORDER BY tablename LOOP
   EXECUTE format(
    'ALTER POLICY jco_commercial_access ON public.%I TO authenticated USING (jco_private.operational_access(organization_id) AND jco_private.is_internal_staff(organization_id)) WITH CHECK (jco_private.operational_access(organization_id) AND jco_private.is_internal_staff(organization_id))',t
   );
   n:=n+1;
 END LOOP;
 IF n<15 THEN RAISE EXCEPTION 'Insufficient expected commercial policies: %',n; END IF;
END $$;
-- Pre-existing organization-only finance policies also exposed other tenants'
-- documents/payments to any CLIENT member; replace with staff authorization.
DO $$
DECLARE t text; p text;
BEGIN
 FOR t,p IN SELECT * FROM (VALUES
  ('leases','leases_org_access'),('rent_payments','rent_payments_org_access'),
  ('owner_statements','owner_statements_org_access'),
  ('maintenance_requests','maintenance_org_access')
 ) v(tbl,pol) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename=t AND policyname=p) THEN
     RAISE EXCEPTION 'Expected protected policy %.% missing',t,p;
  END IF;
  EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated USING (jco_private.is_internal_staff(organization_id)) WITH CHECK (jco_private.is_internal_staff(organization_id))',p,t);
 END LOOP;
END $$;
-- Block anonymous/CLIENT accounts from sensitive roster and internal settings.
ALTER POLICY members_select_org ON public.organization_members TO authenticated
 USING (user_id=(SELECT auth.uid()) OR jco_private.is_internal_staff(organization_id));
ALTER POLICY member_roles_select_org ON public.member_roles TO authenticated
 USING (EXISTS(SELECT 1 FROM public.organization_members m
  WHERE m.id=organization_member_id AND
   (m.user_id=(SELECT auth.uid()) OR jco_private.is_internal_staff(m.organization_id))));
ALTER POLICY member_permissions_select_org ON public.member_permissions TO authenticated
 USING (EXISTS(SELECT 1 FROM public.organization_members m
  WHERE m.id=organization_member_id AND
   (m.user_id=(SELECT auth.uid()) OR jco_private.is_internal_staff(m.organization_id))));
ALTER POLICY roles_select_org ON public.roles TO authenticated
 USING (organization_id IS NULL OR jco_private.is_internal_staff(organization_id)
   OR (key='CLIENT' AND public.is_org_member(organization_id)));
ALTER POLICY role_permissions_select_org ON public.role_permissions TO authenticated
 USING (EXISTS(SELECT 1 FROM public.roles r WHERE r.id=role_id
   AND (r.organization_id IS NULL OR jco_private.is_internal_staff(r.organization_id))));
ALTER POLICY billing_access_read ON public.organization_billing_access TO authenticated
 USING (public.is_platform_admin() OR jco_private.is_internal_staff(organization_id));
ALTER POLICY license_acceptance_read ON public.license_acceptances TO authenticated
 USING (accepted_by=(SELECT auth.uid()) OR public.is_platform_admin() OR EXISTS(
   SELECT 1 FROM public.organization_licenses l
    WHERE l.id=organization_license_id AND jco_private.is_internal_staff(l.organization_id)));
ALTER POLICY license_acceptance_insert ON public.license_acceptances TO authenticated
 WITH CHECK (accepted_by=(SELECT auth.uid()) AND EXISTS(
   SELECT 1 FROM public.organization_licenses l
    WHERE l.id=organization_license_id AND jco_private.is_internal_staff(l.organization_id)));
ALTER POLICY import_rows_manage ON public.import_job_rows TO authenticated
 USING (EXISTS(SELECT 1 FROM public.import_jobs j WHERE j.id=import_job_id
  AND jco_private.is_internal_staff(j.organization_id)))
 WITH CHECK (EXISTS(SELECT 1 FROM public.import_jobs j WHERE j.id=import_job_id
  AND jco_private.is_internal_staff(j.organization_id)));
ALTER POLICY subscriptions_org_read ON public.subscriptions TO authenticated
 USING (public.is_platform_admin() OR jco_private.is_internal_staff(organization_id));
ALTER POLICY org_license_read ON public.organization_licenses TO authenticated
 USING (public.is_platform_admin() OR jco_private.is_internal_staff(organization_id));
ALTER POLICY settings_select_org ON public.organization_settings TO authenticated
 USING (jco_private.is_internal_staff(organization_id));
ALTER POLICY organization_compliance_read ON public.organization_compliance TO authenticated
 USING (jco_private.is_internal_staff(organization_id));
-- External accounts can still see their own portal links only.
ALTER POLICY portal_links_select ON public.portal_access_links TO authenticated
 USING (user_id=(SELECT auth.uid()) OR jco_private.is_internal_staff(organization_id));

-- Import rows do not have an organization_id: protect via their parent job.
ALTER POLICY import_rows_select ON public.import_job_rows TO authenticated
 USING (EXISTS(SELECT 1 FROM public.import_jobs j
   WHERE j.id=import_job_id AND jco_private.is_internal_staff(j.organization_id)));

-- Restrict generic member-based public activity insertion.
ALTER POLICY activities_insert ON public.activities TO authenticated
 WITH CHECK (jco_private.is_internal_staff(organization_id));
ALTER POLICY ai_usage_insert ON public.ai_usage TO authenticated
 WITH CHECK (jco_private.is_internal_staff(organization_id)
  AND (user_id IS NULL OR user_id=(SELECT auth.uid())));

-- A CLIENT role may never receive internal product permissions.
CREATE OR REPLACE FUNCTION jco_private.guard_client_role_grants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.roles r WHERE r.id=NEW.role_id AND r.key='CLIENT')
 THEN RAISE EXCEPTION 'External CLIENT role cannot be granted operational permissions';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jco_no_client_role_permissions ON public.role_permissions;
CREATE TRIGGER jco_no_client_role_permissions BEFORE INSERT OR UPDATE ON public.role_permissions
 FOR EACH ROW EXECUTE FUNCTION jco_private.guard_client_role_grants();

-- The ordinary seat counter runs BEFORE the invitation roles are attached.
-- Replace only its members trigger with deferred checks so an external-only
-- invitation remains possible even when all internal seats are occupied.
DROP TRIGGER IF EXISTS jco_user_plan_limit ON public.organization_members;
CREATE OR REPLACE FUNCTION jco_private.enforce_internal_seat_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_org uuid; max_seats integer; used integer; requires boolean;
BEGIN
 IF TG_TABLE_NAME='organization_members' THEN
  target_org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
 ELSIF TG_TABLE_NAME IN ('member_roles','member_permissions') THEN
  SELECT organization_id INTO target_org FROM public.organization_members
   WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.organization_member_id ELSE NEW.organization_member_id END;
 END IF;
 IF target_org IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.organizations WHERE id=target_org FOR UPDATE;
 SELECT b.requires_payment,p.max_users INTO requires,max_seats
   FROM public.organizations o
   JOIN public.organization_billing_access b ON b.organization_id=o.id
   JOIN public.plans p ON p.id=o.plan_id WHERE o.id=target_org;
 IF NOT COALESCE(requires,false) OR max_seats IS NULL THEN RETURN NULL; END IF;
 SELECT count(*) INTO used FROM public.organization_members m
 WHERE m.organization_id=target_org AND m.status='ACTIVE'
   AND NOT jco_private.is_external_only_member(m.id);
 IF used>max_seats THEN
  RAISE EXCEPTION 'Internal staff seat limit reached: % of %',used,max_seats;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER jco_internal_seat_members AFTER INSERT OR UPDATE ON public.organization_members
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION jco_private.enforce_internal_seat_limit();
CREATE CONSTRAINT TRIGGER jco_internal_seat_role_changes AFTER INSERT OR UPDATE OR DELETE ON public.member_roles
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION jco_private.enforce_internal_seat_limit();
CREATE CONSTRAINT TRIGGER jco_internal_seat_overrides AFTER INSERT OR UPDATE OR DELETE ON public.member_permissions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION jco_private.enforce_internal_seat_limit();

REVOKE ALL ON FUNCTION jco_private.enforce_internal_seat_limit(),jco_private.guard_client_role_grants()
 FROM PUBLIC,anon,authenticated;

COMMIT;
