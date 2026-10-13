-- Enforce cross-tenant links for new commission entries even if legacy RLS
-- is overly permissive. Never modify pre-existing paid accounting history.
BEGIN;
CREATE FUNCTION public.validate_new_commission_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.deals d
   WHERE d.id=NEW.deal_id AND d.organization_id=NEW.organization_id
 ) THEN
   RAISE EXCEPTION 'The deal does not belong to this agency' USING ERRCODE='23514';
 END IF;
 IF NEW.beneficiary_user_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.organization_members m
   WHERE m.user_id=NEW.beneficiary_user_id AND m.organization_id=NEW.organization_id
     AND m.status='ACTIVE'
 ) THEN
   RAISE EXCEPTION 'The beneficiary must be an active member of this agency' USING ERRCODE='23514';
 END IF;
 IF NEW.percentage IS NULL OR NEW.percentage NOT BETWEEN 0 AND 100 OR
    NEW.percentage<>round(NEW.percentage,2) OR
    NEW.calculation_basis IS NULL OR NEW.calculation_basis<=0 OR
    NEW.amount IS NULL OR
    NEW.amount IS DISTINCT FROM round(NEW.calculation_basis*NEW.percentage/100,2) THEN
   RAISE EXCEPTION 'Rate, basis and amount must match the commission calculation'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_new_commission_links() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_new_commission_links
 BEFORE INSERT ON public.commissions FOR EACH ROW
 EXECUTE FUNCTION public.validate_new_commission_links();
COMMIT;
