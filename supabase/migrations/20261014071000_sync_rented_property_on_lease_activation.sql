-- One authoritative occupation state across inventory and rental workflows.
-- Signed PDF is necessary but NOT sufficient: status becomes RENTED only after
-- the administrator activates the verified lease. Closing reuses the audited
-- lease_finish_audit_release trigger to restore AVAILABLE on handover.
BEGIN;

-- A user cannot manually advertise a house as available when it has an active
-- or renewing contract. Keep the constraint even for stale/older frontends.
CREATE OR REPLACE FUNCTION public.guard_property_contract_availability()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE occupied boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.leases l
      WHERE l.organization_id=NEW.organization_id AND l.property_id=NEW.id
        AND l.status IN ('ACTIVE','RENEWAL')
  ) INTO occupied;
  IF occupied AND NEW.status<>'RENTED' THEN
    RAISE EXCEPTION 'Active lease requires RENTED inventory status'
      USING ERRCODE='23514';
  END IF;
  IF NOT occupied AND NEW.status='RENTED' AND OLD.status<>'RENTED' THEN
    RAISE EXCEPTION 'Cannot mark RENTED without a current active lease'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_property_contract_availability() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER properties_contract_status_guard
  BEFORE UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.guard_property_contract_availability();

-- Lock the property row while the administrator activates a draft. Combined
-- with the existing unique active-lease index, prevents concurrent activation
-- or a stale listing from advertising an occupied property.
CREATE OR REPLACE FUNCTION public.guard_lease_activation_property_state()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE current_status text; current_operation text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IN ('ACTIVE','RENEWAL')
      AND OLD.status NOT IN ('ACTIVE','RENEWAL') THEN
    SELECT p.status,p.operation_type INTO current_status,current_operation
      FROM public.properties p
      WHERE p.organization_id=NEW.organization_id AND p.id=NEW.property_id
      FOR UPDATE;
    IF NOT FOUND OR current_operation NOT IN ('RENT','SALE_OR_RENT') OR
       current_status NOT IN ('AVAILABLE','RESERVED','NEGOTIATION','DRAFT') THEN
      RAISE EXCEPTION 'Property unavailable or not eligible for a new lease'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_lease_activation_property_state() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lease_activation_property_state_guard
  BEFORE UPDATE OF status ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.guard_lease_activation_property_state();

-- The inventory transition happens in the same database transaction as
-- DRAFT -> ACTIVE. An error updating inventory rolls back the lease approval.
CREATE OR REPLACE FUNCTION public.mark_property_rented_after_lease_activation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE affected integer;
BEGIN
  IF OLD.status NOT IN ('ACTIVE','RENEWAL')
      AND NEW.status IN ('ACTIVE','RENEWAL') THEN
    UPDATE public.properties p
       SET status='RENTED',updated_at=now()
     WHERE p.organization_id=NEW.organization_id AND p.id=NEW.property_id
       AND p.status IN ('AVAILABLE','RESERVED','NEGOTIATION','DRAFT');
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN
      RAISE EXCEPTION 'Could not synchronize the rented property after activation'
        USING ERRCODE='23514';
    END IF;
    INSERT INTO public.audit_log
      (organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(NEW.organization_id,auth.uid(),
      'property.rented_on_lease_activation','PROPERTY',NEW.property_id,
      pg_catalog.jsonb_build_object('lease_id',NEW.id,'lease_status',NEW.status));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_property_rented_after_lease_activation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lease_activation_marks_property_rented
  AFTER UPDATE OF status ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.mark_property_rented_after_lease_activation();

-- Reconcile *existing* active contracts once. Do not terminate any lease,
-- settle any payments or reset unrelated inactive/sold inventory records.
DO $$
DECLARE current_row record;
BEGIN
  FOR current_row IN
    SELECT p.id AS property_id,p.organization_id,p.status,l.id AS lease_id,
           p.operation_type
      FROM public.properties p
      JOIN public.leases l ON l.organization_id=p.organization_id
        AND l.property_id=p.id
      WHERE l.status IN ('ACTIVE','RENEWAL')
      ORDER BY p.organization_id,p.id
  LOOP
    IF current_row.operation_type NOT IN ('RENT','SALE_OR_RENT') OR
       current_row.status IN ('SOLD','INACTIVE') THEN
      RAISE EXCEPTION 'Existing lease has conflicting inventory status: %',current_row.property_id
        USING ERRCODE='23514';
    END IF;
    IF current_row.status<>'RENTED' THEN
      UPDATE public.properties
        SET status='RENTED',updated_at=now()
        WHERE id=current_row.property_id AND organization_id=current_row.organization_id;
      INSERT INTO public.audit_log
        (organization_id,actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(current_row.organization_id,NULL,
        'property.rented_existing_lease_reconciled','PROPERTY',current_row.property_id,
        pg_catalog.jsonb_build_object('lease_id',current_row.lease_id,
          'previous_status',current_row.status,'new_status','RENTED'));
    END IF;
  END LOOP;
END;
$$;

COMMIT;
