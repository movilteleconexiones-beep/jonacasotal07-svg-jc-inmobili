-- Reject an equivalent active commission, even under concurrent requests.
-- Multiple roles on the same deal are legitimate; only same deal/type/beneficiary is a duplicate.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $fn$
BEGIN
 IF NEW.status='CANCELLED' THEN RETURN NEW; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
 NEW.organization_id::text || ':' || NEW.deal_id::text || ':' ||
 NEW.commission_type || ':' || coalesce(NEW.beneficiary_user_id::text,'none'),0));
 IF EXISTS(
  SELECT 1 FROM public.commissions c
  WHERE c.organization_id=NEW.organization_id AND c.deal_id=NEW.deal_id
    AND c.commission_type=NEW.commission_type
    AND c.beneficiary_user_id IS NOT DISTINCT FROM NEW.beneficiary_user_id
    AND c.id IS DISTINCT FROM NEW.id
    AND c.status<>'CANCELLED'
    AND NOT EXISTS (SELECT 1 FROM public.commission_accounting_corrections correction
      WHERE correction.organization_id=c.organization_id AND correction.commission_id=c.id)
 ) THEN
  RAISE EXCEPTION 'Ya existe una comisión activa para este negocio, tipo y beneficiario. Anula o retira la anterior antes de crear otra.'
  USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END;$fn$;
DROP TRIGGER IF EXISTS prevent_duplicate_active_commission_trigger ON public.commissions;
CREATE TRIGGER prevent_duplicate_active_commission_trigger
BEFORE INSERT OR UPDATE OF deal_id,commission_type,beneficiary_user_id,status ON public.commissions
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_active_commission();
REVOKE ALL ON FUNCTION public.prevent_duplicate_active_commission() FROM PUBLIC,anon,authenticated;