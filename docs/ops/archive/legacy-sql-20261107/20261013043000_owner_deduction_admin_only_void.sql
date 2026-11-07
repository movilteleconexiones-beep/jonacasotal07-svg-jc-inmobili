-- Authorization boundary for cancelling owner deductions: organization admins only.
-- Existing financial guard still blocks deletion and changes to settled statements.
CREATE OR REPLACE FUNCTION public.guard_owner_deduction_admin_void()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
BEGIN
 IF NEW.status = 'VOIDED' AND OLD.status IS DISTINCT FROM 'VOIDED' THEN
   IF auth.uid() IS NULL OR NOT public.has_org_permission(OLD.organization_id,'owner_statements.create')
      OR NOT public.commission_is_manager(OLD.organization_id) THEN
      RAISE EXCEPTION 'Only an organization administrator can void owner deductions' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_owner_deduction_admin_void() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzz_owner_deduction_admin_void ON public.owner_statement_deductions;
CREATE TRIGGER zzz_owner_deduction_admin_void
BEFORE UPDATE ON public.owner_statement_deductions
FOR EACH ROW EXECUTE FUNCTION public.guard_owner_deduction_admin_void();
