-- Restrict approval and voiding of owner deductions to active tenant managers.
-- Existing authorized draft creation and immutable financial rows remain unchanged.
CREATE OR REPLACE FUNCTION public.guard_owner_deduction_admin_void()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
BEGIN
 IF (NEW.status='APPROVED' AND OLD.status='DRAFT')
    OR (NEW.status='VOIDED' AND OLD.status IS DISTINCT FROM 'VOIDED') THEN
   IF auth.uid() IS NULL OR
      NOT public.has_org_permission(OLD.organization_id,'owner_statements.create') OR
      NOT public.commission_is_manager(OLD.organization_id) THEN
     RAISE EXCEPTION 'Administrator approval required for financial deduction changes'
       USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
