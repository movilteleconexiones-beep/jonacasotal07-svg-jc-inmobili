-- Controlled tenant termination and agency-owner retirement.
-- Never remove leases, receipts, statements or documentary evidence.
BEGIN;

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS terminated_on date,
  ADD COLUMN IF NOT EXISTS termination_reason text,
  ADD COLUMN IF NOT EXISTS terminated_by uuid,
  ADD COLUMN IF NOT EXISTS handover_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_financials_acknowledged boolean NOT NULL DEFAULT false;

ALTER TABLE public.property_owners
  ADD COLUMN IF NOT EXISTS agency_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS agency_retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS agency_retired_by uuid,
  ADD COLUMN IF NOT EXISTS agency_retirement_reason text;
ALTER TABLE public.property_owners
  ADD CONSTRAINT property_owners_agency_status_check
  CHECK (agency_status IN ('ACTIVE','RETIRED'));

-- Both operations require an actual tenant administrator, not a platform-wide shortcut.
CREATE OR REPLACE FUNCTION public.is_rental_lifecycle_admin(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.organization_members m
   JOIN public.member_roles mr ON mr.organization_member_id=m.id
   JOIN public.roles r ON r.id=mr.role_id
   WHERE m.organization_id=target_org AND m.user_id=auth.uid()
     AND m.status='ACTIVE' AND r.active AND r.key='ADMIN'
     AND r.organization_id=target_org
 );
$$;
REVOKE ALL ON FUNCTION public.is_rental_lifecycle_admin(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_rental_lifecycle_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_lease_lifecycle_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE pending boolean;
BEGIN
 IF TG_OP='INSERT' THEN
   NULL; -- OLD is absent; always enforce withdrawn-property check below.
 ELSIF (NEW.owner_id,NEW.property_id,NEW.status)
        IS NOT DISTINCT FROM (OLD.owner_id,OLD.property_id,OLD.status) THEN
   RETURN NEW;
 END IF;
   IF NEW.status IN ('DRAFT','ACTIVE','RENEWAL') AND
      (EXISTS (SELECT 1 FROM public.properties p
                WHERE p.id=NEW.property_id AND p.organization_id=NEW.organization_id
                  AND p.status='INACTIVE')
        OR (NEW.owner_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.property_owners o
          WHERE o.organization_id=NEW.organization_id AND o.id=NEW.owner_id
            AND o.agency_status='RETIRED'))) THEN
      RAISE EXCEPTION 'Property or owner withdrawn from the agency' USING ERRCODE='23514';
   END IF;

 IF TG_OP='UPDATE' AND OLD.status IN ('ACTIVE','RENEWAL') AND NEW.status<>OLD.status THEN
   IF NEW.status<>'FINISHED' THEN
     RAISE EXCEPTION 'Active lease must follow the audited finish procedure' USING ERRCODE='23514';
   END IF;
   IF NOT public.is_rental_lifecycle_admin(OLD.organization_id) OR
      NOT public.has_org_permission(OLD.organization_id,'leases.edit') OR
      NOT public.has_org_permission(OLD.organization_id,'properties.edit') THEN
     RAISE EXCEPTION 'Only the authorized administrator may finish a lease' USING ERRCODE='42501';
   END IF;
   IF NEW.organization_id<>OLD.organization_id OR NEW.property_id<>OLD.property_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.monthly_rent<>OLD.monthly_rent OR NEW.start_date<>OLD.start_date
     OR NEW.terminated_by IS DISTINCT FROM auth.uid()
     OR NEW.terminated_on IS NULL OR NOT isfinite(NEW.terminated_on)
     OR NEW.terminated_on<OLD.start_date
     OR NEW.terminated_on>(now() AT TIME ZONE 'America/Bogota')::date
     OR NEW.end_date IS DISTINCT FROM NEW.terminated_on
     OR length(btrim(coalesce(NEW.termination_reason,'')))<12
     OR NEW.handover_confirmed_at IS NULL THEN
     RAISE EXCEPTION 'Invalid termination: physical handover, date and reason are mandatory'
       USING ERRCODE='23514';
   END IF;
   pending:= EXISTS (
     SELECT 1 FROM public.rent_payments rp
      WHERE rp.organization_id=OLD.organization_id AND rp.lease_id=OLD.id
        AND rp.status<>'CANCELLED' AND rp.expected_amount>rp.paid_amount
   ) OR EXISTS (
     SELECT 1 FROM public.owner_statements os
      WHERE os.organization_id=OLD.organization_id AND os.lease_id=OLD.id
        AND os.status<>'PAID'
   );
   IF pending AND NOT NEW.pending_financials_acknowledged THEN
     RAISE EXCEPTION 'Review pending rent/owner statements before termination'
       USING ERRCODE='23514';
   END IF;
   IF EXISTS (
     SELECT 1 FROM public.rent_payments rp
      WHERE rp.organization_id=OLD.organization_id AND rp.lease_id=OLD.id
        AND rp.status<>'CANCELLED'
        AND rp.period_month>date_trunc('month',NEW.terminated_on)::date
   ) THEN
     RAISE EXCEPTION 'Future rent periods must be reviewed before terminating the lease'
       USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_lease_lifecycle_transition() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lease_lifecycle_update_guard
 BEFORE INSERT OR UPDATE OF status,owner_id,property_id ON public.leases
 FOR EACH ROW EXECUTE FUNCTION public.guard_lease_lifecycle_transition();

CREATE OR REPLACE FUNCTION public.after_lease_finished_audited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
 IF OLD.status IN ('ACTIVE','RENEWAL') AND NEW.status='FINISHED' THEN
   -- Do not reopen sold/inactive/reserved properties or an already occupied property.
   UPDATE public.properties p SET status='AVAILABLE',updated_at=now()
    WHERE p.id=NEW.property_id AND p.organization_id=NEW.organization_id
      AND p.status IN ('AVAILABLE','RENTED')
      AND NOT EXISTS (
         SELECT 1 FROM public.leases another
         WHERE another.organization_id=NEW.organization_id AND another.property_id=NEW.property_id
           AND another.id<>NEW.id AND another.status IN ('ACTIVE','RENEWAL')
      );
   INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
   VALUES (NEW.organization_id,auth.uid(),'lease.finished','LEASE',NEW.id,
     jsonb_build_object('property_id',NEW.property_id,'tenant_id',NEW.tenant_id,
       'original_end_date',OLD.end_date,'terminated_on',NEW.terminated_on,
       'reason',NEW.termination_reason,'handover_confirmed',true,
       'pending_financials_acknowledged',NEW.pending_financials_acknowledged));
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.after_lease_finished_audited() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lease_finish_audit_release
 AFTER UPDATE OF status ON public.leases FOR EACH ROW
 EXECUTE FUNCTION public.after_lease_finished_audited();

CREATE OR REPLACE FUNCTION public.admin_finish_lease_and_release(
 target_org uuid,target_lease uuid,effective_date date,justification text,
 handover_confirmed boolean,acknowledge_pending_financials boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE row_lease public.leases%ROWTYPE;
BEGIN
 IF NOT public.is_rental_lifecycle_admin(target_org)
    OR NOT public.has_org_permission(target_org,'leases.edit')
    OR NOT public.has_org_permission(target_org,'properties.edit') THEN
   RAISE EXCEPTION 'Not authorized to finish the contract' USING ERRCODE='42501';
 END IF;
 SELECT * INTO row_lease FROM public.leases
  WHERE organization_id=target_org AND id=target_lease FOR UPDATE;
 IF NOT FOUND OR row_lease.status NOT IN ('ACTIVE','RENEWAL') THEN
   RAISE EXCEPTION 'Only active contracts may be finished' USING ERRCODE='23514';
 END IF;
 IF handover_confirmed IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Confirm physical handover before releasing the property' USING ERRCODE='23514';
 END IF;
 UPDATE public.leases SET status='FINISHED',end_date=effective_date,
   terminated_on=effective_date,termination_reason=btrim(justification),
   terminated_by=auth.uid(),handover_confirmed_at=now(),
   pending_financials_acknowledged=coalesce(acknowledge_pending_financials,false),
   updated_at=now()
 WHERE organization_id=target_org AND id=target_lease;
 RETURN row_lease.property_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finish_lease_and_release(uuid,uuid,date,text,boolean,boolean)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_finish_lease_and_release(uuid,uuid,date,text,boolean,boolean)
 TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_owner_agency_retirement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
 IF NEW.agency_status IS NOT DISTINCT FROM OLD.agency_status THEN RETURN NEW; END IF;
 IF NEW.agency_status<>'RETIRED' OR OLD.agency_status<>'ACTIVE' THEN
   RAISE EXCEPTION 'Owner reactivation requires a separate verified procedure'
     USING ERRCODE='23514';
 END IF;
 IF NOT public.is_rental_lifecycle_admin(OLD.organization_id)
    OR NOT public.has_org_permission(OLD.organization_id,'owners.edit')
    OR NOT public.has_org_permission(OLD.organization_id,'properties.edit') THEN
   RAISE EXCEPTION 'Only an authorized administrator may retire owners' USING ERRCODE='42501';
 END IF;
 IF NEW.organization_id<>OLD.organization_id OR NEW.agency_retired_by IS DISTINCT FROM auth.uid()
    OR NEW.agency_retired_at IS NULL OR length(btrim(coalesce(NEW.agency_retirement_reason,'')))<12 THEN
   RAISE EXCEPTION 'A justified and identified owner withdrawal is required'
      USING ERRCODE='23514';
 END IF;
 -- Lock the entire portfolio to prevent an active lease entering during withdrawal.
 PERFORM 1 FROM public.properties p
  JOIN public.property_ownerships po ON po.property_id=p.id
  WHERE po.owner_id=OLD.id AND p.organization_id=OLD.organization_id
  FOR UPDATE OF p;
 IF EXISTS (
   SELECT 1 FROM public.property_ownerships po
   JOIN public.properties p ON p.id=po.property_id
   JOIN public.leases l ON l.property_id=p.id AND l.organization_id=p.organization_id
   WHERE po.owner_id=OLD.id AND p.organization_id=OLD.organization_id
     AND l.status IN ('DRAFT','ACTIVE','RENEWAL')
 ) THEN
   RAISE EXCEPTION 'Finish active contracts and resolve drafts before withdrawing this owner'
     USING ERRCODE='23514';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.owner_statements os
     WHERE os.owner_id=OLD.id AND os.organization_id=OLD.organization_id AND os.status<>'PAID'
 ) THEN
   RAISE EXCEPTION 'Owner statements require financial review before withdrawal'
     USING ERRCODE='23514';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.property_ownerships mine
   JOIN public.property_ownerships other ON other.property_id=mine.property_id
      AND other.owner_id<>mine.owner_id
   WHERE mine.owner_id=OLD.id
 ) THEN
   RAISE EXCEPTION 'Shared property: resolve co-owner management before owner withdrawal'
      USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_owner_agency_retirement() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER owner_agency_retirement_guard
 BEFORE UPDATE OF agency_status ON public.property_owners
 FOR EACH ROW EXECUTE FUNCTION public.guard_owner_agency_retirement();

CREATE OR REPLACE FUNCTION public.after_owner_agency_retired()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
 IF OLD.agency_status='ACTIVE' AND NEW.agency_status='RETIRED' THEN
   UPDATE public.properties p SET status='INACTIVE',updated_at=now()
     WHERE p.organization_id=NEW.organization_id AND p.id IN
       (SELECT po.property_id FROM public.property_ownerships po WHERE po.owner_id=NEW.id);
   INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
   VALUES (NEW.organization_id,auth.uid(),'owner.agency_retired','PROPERTY_OWNER',NEW.id,
     jsonb_build_object('reason',NEW.agency_retirement_reason,
       'linked_properties',(SELECT count(*) FROM public.property_ownerships WHERE owner_id=NEW.id)));
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.after_owner_agency_retired() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER owner_agency_retirement_audit
 AFTER UPDATE OF agency_status ON public.property_owners
 FOR EACH ROW EXECUTE FUNCTION public.after_owner_agency_retired();

CREATE OR REPLACE FUNCTION public.admin_retire_owner_agency(
 target_org uuid,target_owner uuid,justification text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE property_count integer;
BEGIN
 IF NOT public.is_rental_lifecycle_admin(target_org)
    OR NOT public.has_org_permission(target_org,'owners.edit')
    OR NOT public.has_org_permission(target_org,'properties.edit') THEN
   RAISE EXCEPTION 'Not authorized to retire agency owners' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO property_count FROM public.property_ownerships po
  JOIN public.properties p ON p.id=po.property_id
  WHERE po.owner_id=target_owner AND p.organization_id=target_org;
 UPDATE public.property_owners SET agency_status='RETIRED',
   agency_retired_at=now(),agency_retired_by=auth.uid(),
   agency_retirement_reason=btrim(justification),updated_at=now()
 WHERE id=target_owner AND organization_id=target_org AND agency_status='ACTIVE';
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner not found or already withdrawn' USING ERRCODE='23514'; END IF;
 RETURN property_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_retire_owner_agency(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_retire_owner_agency(uuid,uuid,text) TO authenticated;

COMMIT;
